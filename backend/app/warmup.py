"""Paying librosa's start-up cost before any visitor can be charged for it.

librosa defers a great deal of work to first use: submodules are imported
lazily and several helpers are compiled by numba the first time they run. On
this codebase that first call costs about two and a half seconds on a
development machine, and proportionally longer on a small shared instance.

Left alone, that cost lands on whoever uploads first after the process starts,
which on a host that sleeps when idle means a real visitor, on a real upload,
hitting the processing timeout. Running the same code paths over a fraction of
a second of synthetic audio at start-up moves the cost to boot time, where
nobody is waiting on it.
"""

from __future__ import annotations

import logging
import threading
import time

import numpy as np

logger = logging.getLogger("noisereduce")

_done = threading.Event()


def is_ready() -> bool:
    """Whether the expensive import and compilation work has finished."""
    return _done.is_set()


def _exercise() -> None:
    """Run every library path a real request uses, on a tiny buffer."""
    from .dsp import audio_io, filters, metrics, stft, visualize

    sample_rate = 22_050
    t = np.arange(int(0.5 * sample_rate)) / sample_rate
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    # Half signal, half near-silence, so the activity detector has both to find.
    tone[: tone.size // 2] *= 0.01
    stereo = np.stack([tone, tone])

    plan = stft.plan_stft(sample_rate)
    segments = metrics.detect_segments(tone, sample_rate)
    metrics.measure(tone, segments)

    # Both branches: the gate compiles the median and uniform filters, the band
    # filters compile the Butterworth design and evaluation.
    for kind in ("spectral_gate", "band_pass"):
        result = filters.apply_filter(
            stereo, sample_rate, plan, filters.FilterSettings(kind=kind), segments
        )
        mono = np.atleast_2d(result.audio).mean(axis=0).astype(np.float32)
        visualize.spectrogram(mono, plan)
        visualize.waveform_peaks(mono)

    # Resampling pulls in soxr, and encoding pulls in libsndfile's writer.
    audio_io.encode_wav(stereo, sample_rate)
    audio_io._resample(stereo, sample_rate, 16_000)


def run() -> None:
    """Warm the processing stack, logging how long it took."""
    started = time.perf_counter()
    try:
        _exercise()
    except Exception:  # pragma: no cover - warming must never stop the service
        logger.exception("warm-up failed; first request will be slower")
    finally:
        _done.set()
        logger.info("warm-up finished in %.2fs", time.perf_counter() - started)


def start_background() -> threading.Thread:
    """Warm the stack without delaying the port binding.

    Blocking start-up would be simpler, but a host that waits for a health
    check before routing traffic could time the container out while it warms.
    A daemon thread lets the service accept connections immediately and be
    ready by the time anyone has chosen a file.
    """
    thread = threading.Thread(target=run, name="warmup", daemon=True)
    thread.start()
    return thread
