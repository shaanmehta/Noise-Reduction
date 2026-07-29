"""Decoding uploaded audio and encoding results, entirely in memory.

Nothing is written to disk. Uploads arrive as bytes, are decoded to a float
array, and leave as WAV bytes. The only exception is the ffmpeg fallback for
container formats libsndfile cannot open, which streams through a pipe rather
than a temporary file.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass

import numpy as np
import soundfile as sf

from ..errors import AudioError

# Anything above this is resampled down. 48 kHz preserves the full audible
# band and keeps transform sizes predictable.
MAX_SAMPLE_RATE = 48_000
MIN_SAMPLE_RATE = 4_000
MAX_CHANNELS = 2

SUPPORTED_EXTENSIONS = (".wav", ".mp3", ".flac", ".ogg", ".oga", ".m4a", ".aac", ".aiff", ".aif")


@dataclass
class DecodedAudio:
    """Decoded PCM, shaped (channels, samples), float32 in roughly [-1, 1]."""

    samples: np.ndarray
    sample_rate: int
    original_sample_rate: int
    original_channels: int
    source_format: str

    @property
    def channels(self) -> int:
        return int(self.samples.shape[0])

    @property
    def n_samples(self) -> int:
        return int(self.samples.shape[1])

    @property
    def duration(self) -> float:
        return self.n_samples / self.sample_rate

    def mixdown(self) -> np.ndarray:
        """Mono view used for analysis and display."""
        return self.samples.mean(axis=0).astype(np.float32)


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _probe(path: str) -> tuple[int, int]:
    """Sample rate and channel count of the first audio stream."""
    command = [
        "ffprobe",
        "-hide_banner",
        "-loglevel",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate,channels",
        "-of",
        "json",
        path,
    ]
    completed = subprocess.run(command, capture_output=True, timeout=30, check=False)
    if completed.returncode != 0:
        raise AudioError("That file could not be recognised as audio.")
    streams = json.loads(completed.stdout or b"{}").get("streams") or []
    if not streams:
        raise AudioError("That file contains no audio track.")
    try:
        return int(streams[0]["sample_rate"]), int(streams[0]["channels"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AudioError("That file's audio track could not be read.") from exc


def _decode_with_ffmpeg(payload: bytes) -> tuple[np.ndarray, int, int]:
    """Fallback decoder for formats libsndfile declines to open.

    Input goes through a temporary file because seekable containers such as
    MP4 cannot be demuxed from a pipe, and the file is removed as soon as
    decoding finishes. Output is raw little-endian float rather than WAV,
    because ffmpeg cannot backfill a RIFF length field on a pipe and writes a
    placeholder that decoders reject.
    """
    if not _ffmpeg_available():
        raise AudioError(
            "That audio format could not be read. Try converting the file to WAV or MP3."
        )

    handle, temp_path = tempfile.mkstemp(prefix="nr-decode-")
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(payload)

        rate, channels = _probe(temp_path)
        channels = max(1, min(channels, MAX_CHANNELS))
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            temp_path,
            "-map",
            "0:a:0",
            "-ac",
            str(channels),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "pipe:1",
        ]
        try:
            completed = subprocess.run(command, capture_output=True, timeout=120, check=False)
        except subprocess.TimeoutExpired as exc:
            raise AudioError("Decoding that file took too long. Try a shorter clip.") from exc
        if completed.returncode != 0 or not completed.stdout:
            raise AudioError("That file could not be decoded as audio.")

        flat = np.frombuffer(completed.stdout, dtype="<f4")
        usable = flat.size - (flat.size % channels)
        data = flat[:usable].reshape(-1, channels).astype(np.float32)
        return data, int(rate), channels
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def _resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    import librosa

    return np.ascontiguousarray(
        librosa.resample(samples, orig_sr=source_rate, target_sr=target_rate, res_type="soxr_hq"),
        dtype=np.float32,
    )


def decode(payload: bytes, filename: str = "") -> DecodedAudio:
    """Decode arbitrary uploaded bytes into a normalised float array."""
    if not payload:
        raise AudioError("The uploaded file was empty.")

    source_format = "unknown"
    data: np.ndarray | None = None
    rate = 0
    original_channels = 0
    try:
        with sf.SoundFile(io.BytesIO(payload)) as handle:
            source_format = handle.format.lower()
        decoded, decoded_rate = sf.read(io.BytesIO(payload), dtype="float32", always_2d=True)
        # libsndfile will open some container formats it cannot actually decode
        # and hand back an empty buffer instead of raising, so an empty result
        # counts as a failure and falls through to ffmpeg.
        if decoded.size:
            data, rate = decoded, int(decoded_rate)
            original_channels = int(decoded.shape[1])
    except Exception:
        data = None

    if data is None:
        data, rate, original_channels = _decode_with_ffmpeg(payload)
        suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        source_format = suffix or "unknown"

    if data.size == 0:
        raise AudioError("That file contains no audio samples.")
    if rate < MIN_SAMPLE_RATE:
        raise AudioError("That file's sample rate is too low to process.")

    # (samples, channels) to (channels, samples).
    samples = np.ascontiguousarray(data.T, dtype=np.float32)

    if samples.shape[0] > MAX_CHANNELS:
        # Fold surround layouts down to stereo by splitting channels evenly.
        half = samples.shape[0] // 2
        samples = np.stack([samples[:half].mean(axis=0), samples[half:].mean(axis=0)])

    original_rate = int(rate)
    target_rate = min(original_rate, MAX_SAMPLE_RATE)
    if target_rate != original_rate:
        samples = _resample(samples, original_rate, target_rate)

    samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 1.0:
        samples = samples / peak

    if samples.shape[1] < 512:
        raise AudioError("That clip is too short to analyse. Use at least half a second of audio.")

    return DecodedAudio(
        samples=samples,
        sample_rate=int(target_rate),
        original_sample_rate=original_rate,
        original_channels=original_channels,
        source_format=source_format,
    )


def encode_wav(samples: np.ndarray, sample_rate: int, subtype: str = "PCM_16") -> bytes:
    """Encode a (channels, samples) array as WAV bytes."""
    channels = np.atleast_2d(samples)
    interleaved = np.ascontiguousarray(channels.T, dtype=np.float32)
    peak = float(np.max(np.abs(interleaved))) if interleaved.size else 0.0
    if peak > 1.0:
        interleaved = interleaved / peak
    buffer = io.BytesIO()
    sf.write(buffer, interleaved, sample_rate, subtype=subtype, format="WAV")
    return buffer.getvalue()
