"""Compact numeric summaries of a signal for client-side rendering.

The client draws its own waveform and spectrogram, so the server sends data
rather than images: peak envelopes as float pairs, and the spectrogram as a
base64 grid of bytes. Both are downsampled to display resolution, which keeps
responses small enough to feel instant while a slider is moving.
"""

from __future__ import annotations

import base64

import librosa
import numpy as np

from .stft import StftPlan, forward

WAVEFORM_BUCKETS = 900
SPECTROGRAM_BANDS = 160
SPECTROGRAM_FRAMES = 360
SPECTROGRAM_FLOOR_DB = 78.0

# Lowest frequency shown on the log axis. Below this there is little to see and
# the band spacing becomes extreme.
MIN_DISPLAY_HZ = 40.0


def waveform_peaks(signal: np.ndarray, buckets: int = WAVEFORM_BUCKETS) -> dict:
    """Min/max envelope, one pair per horizontal pixel column."""
    signal = np.asarray(signal, dtype=np.float32).ravel()
    if signal.size == 0:
        return {"min": [], "max": [], "buckets": 0}

    buckets = int(min(buckets, max(1, signal.size)))
    trimmed = signal[: signal.size - (signal.size % buckets)] if signal.size >= buckets else signal
    if trimmed.size < buckets:
        padded = np.zeros(buckets, dtype=np.float32)
        padded[: trimmed.size] = trimmed
        trimmed = padded
    reshaped = trimmed.reshape(buckets, -1)

    return {
        "min": np.round(reshaped.min(axis=1), 4).tolist(),
        "max": np.round(reshaped.max(axis=1), 4).tolist(),
        "buckets": buckets,
    }


def _log_band_edges(plan: StftPlan, bands: int) -> np.ndarray:
    """Bin indices delimiting logarithmically spaced display bands.

    A low sample rate can leave fewer STFT bins than there are display bands.
    Rather than dropping bands and giving the client a variable-height image,
    edges are clamped so that each band still resolves to at least one bin;
    neighbouring bands then repeat a bin, which is the honest rendering of a
    log axis that has run out of resolution.
    """
    frequencies = plan.frequencies
    n_bins = frequencies.size
    low = max(MIN_DISPLAY_HZ, float(frequencies[1]))
    high = float(frequencies[-1])
    targets = np.geomspace(low, high, bands + 1)
    edges = np.searchsorted(frequencies, targets).astype(int)
    # Prefer strictly increasing edges, but never past the last available bin.
    for index in range(1, edges.size):
        edges[index] = min(max(edges[index], edges[index - 1] + 1), n_bins - 1)
    return np.clip(edges, 0, n_bins - 1)


def spectrogram(signal: np.ndarray, plan: StftPlan) -> dict:
    """Log-frequency magnitude spectrogram, quantised to bytes.

    Values are decibels relative to the loudest bin, mapped onto 0-255 where 0
    is the display floor. The client applies its own colour ramp.
    """
    magnitude = np.abs(forward(np.asarray(signal, dtype=np.float32).ravel(), plan))
    if magnitude.size == 0:
        return {"width": 0, "height": 0, "data": "", "bandEdgesHz": [], "durationSeconds": 0.0}

    decibels = librosa.amplitude_to_db(magnitude, ref=np.max, top_db=SPECTROGRAM_FLOOR_DB)

    edges = _log_band_edges(plan, SPECTROGRAM_BANDS)
    banded = np.stack(
        [
            decibels[edges[i] : max(edges[i] + 1, edges[i + 1])].max(axis=0)
            for i in range(SPECTROGRAM_BANDS)
        ]
    )

    n_frames = banded.shape[1]
    width = int(min(SPECTROGRAM_FRAMES, n_frames))
    if n_frames > width:
        columns = np.linspace(0, n_frames, width + 1).astype(int)
        banded = np.stack(
            [banded[:, columns[i] : max(columns[i] + 1, columns[i + 1])].max(axis=1) for i in range(width)],
            axis=1,
        )

    normalised = (banded + SPECTROGRAM_FLOOR_DB) / SPECTROGRAM_FLOOR_DB
    grid = np.clip(normalised * 255.0, 0, 255).astype(np.uint8)
    # Row 0 is the highest band so the client can blit rows top to bottom.
    grid = grid[::-1]

    frequencies = plan.frequencies
    band_edges = [float(frequencies[min(int(edge), frequencies.size - 1)]) for edge in edges]

    return {
        "width": int(grid.shape[1]),
        "height": int(grid.shape[0]),
        "data": base64.b64encode(grid.tobytes()).decode("ascii"),
        "bandEdgesHz": band_edges,
        "floorDb": SPECTROGRAM_FLOOR_DB,
        "durationSeconds": float(len(signal) / plan.sample_rate),
    }


def response_curve(response: np.ndarray | None, plan: StftPlan, points: int = 220) -> list | None:
    """Filter magnitude response resampled onto a log frequency axis for plotting."""
    if response is None:
        return None
    frequencies = plan.frequencies
    low = max(MIN_DISPLAY_HZ, float(frequencies[1]))
    targets = np.geomspace(low, float(frequencies[-1]), points)
    values = np.interp(targets, frequencies, response)
    return [
        {"hz": round(float(hz), 2), "gain": round(float(gain), 5)}
        for hz, gain in zip(targets, values)
    ]
