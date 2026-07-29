"""Per-client rate limiting.

A sliding window counter kept in process memory. This is deliberately simple:
it is enough to stop one client from monopolising a small free-tier instance,
and it needs no external store. Behind a load balancer it limits per worker,
which is acceptable for the traffic profile this service is sized for.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from .errors import RateLimitError


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def _sweep(self, now: float, window: float) -> None:
        """Drop clients with no recent activity so the map cannot grow forever."""
        if now - self._last_sweep < 60.0:
            return
        self._last_sweep = now
        for key in [k for k, hits in self._hits.items() if not hits or now - hits[-1] > window]:
            self._hits.pop(key, None)

    def check(self, key: str, limit: int, window: float) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(window - (now - hits[0])))
                raise RateLimitError(
                    f"Too many requests. Try again in about {retry_after} seconds."
                )
            hits.append(now)
            self._sweep(now, window)


limiter = SlidingWindowLimiter()


def client_key(request) -> str:
    """Identify the caller, preferring the proxy-forwarded address."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
