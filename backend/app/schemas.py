"""Request and response models.

Validation lives here so that handlers can assume sane values, and so that the
frontend has one authoritative description of the parameter ranges.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FilterKindName = Literal["spectral_gate", "low_pass", "high_pass", "band_pass"]
RolloffName = Literal["butterworth", "cosine", "brickwall"]


class FilterRequest(BaseModel):
    kind: FilterKindName = "spectral_gate"

    # Band edges. The upper bound is generous; the service clamps whatever it
    # receives to the Nyquist frequency of the clip actually being processed.
    low_cutoff_hz: float = Field(default=300.0, ge=10.0, le=24_000.0)
    high_cutoff_hz: float = Field(default=5_000.0, ge=10.0, le=24_000.0)

    rolloff: RolloffName = "butterworth"
    order: int = Field(default=4, ge=1, le=12)
    transition_hz: float = Field(default=250.0, ge=10.0, le=8_000.0)

    # Spectral gate controls.
    threshold_db: float = Field(default=6.0, ge=-12.0, le=36.0)
    reduction_db: float = Field(default=-24.0, ge=-60.0, le=0.0)
    time_smoothing: int = Field(default=5, ge=1, le=31)
    freq_smoothing: int = Field(default=3, ge=1, le=31)


class ClipInfo(BaseModel):
    clip_id: str
    filename: str
    duration_seconds: float
    sample_rate: int
    original_sample_rate: int
    channels: int
    original_channels: int
    source_format: str
    resampled: bool


class AnalysisInfo(BaseModel):
    method: str
    noise_seconds: float
    signal_seconds: float
    separation_db: float
    reliable: bool
    n_fft: int
    hop_length: int
    win_length: int
    frequency_resolution_hz: float
    nyquist_hz: float


class Metrics(BaseModel):
    snr_db: float
    noise_floor_dbfs: float
    signal_level_dbfs: float
    peak_dbfs: float


class ClipResponse(BaseModel):
    clip: ClipInfo
    analysis: AnalysisInfo
    metrics: Metrics
    waveform: dict
    spectrogram: dict
    audio_url: str


class ProcessResponse(BaseModel):
    render_id: str
    audio_url: str
    settings: FilterRequest
    metrics: Metrics
    snr_delta_db: float
    waveform: dict
    spectrogram: dict
    response_curve: list | None
    elapsed_ms: float


class ComparisonEntry(BaseModel):
    kind: FilterKindName
    label: str
    snr_db: float
    snr_delta_db: float
    noise_floor_dbfs: float
    signal_level_dbfs: float
    settings: FilterRequest


class CompareResponse(BaseModel):
    baseline_snr_db: float
    reliable: bool
    entries: list[ComparisonEntry]
    elapsed_ms: float
