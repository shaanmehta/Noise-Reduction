"""HTTP surface.

Handlers stay thin: validate, enforce limits, hand the work to a thread, and
translate any failure into a message a visitor can act on. No handler ever
returns a traceback, a library error string, or a filesystem path.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import memory, service, warmup
from .config import settings
from .dsp.audio_io import SUPPORTED_EXTENSIONS
from .errors import AppError, LimitError, ProcessingTimeout
from .limits import client_key, limiter
from .schemas import ClipResponse, CompareResponse, FilterRequest, ProcessResponse
from .store import store

logger = logging.getLogger("noisereduce")

# librosa and numpy release the GIL for the heavy parts, so a small pool keeps
# one slow job from blocking the event loop. The size is capped by
# configuration rather than by CPU count: the limit here is memory, not
# processor time, and a many-core host would otherwise run enough concurrent
# jobs to exhaust a small instance.
executor = ThreadPoolExecutor(
    max_workers=max(1, min(settings.dsp_workers, os.cpu_count() or 2)),
    thread_name_prefix="dsp",
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    # Compile and import everything the processing stack needs before a visitor
    # can be the one waiting for it.
    warmup.start_background()
    yield
    executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(
    title="NoiseReduce",
    description="STFT-based noise reduction and signal-to-noise measurement for uploaded audio.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=3600,
)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(Exception)
async def handle_unexpected(_: Request, exc: Exception) -> JSONResponse:
    # Logged in full for the operator, summarised for the visitor.
    logger.exception("unhandled error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong while processing that audio. Please try again."},
    )


def _run_and_release(function, *args):
    """Run a job, then hand its freed memory back to the operating system.

    Without this, resident memory ratchets upward across requests as the
    allocator retains what each job released, which matters on a host with a
    fixed memory ceiling.
    """
    try:
        return function(*args)
    finally:
        memory.release()


async def _run(function, *args):
    """Execute a blocking job with a hard time limit."""
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(executor, _run_and_release, function, *args),
            timeout=settings.processing_timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise ProcessingTimeout(
            "Processing took too long and was stopped. Try a shorter clip."
        ) from exc


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "store": store.stats(),
        "releases_memory": memory.can_release,
        "warm": warmup.is_ready(),
    }


@app.get("/api/config")
async def config() -> dict:
    """Limits the client should enforce before attempting an upload."""
    return {
        "max_upload_bytes": settings.max_upload_bytes,
        "max_duration_seconds": settings.max_duration_seconds,
        "supported_extensions": list(SUPPORTED_EXTENSIONS),
    }


@app.post("/api/clips", response_model=ClipResponse)
async def create_clip(request: Request, file: UploadFile = File(...)) -> dict:
    limiter.check(
        f"upload:{client_key(request)}", settings.upload_rate, settings.upload_window_seconds
    )

    payload = await file.read(settings.max_upload_bytes + 1)
    if len(payload) > settings.max_upload_bytes:
        megabytes = settings.max_upload_bytes / (1024 * 1024)
        raise LimitError(f"That file is larger than the {megabytes:.0f} MB limit.")

    clip = await _run(service.build_clip, payload, file.filename or "clip")
    return service.clip_payload(clip)


@app.post("/api/clips/sample", response_model=ClipResponse)
async def create_sample_clip(request: Request) -> dict:
    limiter.check(
        f"upload:{client_key(request)}", settings.upload_rate, settings.upload_window_seconds
    )
    clip = await _run(service.build_sample_clip)
    return service.clip_payload(clip)


@app.get("/api/clips/{clip_id}", response_model=ClipResponse)
async def read_clip(clip_id: str) -> dict:
    return service.clip_payload(store.get(clip_id))


@app.post("/api/clips/{clip_id}/process", response_model=ProcessResponse)
async def process(request: Request, clip_id: str, body: FilterRequest) -> dict:
    limiter.check(
        f"process:{client_key(request)}", settings.process_rate, settings.process_window_seconds
    )
    clip = store.get(clip_id)
    return await _run(service.process_clip, clip, body)


@app.post("/api/clips/{clip_id}/compare", response_model=CompareResponse)
async def compare(request: Request, clip_id: str, body: FilterRequest) -> dict:
    limiter.check(
        f"process:{client_key(request)}", settings.process_rate, settings.process_window_seconds
    )
    clip = store.get(clip_id)
    return await _run(service.compare_filters, clip, body)


RANGE_PATTERN = re.compile(r"bytes=(\d*)-(\d*)")


def _audio_response(payload: bytes, filename: str, request: Request) -> Response:
    """Serve audio with byte-range support.

    Range support is what makes a media element seekable. Without it the
    browser reports an empty seekable range and silently ignores every attempt
    to set currentTime, which breaks the scrub bar and stops playback position
    carrying across when the listener switches between source and processed.
    """
    total = len(payload)
    headers = {
        "Content-Disposition": f'inline; filename="{filename}"',
        "Cache-Control": "private, max-age=600",
        "Accept-Ranges": "bytes",
    }

    match = RANGE_PATTERN.fullmatch((request.headers.get("range") or "").strip())
    if match:
        start_text, end_text = match.groups()
        if not start_text and not end_text:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else total - 1
        else:
            # A suffix range asks for the final N bytes.
            start = max(0, total - int(end_text))
            end = total - 1
        if start >= total:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{total}"})
        end = min(end, total - 1)
        chunk = payload[start : end + 1]
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
        return Response(content=chunk, status_code=206, media_type="audio/wav", headers=headers)

    return Response(content=payload, media_type="audio/wav", headers=headers)


@app.get("/api/clips/{clip_id}/audio/original.wav")
async def original_audio(clip_id: str, request: Request) -> Response:
    clip = store.get(clip_id)
    return _audio_response(clip.original_bytes, "original.wav", request)


@app.get("/api/clips/{clip_id}/renders/{render_id}.wav")
async def render_audio(clip_id: str, render_id: str, request: Request) -> Response:
    # Named the same way the browser download is, so saving the file from the
    # player or straight from the URL gives an identical result.
    clip = store.get(clip_id)
    return _audio_response(store.get_render(clip, render_id), "Processed-Audio.wav", request)


# Serving the built frontend from the same process is what makes the single
# container deployment possible. Mounted last so it never shadows /api.
if settings.static_dir and os.path.isdir(settings.static_dir):
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="static")
