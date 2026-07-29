"""Application logic sitting between the HTTP layer and the DSP routines."""

from __future__ import annotations

import time

import numpy as np

from .config import settings
from .dsp import audio_io, filters, metrics, visualize
from .dsp.sample import generate_sample
from .dsp.stft import plan_stft
from .errors import LimitError
from .schemas import FilterRequest
from .store import Clip, new_clip_id, store

FILTER_LABELS: dict[str, str] = {
    "spectral_gate": "Spectral gate",
    "low_pass": "Low pass",
    "high_pass": "High pass",
    "band_pass": "Band pass",
}


def _to_settings(request: FilterRequest) -> filters.FilterSettings:
    return filters.FilterSettings(
        kind=request.kind,
        low_cutoff_hz=request.low_cutoff_hz,
        high_cutoff_hz=request.high_cutoff_hz,
        rolloff=request.rolloff,
        order=request.order,
        transition_hz=request.transition_hz,
        threshold_db=request.threshold_db,
        reduction_db=request.reduction_db,
        time_smoothing=request.time_smoothing,
        freq_smoothing=request.freq_smoothing,
    )


def build_clip(payload: bytes, filename: str) -> Clip:
    """Decode an upload and precompute everything the client needs up front."""
    decoded = audio_io.decode(payload, filename)

    if decoded.duration > settings.max_duration_seconds:
        raise LimitError(
            f"That clip is {decoded.duration:.0f} seconds long. "
            f"The limit is {settings.max_duration_seconds:.0f} seconds."
        )

    mono = decoded.mixdown()
    plan = plan_stft(decoded.sample_rate)
    segments = metrics.detect_segments(mono, decoded.sample_rate)
    baseline = metrics.measure(mono, segments)

    clip = Clip(
        clip_id=new_clip_id(),
        audio=decoded,
        plan=plan,
        segments=segments,
        baseline=baseline,
        original_bytes=audio_io.encode_wav(decoded.samples, decoded.sample_rate),
        visuals={
            "waveform": visualize.waveform_peaks(mono),
            "spectrogram": visualize.spectrogram(mono, plan),
        },
        filename=filename or "clip.wav",
    )
    store.put(clip)
    return clip


def build_sample_clip() -> Clip:
    """Decode the generated demonstration clip through the same path as an upload."""
    audio, sample_rate = generate_sample()
    payload = audio_io.encode_wav(audio[None, :], sample_rate)
    return build_clip(payload, "demonstration-clip.wav")


def clip_payload(clip: Clip) -> dict:
    resolution = clip.plan.sample_rate / clip.plan.n_fft
    return {
        "clip": {
            "clip_id": clip.clip_id,
            "filename": clip.filename,
            "duration_seconds": round(clip.audio.duration, 4),
            "sample_rate": clip.audio.sample_rate,
            "original_sample_rate": clip.audio.original_sample_rate,
            "channels": clip.audio.channels,
            "original_channels": clip.audio.original_channels,
            "source_format": clip.audio.source_format,
            "resampled": clip.audio.sample_rate != clip.audio.original_sample_rate,
        },
        "analysis": {
            "method": clip.segments.method,
            "noise_seconds": round(clip.segments.noise_seconds, 3),
            "signal_seconds": round(clip.segments.signal_seconds, 3),
            "separation_db": round(clip.segments.separation_db, 2),
            "reliable": clip.segments.reliable,
            "n_fft": clip.plan.n_fft,
            "hop_length": clip.plan.hop_length,
            "win_length": clip.plan.win_length,
            "frequency_resolution_hz": round(resolution, 3),
            "nyquist_hz": round(clip.plan.nyquist, 1),
        },
        "metrics": {key: round(value, 3) for key, value in clip.baseline.items()},
        "waveform": clip.visuals["waveform"],
        "spectrogram": clip.visuals["spectrogram"],
        "audio_url": f"/api/clips/{clip.clip_id}/audio/original.wav",
    }


def process_clip(clip: Clip, request: FilterRequest) -> dict:
    """Run one filter and return metrics plus fresh visuals."""
    started = time.perf_counter()
    settings_obj = _to_settings(request)

    result = filters.apply_filter(
        clip.audio.samples, clip.audio.sample_rate, clip.plan, settings_obj, clip.segments
    )
    processed = np.atleast_2d(result.audio)
    mono = processed.mean(axis=0).astype(np.float32)

    measured = metrics.measure(mono, clip.segments)
    render_id = store.add_render(clip, audio_io.encode_wav(processed, clip.audio.sample_rate))

    return {
        "render_id": render_id,
        "audio_url": f"/api/clips/{clip.clip_id}/renders/{render_id}.wav",
        "settings": request.model_dump(),
        "metrics": {key: round(value, 3) for key, value in measured.items()},
        "snr_delta_db": round(measured["snr_db"] - clip.baseline["snr_db"], 3),
        "waveform": visualize.waveform_peaks(mono),
        "spectrogram": visualize.spectrogram(mono, clip.plan),
        "response_curve": visualize.response_curve(result.response, clip.plan),
        "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
    }


def compare_filters(clip: Clip, request: FilterRequest) -> dict:
    """Score every filter type against the same clip, sharing the user's settings.

    The band edges and gate controls the user has chosen carry across, so the
    comparison answers a practical question: given these settings, which
    approach helps most on this particular recording.
    """
    started = time.perf_counter()
    entries = []

    for kind in filters.FILTER_KINDS:
        candidate = request.model_copy(update={"kind": kind})
        settings_obj = _to_settings(candidate)
        result = filters.apply_filter(
            clip.audio.samples, clip.audio.sample_rate, clip.plan, settings_obj, clip.segments
        )
        mono = np.atleast_2d(result.audio).mean(axis=0).astype(np.float32)
        measured = metrics.measure(mono, clip.segments)
        entries.append(
            {
                "kind": kind,
                "label": FILTER_LABELS[kind],
                "snr_db": round(measured["snr_db"], 2),
                "snr_delta_db": round(measured["snr_db"] - clip.baseline["snr_db"], 2),
                "noise_floor_dbfs": round(measured["noise_floor_dbfs"], 2),
                "signal_level_dbfs": round(measured["signal_level_dbfs"], 2),
                "settings": candidate.model_dump(),
            }
        )

    return {
        "baseline_snr_db": round(clip.baseline["snr_db"], 2),
        "reliable": clip.segments.reliable,
        "entries": entries,
        "elapsed_ms": round((time.perf_counter() - started) * 1000.0, 2),
    }
