"""Runtime configuration, read once from the environment.

Every limit that a hosting environment might need to tighten is exposed here
rather than being buried in a handler.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def _origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", DEFAULT_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class Settings:
    # Upload limits. Both are enforced: bytes before decoding, duration after.
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_BYTES", 16 * 1024 * 1024))
    max_duration_seconds: float = field(default_factory=lambda: _float("MAX_DURATION_SECONDS", 120.0))

    # In-memory clip retention. Nothing is written to disk and nothing outlives
    # the process, so a restart clears every upload.
    clip_ttl_seconds: float = field(default_factory=lambda: _float("CLIP_TTL_SECONDS", 1800.0))
    max_clips: int = field(default_factory=lambda: _int("MAX_CLIPS", 48))
    max_store_bytes: int = field(default_factory=lambda: _int("MAX_STORE_BYTES", 512 * 1024 * 1024))
    max_renders_per_clip: int = field(default_factory=lambda: _int("MAX_RENDERS_PER_CLIP", 8))

    # Per-client rate limits, as (requests, window seconds).
    upload_rate: int = field(default_factory=lambda: _int("UPLOAD_RATE", 12))
    upload_window_seconds: float = field(default_factory=lambda: _float("UPLOAD_WINDOW_SECONDS", 300.0))
    process_rate: int = field(default_factory=lambda: _int("PROCESS_RATE", 180))
    process_window_seconds: float = field(default_factory=lambda: _float("PROCESS_WINDOW_SECONDS", 60.0))

    # Hard ceiling on a single processing job.
    processing_timeout_seconds: float = field(
        default_factory=lambda: _float("PROCESSING_TIMEOUT_SECONDS", 30.0)
    )

    # Concurrent processing jobs. Each one holds a full spectrogram in memory
    # while it runs, so this multiplies peak memory directly: two jobs on a
    # 512 MB instance is enough to be killed by the out-of-memory reaper.
    # Raise it only alongside the instance size.
    dsp_workers: int = field(default_factory=lambda: _int("DSP_WORKERS", 2))

    # Ceiling on the number of samples, counted across all channels, that a
    # single clip may carry into processing. Peak memory tracks this figure
    # almost linearly, so it is the one setting that decides whether a long
    # clip fits inside a small instance.
    #
    # A clip above the ceiling is first folded to mono, which halves a stereo
    # recording while keeping its full frequency range, and only resampled
    # downward if that is still not enough. The default is high enough that
    # nothing within the default duration limit is ever touched.
    max_processing_samples: int = field(
        default_factory=lambda: _int("MAX_PROCESSING_SAMPLES", 24_000_000)
    )

    allowed_origins: list[str] = field(default_factory=_origins)
    static_dir: str = field(default_factory=lambda: os.environ.get("STATIC_DIR", ""))


settings = Settings()
