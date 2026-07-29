"""Short-lived in-memory storage for decoded uploads.

Holding the decoded array between requests is what makes the parameter sliders
feel immediate: the client sends settings, not audio, on every change. The
trade-off is that the store is process-local, so the service is designed to run
as a single worker. Entries expire on a timer and are evicted under memory
pressure; nothing touches the filesystem and nothing survives a restart.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field

from .config import settings
from .dsp.audio_io import DecodedAudio
from .dsp.metrics import Segmentation
from .dsp.stft import StftPlan
from .errors import SessionError


@dataclass
class Render:
    """One processed result, kept only so the browser can fetch the audio."""

    audio_bytes: bytes
    created_at: float = field(default_factory=time.monotonic)


@dataclass
class Clip:
    """A decoded upload plus everything derived from it that is reused."""

    clip_id: str
    audio: DecodedAudio
    plan: StftPlan
    segments: Segmentation
    baseline: dict
    original_bytes: bytes
    visuals: dict
    filename: str
    created_at: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)
    renders: OrderedDict[str, Render] = field(default_factory=OrderedDict)

    @property
    def size_bytes(self) -> int:
        return (
            int(self.audio.samples.nbytes)
            + len(self.original_bytes)
            + sum(len(render.audio_bytes) for render in self.renders.values())
        )


class ClipStore:
    """Thread-safe LRU store with a time-to-live and a byte ceiling."""

    def __init__(self) -> None:
        self._clips: OrderedDict[str, Clip] = OrderedDict()
        self._lock = threading.Lock()

    def _expired(self, clip: Clip, now: float) -> bool:
        return now - clip.last_seen > settings.clip_ttl_seconds

    def _evict(self) -> None:
        """Drop expired entries, then oldest entries until limits are met."""
        now = time.monotonic()
        for clip_id in [cid for cid, clip in self._clips.items() if self._expired(clip, now)]:
            self._clips.pop(clip_id, None)

        while len(self._clips) > settings.max_clips:
            self._clips.popitem(last=False)

        while self._clips and sum(clip.size_bytes for clip in self._clips.values()) > settings.max_store_bytes:
            self._clips.popitem(last=False)

    def put(self, clip: Clip) -> None:
        with self._lock:
            self._clips[clip.clip_id] = clip
            self._clips.move_to_end(clip.clip_id)
            self._evict()

    def get(self, clip_id: str) -> Clip:
        with self._lock:
            clip = self._clips.get(clip_id)
            if clip is None or self._expired(clip, time.monotonic()):
                self._clips.pop(clip_id, None)
                raise SessionError(
                    "That upload is no longer available. Upload the file again to continue."
                )
            clip.last_seen = time.monotonic()
            self._clips.move_to_end(clip_id)
            return clip

    def add_render(self, clip: Clip, audio_bytes: bytes) -> str:
        render_id = secrets.token_urlsafe(12)
        with self._lock:
            clip.renders[render_id] = Render(audio_bytes=audio_bytes)
            clip.renders.move_to_end(render_id)
            while len(clip.renders) > settings.max_renders_per_clip:
                clip.renders.popitem(last=False)
            self._evict()
        return render_id

    def get_render(self, clip: Clip, render_id: str) -> bytes:
        with self._lock:
            render = clip.renders.get(render_id)
            if render is None:
                raise SessionError("That processed result has expired. Adjust a control to rebuild it.")
            clip.renders.move_to_end(render_id)
            return render.audio_bytes

    def stats(self) -> dict:
        with self._lock:
            return {
                "clips": len(self._clips),
                "bytes": sum(clip.size_bytes for clip in self._clips.values()),
            }


store = ClipStore()


def new_clip_id() -> str:
    return secrets.token_urlsafe(16)
