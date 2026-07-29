"""Frequency-domain filters applied to the STFT of an input signal.

Every filter here follows the same shape: analyse with an STFT, build a
real-valued gain per (frequency bin, frame), multiply, and resynthesise. The
band filters build a gain that varies only with frequency; the spectral gate
builds one that varies with both frequency and time.

Two details are worth calling out because they are easy to get wrong:

* Bin-to-hertz mapping comes from the STFT plan, which derives it from the
  same n_fft used for the transform. Deriving it any other way puts the
  cutoffs somewhere other than where the caller asked for them.
* Gains roll off smoothly rather than switching between 1 and 0. A hard edge
  in the frequency domain is a sinc in the time domain, which rings audibly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.ndimage import median_filter, uniform_filter1d
from scipy.signal import butter, sosfreqz

from .metrics import Segmentation
from .stft import StftPlan, forward, inverse

FilterKind = Literal["spectral_gate", "low_pass", "high_pass", "band_pass"]
RolloffKind = Literal["butterworth", "cosine", "brickwall"]

EPS = 1e-12

FILTER_KINDS: tuple[FilterKind, ...] = (
    "spectral_gate",
    "low_pass",
    "high_pass",
    "band_pass",
)


@dataclass(frozen=True)
class FilterSettings:
    """Everything the caller can steer, already validated and clamped."""

    kind: FilterKind
    low_cutoff_hz: float = 300.0
    high_cutoff_hz: float = 5000.0
    rolloff: RolloffKind = "butterworth"
    order: int = 4
    transition_hz: float = 250.0
    threshold_db: float = 6.0
    reduction_db: float = -18.0
    time_smoothing: int = 5
    freq_smoothing: int = 3


def _clamp_cutoffs(settings: FilterSettings, nyquist: float) -> tuple[float, float]:
    """Keep cutoffs strictly inside (0, nyquist) and correctly ordered."""
    margin = max(1.0, nyquist * 0.001)
    low = float(np.clip(settings.low_cutoff_hz, margin, nyquist - margin))
    high = float(np.clip(settings.high_cutoff_hz, margin, nyquist - margin))
    if low >= high:
        low, high = min(low, high), max(low, high)
        if low >= high:
            high = min(low + margin, nyquist - margin / 2)
            low = max(high - margin, margin)
    return low, high


def _butterworth_response(
    frequencies: np.ndarray,
    sample_rate: int,
    band: tuple[float, ...],
    btype: str,
    order: int,
) -> np.ndarray:
    """Magnitude of a real Butterworth filter, sampled at the STFT bin centres.

    scipy designs the filter; the response is then evaluated exactly at the
    frequencies the STFT actually represents. This gives the maximally flat
    passband and monotonic roll-off of a Butterworth section without the phase
    behaviour of a time-domain implementation, since only the magnitude is
    applied to the spectrum.
    """
    sos = butter(order, band if len(band) > 1 else band[0], btype=btype, output="sos", fs=sample_rate)
    _, response = sosfreqz(sos, worN=frequencies, fs=sample_rate)
    return np.abs(response).astype(np.float32)


def _cosine_edge(frequencies: np.ndarray, cutoff: float, width: float, rising: bool) -> np.ndarray:
    """Raised-cosine transition centred on the cutoff frequency."""
    width = max(width, EPS)
    normalised = (frequencies - cutoff) / width + 0.5
    ramp = np.clip(normalised, 0.0, 1.0)
    taper = 0.5 - 0.5 * np.cos(np.pi * ramp)
    return taper if rising else 1.0 - taper


def frequency_response(settings: FilterSettings, plan: StftPlan) -> np.ndarray:
    """Gain per STFT frequency bin for the band filters."""
    frequencies = plan.frequencies
    low, high = _clamp_cutoffs(settings, plan.nyquist)
    order = int(np.clip(settings.order, 1, 12))
    width = float(np.clip(settings.transition_hz, 1.0, plan.nyquist))

    if settings.rolloff == "brickwall":
        if settings.kind == "low_pass":
            response = (frequencies <= high).astype(np.float32)
        elif settings.kind == "high_pass":
            response = (frequencies >= low).astype(np.float32)
        else:
            response = ((frequencies >= low) & (frequencies <= high)).astype(np.float32)
    elif settings.rolloff == "cosine":
        if settings.kind == "low_pass":
            response = _cosine_edge(frequencies, high, width, rising=False)
        elif settings.kind == "high_pass":
            response = _cosine_edge(frequencies, low, width, rising=True)
        else:
            response = _cosine_edge(frequencies, low, width, rising=True) * _cosine_edge(
                frequencies, high, width, rising=False
            )
    else:
        if settings.kind == "low_pass":
            response = _butterworth_response(frequencies, plan.sample_rate, (high,), "lowpass", order)
        elif settings.kind == "high_pass":
            response = _butterworth_response(frequencies, plan.sample_rate, (low,), "highpass", order)
        else:
            response = _butterworth_response(
                frequencies, plan.sample_rate, (low, high), "bandpass", order
            )

    return np.clip(response, 0.0, 1.0).astype(np.float32)


def _noise_frames(segments: Segmentation, plan: StftPlan, n_frames: int) -> np.ndarray:
    """Map the sample-level noise mask onto STFT frame indices.

    Frame index is sample index divided by hop length. Scaling by the sample
    rate instead, as a raw duration would suggest, overshoots the frame count
    by orders of magnitude and silently selects the whole spectrogram.
    """
    flags = np.zeros(n_frames, dtype=bool)
    sample_indices = np.flatnonzero(segments.noise)
    if sample_indices.size:
        frame_indices = np.clip(sample_indices // plan.hop_length, 0, n_frames - 1)
        flags[np.unique(frame_indices)] = True
    if not flags.any():
        flags[: max(1, min(n_frames, plan.frames_for_seconds(0.2)))] = True
    return flags


def _gate_mask(
    magnitude: np.ndarray,
    settings: FilterSettings,
    plan: StftPlan,
    segments: Segmentation,
) -> np.ndarray:
    """Time-varying gain that suppresses bins sitting at the noise floor."""
    n_frames = magnitude.shape[1]
    noise_flags = _noise_frames(segments, plan, n_frames)
    noise_frames = magnitude[:, noise_flags]

    # Per-bin noise profile. The mean plus a spread term tracks the tail of the
    # noise distribution rather than its centre, so ordinary fluctuation in the
    # noise does not push bins above the threshold.
    profile = noise_frames.mean(axis=1) + noise_frames.std(axis=1)
    threshold = profile[:, None] * (10.0 ** (settings.threshold_db / 20.0))

    mask = (magnitude > threshold).astype(np.float32)

    # Median filtering across time removes isolated speckle, the source of the
    # "musical noise" warble that plain thresholding produces.
    time_kernel = int(np.clip(settings.time_smoothing, 1, 31)) | 1
    freq_kernel = int(np.clip(settings.freq_smoothing, 1, 31)) | 1
    if time_kernel > 1 or freq_kernel > 1:
        mask = median_filter(mask, size=(freq_kernel, time_kernel), mode="nearest")

    # Blur the surviving edges so the gain ramps in and out instead of snapping.
    if time_kernel > 1:
        mask = uniform_filter1d(mask, size=time_kernel, axis=1, mode="nearest")
    if freq_kernel > 1:
        mask = uniform_filter1d(mask, size=freq_kernel, axis=0, mode="nearest")

    # Attenuate rejected bins rather than zeroing them. A residual noise bed is
    # far less distracting than the pumping silence of a hard gate.
    floor = float(10.0 ** (np.clip(settings.reduction_db, -80.0, 0.0) / 20.0))
    return np.clip(floor + (1.0 - floor) * mask, 0.0, 1.0).astype(np.float32)


@dataclass
class FilterResult:
    audio: np.ndarray
    response: np.ndarray | None
    plan: StftPlan


def apply_filter(
    audio: np.ndarray,
    sample_rate: int,
    plan: StftPlan,
    settings: FilterSettings,
    segments: Segmentation,
) -> FilterResult:
    """Filter one or more channels, returning audio of identical shape.

    Channels are transformed independently so stereo imaging survives, but the
    spectral gate derives its noise profile from the channel mixdown so that
    both channels are gated on the same decision and the image does not wander.
    """
    channels = np.atleast_2d(audio)
    length = channels.shape[1]
    processed = np.empty_like(channels, dtype=np.float32)
    response: np.ndarray | None = None

    if settings.kind == "spectral_gate":
        mixdown = channels.mean(axis=0)
        reference = np.abs(forward(mixdown, plan))
        mask = _gate_mask(reference, settings, plan, segments)
        for index, channel in enumerate(channels):
            spectrum = forward(channel, plan)
            frames = min(spectrum.shape[1], mask.shape[1])
            spectrum[:, :frames] *= mask[:, :frames]
            processed[index] = inverse(spectrum, plan, length)
    else:
        response = frequency_response(settings, plan)
        for index, channel in enumerate(channels):
            spectrum = forward(channel, plan)
            spectrum *= response[:, None]
            processed[index] = inverse(spectrum, plan, length)

    return FilterResult(
        audio=processed if audio.ndim > 1 else processed[0],
        response=response,
        plan=plan,
    )
