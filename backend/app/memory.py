"""Returning freed memory to the operating system after a processing job.

Filtering a clip allocates and frees several large arrays. Python frees them
promptly, but glibc keeps much of that space on its own heap rather than
handing it back, so resident memory ratchets upward across requests even
though nothing is leaking. On a host with a hard memory ceiling that ratchet
is the difference between running and being killed.

`malloc_trim` asks glibc to release what it is holding. It exists only on
glibc systems, so everywhere else this degrades to a plain garbage collection.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import gc
import logging
import platform

logger = logging.getLogger("noisereduce")


def _load_malloc_trim():
    """Resolve glibc's malloc_trim, or None where it is unavailable."""
    if platform.system() != "Linux":
        return None
    try:
        name = ctypes.util.find_library("c") or "libc.so.6"
        libc = ctypes.CDLL(name)
        trim = libc.malloc_trim
        trim.argtypes = [ctypes.c_size_t]
        trim.restype = ctypes.c_int
        return trim
    except (OSError, AttributeError):
        # Not glibc, or the symbol is absent. Neither is a problem.
        return None


_malloc_trim = _load_malloc_trim()

# Whether the platform can actually return memory, exposed for the health
# endpoint so an operator can tell which behaviour they are getting.
can_release = _malloc_trim is not None


def release() -> None:
    """Collect garbage and hand any freed heap back to the operating system."""
    gc.collect()
    if _malloc_trim is not None:
        try:
            _malloc_trim(0)
        except Exception:  # pragma: no cover - defensive, never worth failing a request
            logger.debug("malloc_trim failed", exc_info=True)
