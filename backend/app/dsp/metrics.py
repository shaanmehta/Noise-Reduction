"""Automatic noise/signal segmentation and signal-to-noise measurement.

Nothing here is tuned to a particular recording. The noise and signal
reference windows are located by energy analysis of whatever audio is handed
in, and the same windows are then reused to measure the processed audio so
that a before/after comparison is like for like.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

EPS = 1e-12

# Minimum usable reference material. If detection cannot find at least this
# much audio for either reference, the percentile fallback takes over.
MIN_REFERENCE_SECONDS = 0.05

# Fractions used by the fallback: quietest 20 % of frames are treated as the
# noise reference, loudest 30 % as the signal reference.
NOISE_FRAME_FRACTION = 0.20
SIGNAL_FRAME_FRACTION = 0.30


# A clip whose quiet and loud references differ by less than this is one where
# no genuine noise-only passage exists, so any SNR figure derived from it is a
# rough indication rather than a measurement.
RELIABLE_SEPARATION_DB = 8.0


@dataclass(frozen=True)
class Segmentation:
    """Boolean sample masks marking the noise and signal reference regions."""

    noise: np.ndarray
    signal: np.ndarray
    method: str
    noise_seconds: float
    signal_seconds: float
    separation_db: float = 0.0

    @property
    def reliable(self) -> bool:
        """Whether the two references are distinct enough to trust the SNR."""
        return self.separation_db >= RELIABLE_SEPARATION_DB


def _frame_rms(signal: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    return librosa.feature.rms(
        y=signal, frame_length=frame_length, hop_length=hop_length, center=True
    )[0]


def _mask_from_frames(
    frame_flags: np.ndarray, n_samples: int, frame_length: int, hop_length: int
) -> np.ndarray:
    """Expand a per-frame boolean flag to a per-sample boolean mask."""
    mask = np.zeros(n_samples, dtype=bool)
    half = frame_length // 2
    for index in np.flatnonzero(frame_flags):
        centre = index * hop_length
        start = max(0, centre - half)
        end = min(n_samples, centre + half)
        if end > start:
            mask[start:end] = True
    return mask


def detect_segments(signal: np.ndarray, sample_rate: int) -> Segmentation:
    """Locate a low-energy noise window and a high-energy signal window.

    Primary strategy is voice-activity style interval detection: every interval
    reported as non-silent becomes the signal reference, and the complement
    becomes the noise reference. When a clip has no clear silence (continuous
    music, a very short upload) that split degenerates, so the routine falls
    back to ranking frames by energy and taking from each end.
    """
    signal = np.ascontiguousarray(signal, dtype=np.float32)
    n_samples = signal.size
    frame_length = int(np.clip(2 ** round(np.log2(0.043 * sample_rate)), 256, 4096))
    frame_length = min(frame_length, max(256, n_samples))
    hop_length = max(1, frame_length // 4)
    min_samples = int(MIN_REFERENCE_SECONDS * sample_rate)

    signal_mask = np.zeros(n_samples, dtype=bool)
    for start, end in librosa.effects.split(
        signal, top_db=30, frame_length=frame_length, hop_length=hop_length
    ):
        signal_mask[start:end] = True
    noise_mask = ~signal_mask

    method = "activity-detection"
    if int(signal_mask.sum()) < min_samples or int(noise_mask.sum()) < min_samples:
        method = "energy-percentile"
        rms = _frame_rms(signal, frame_length, hop_length)
        order = np.argsort(rms)
        n_frames = rms.size
        n_noise = max(1, int(round(n_frames * NOISE_FRAME_FRACTION)))
        n_signal = max(1, int(round(n_frames * SIGNAL_FRAME_FRACTION)))

        noise_flags = np.zeros(n_frames, dtype=bool)
        noise_flags[order[:n_noise]] = True
        signal_flags = np.zeros(n_frames, dtype=bool)
        signal_flags[order[-n_signal:]] = True

        noise_mask = _mask_from_frames(noise_flags, n_samples, frame_length, hop_length)
        signal_mask = _mask_from_frames(signal_flags, n_samples, frame_length, hop_length)
        # The loudest and quietest frames can overlap once expanded to samples;
        # the signal reference wins those samples.
        noise_mask &= ~signal_mask

    if not noise_mask.any() or not signal_mask.any():
        # Degenerate input (silence, or a clip shorter than one frame). Split it
        # in half so downstream code always has something to measure.
        method = "fallback-split"
        midpoint = max(1, n_samples // 2)
        noise_mask = np.zeros(n_samples, dtype=bool)
        signal_mask = np.zeros(n_samples, dtype=bool)
        noise_mask[:midpoint] = True
        signal_mask[midpoint:] = True

    separation = rms_dbfs(signal[signal_mask]) - rms_dbfs(signal[noise_mask])

    return Segmentation(
        noise=noise_mask,
        signal=signal_mask,
        method=method,
        noise_seconds=float(noise_mask.sum()) / sample_rate,
        signal_seconds=float(signal_mask.sum()) / sample_rate,
        separation_db=float(separation) if np.isfinite(separation) else 0.0,
    )


def _power(signal: np.ndarray, mask: np.ndarray) -> float:
    selected = signal[mask]
    if selected.size == 0:
        return 0.0
    return float(np.mean(np.square(selected, dtype=np.float64)))


def signal_to_noise_db(signal: np.ndarray, segments: Segmentation) -> float:
    """SNR in dB using pre-located reference windows.

    The high-energy window holds signal plus noise, so the noise power is
    subtracted from it before the ratio is taken. Without that correction the
    figure saturates near 0 dB for genuinely noisy recordings.
    """
    noise_power = _power(signal, segments.noise)
    mixed_power = _power(signal, segments.signal)
    if noise_power <= EPS:
        noise_power = EPS
    signal_power = max(mixed_power - noise_power, EPS)
    return float(10.0 * np.log10(signal_power / noise_power))


def rms_dbfs(signal: np.ndarray) -> float:
    if signal.size == 0:
        return -np.inf
    return float(20.0 * np.log10(max(float(np.sqrt(np.mean(np.square(signal, dtype=np.float64)))), EPS)))


def measure(signal: np.ndarray, segments: Segmentation) -> dict[str, float]:
    """Summary statistics for one signal, measured on shared reference windows."""
    return {
        "snr_db": signal_to_noise_db(signal, segments),
        "noise_floor_dbfs": rms_dbfs(signal[segments.noise]),
        "signal_level_dbfs": rms_dbfs(signal[segments.signal]),
        "peak_dbfs": float(20.0 * np.log10(max(float(np.max(np.abs(signal))) if signal.size else 0.0, EPS))),
    }
