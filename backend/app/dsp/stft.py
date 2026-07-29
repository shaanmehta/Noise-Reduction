"""Short-time Fourier transform planning and round-trip helpers.

A single StftPlan object is threaded through analysis, filtering and
reconstruction so that the forward and inverse transforms can never drift out
of agreement. Every window parameter is derived from the sample rate rather
than hardcoded, so an 8 kHz clip and a 48 kHz clip both get a sensible
time-frequency resolution.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

# Analysis window length in seconds. ~43 ms is the usual compromise for speech
# and music: long enough to resolve low-frequency detail, short enough that
# transients are not smeared across the window.
TARGET_WINDOW_SECONDS = 0.043

MIN_N_FFT = 256
MAX_N_FFT = 4096


@dataclass(frozen=True)
class StftPlan:
    """Window geometry shared by the forward and inverse transform."""

    sample_rate: int
    n_fft: int
    hop_length: int
    win_length: int
    window: str = "hann"

    @property
    def frequencies(self) -> np.ndarray:
        """Centre frequency in Hz of every one-sided STFT bin.

        This is the correct mapping from bin index to Hz for the output of
        librosa.stft, which keeps only the non-negative frequencies.
        """
        return librosa.fft_frequencies(sr=self.sample_rate, n_fft=self.n_fft)

    @property
    def n_bins(self) -> int:
        return self.n_fft // 2 + 1

    @property
    def nyquist(self) -> float:
        return self.sample_rate / 2.0

    def frames_for_seconds(self, seconds: float) -> int:
        """Number of STFT frames spanning a given duration."""
        return max(1, int(round(seconds * self.sample_rate / self.hop_length)))


def plan_stft(sample_rate: int) -> StftPlan:
    """Choose window geometry appropriate for the given sample rate."""
    target_samples = TARGET_WINDOW_SECONDS * sample_rate
    exponent = int(round(np.log2(max(target_samples, MIN_N_FFT))))
    n_fft = int(np.clip(2**exponent, MIN_N_FFT, MAX_N_FFT))
    return StftPlan(
        sample_rate=int(sample_rate),
        n_fft=n_fft,
        hop_length=n_fft // 4,
        win_length=n_fft,
    )


def forward(signal: np.ndarray, plan: StftPlan) -> np.ndarray:
    """Complex STFT of a single channel."""
    return librosa.stft(
        np.ascontiguousarray(signal, dtype=np.float32),
        n_fft=plan.n_fft,
        hop_length=plan.hop_length,
        win_length=plan.win_length,
        window=plan.window,
    )


def inverse(spectrum: np.ndarray, plan: StftPlan, length: int) -> np.ndarray:
    """Inverse STFT, trimmed or padded to an exact sample count.

    Pinning the output length matters for evaluation: the SNR routine measures
    the original and the processed signal over the same sample windows, which
    is only meaningful if the two arrays line up sample for sample.
    """
    return librosa.istft(
        spectrum,
        n_fft=plan.n_fft,
        hop_length=plan.hop_length,
        win_length=plan.win_length,
        window=plan.window,
        length=length,
    ).astype(np.float32)
