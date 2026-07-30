# NoiseReduce

A web application for reducing noise in audio using short-time Fourier transform (STFT) filtering, with signal-to-noise measurement of the result.

Upload a recording, choose a filtering approach, adjust its parameters against live waveform and spectrogram views, compare the processed audio against the original, and download the result. Every measurement is computed from the audio you provide.

## What it does

Audio is transformed into a time-frequency representation, a gain is applied across that representation, and the result is transformed back into a waveform. Four approaches are available:

| Filter | Behaviour |
| --- | --- |
| Spectral gate | Estimates the noise floor per frequency band from the quiet parts of the recording, then attenuates bands that fall back to it. Removes steady background noise without cutting a band away wholesale. |
| Low pass | Keeps content below a cutoff. Targets hiss and other high-frequency noise. |
| High pass | Keeps content above a cutoff. Targets rumble, handling noise and mains hum. |
| Band pass | Keeps a single band and rejects both extremes. |

### Measurement

Signal-to-noise ratio is computed without any manual marking of where the noise is. The application locates a low-energy reference window and a high-energy reference window by analysing frame energy across the clip, then measures both the original and the processed audio over those same sample ranges, so the before and after figures describe the same instants and are directly comparable. Noise power is subtracted from the signal window before the ratio is taken.

When a clip contains no genuinely quiet passage there is no honest noise reference available. The application detects this and marks the figures as indicative rather than presenting a number it cannot support.

A comparison view runs all four filters against the loaded clip and reports the change each one produces, computed live for that recording.

## Stack

**Backend** — Python 3.12, FastAPI, uvicorn. Signal processing with NumPy, SciPy and librosa; audio encoding and decoding with soundfile, falling back to ffmpeg for container formats libsndfile cannot open.

**Frontend** — React 19 with TypeScript, built by Vite. Hand-written CSS with no UI framework. Waveform and spectrogram rendering is done on canvas from numeric data sent by the API, and the filter response curve is drawn as SVG.

**Formats** — WAV, MP3, FLAC, OGG, M4A, AAC and AIFF, in mono or stereo, at any sample rate. Files above 48 kHz are resampled down; stereo is processed per channel.

## Repository layout

```
backend/
  app/
    dsp/            signal processing: transform, filters, metrics, decoding, sample generation
    main.py         HTTP routes and error handling
    service.py      application logic between the API and the DSP layer
    store.py        in-memory clip store with TTL and eviction
    limits.py       per-client rate limiting
    config.py       environment-driven configuration
    schemas.py      request and response models
  tests/            test suite, including regression tests for known DSP failure modes
frontend/
  src/
    components/     interface components
    hooks/          A/B playback, input debouncing
    lib/            API client, formatting, theme, filter definitions
    styles/         stylesheet
Dockerfile          single-image build serving API and frontend together
```

## Running locally

Requirements: Python 3.11 or newer, Node 20 or newer, and ffmpeg on the path for MP4-family formats.

**Backend**

```bash
python3 -m venv .venv && ./.venv/bin/pip install -r backend/requirements.txt
```

```bash
cd backend && ../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

**Frontend**, in a second terminal:

```bash
cd frontend && npm install && npm run dev
```

### Tests

```bash
./.venv/bin/pip install -r backend/requirements-dev.txt && cd backend && ../.venv/bin/python -m pytest
```

## Deployment

The Dockerfile builds the frontend and serves it from the same process as the API, so the whole application is one container on one origin and needs no CORS configuration.

Run that image locally:

```bash
docker compose up --build
```

### What this service needs from a host

Two properties decide where this can run.

The installed dependency set is about 400 MB, because librosa pulls in numba and llvmlite. That is past the 250 MB bundle ceiling on every serverless platform, so a host that runs containers is required. Vercel, Netlify and Lambda cannot serve this backend.

Memory is the binding constraint, and it scales with the length of the clip being processed rather than with traffic. Peak resident memory, sustained across repeated requests at the worst case of stereo audio at 48 kHz:

| Longest clip allowed | Peak memory | Spare against 512 MB |
| --- | --- | --- |
| Idle, imports loaded | 117 MB | |
| 15 s | 431 MB, settled | 81 MB |
| 30 s, stereo throughout | 500 MB, still climbing | 12 MB |
| 30 s, folded to mono | 411 MB first request | 101 MB |
| 60 s | 520 MB | over the ceiling |
| 120 s | 929 MB | far over |

Exceeding a host's memory limit does not surface as an error. The container is killed and the visitor gets a dead page, which is why the deployed limits are set from measurement rather than optimism.

Each concurrent job multiplies these figures, which is why `DSP_WORKERS` exists.

Run exactly one instance. Decoded clips live in a single process's memory, so a second instance would receive clip identifiers it has never seen and reject them.

### Render

`render.yaml` configures a free Render service. In the dashboard choose **Blueprints**, create a new Blueprint Instance, and point it at this repository. Nothing needs configuring by hand.

The blueprint caps uploads at **30 seconds and 10 MB**, holds at most two clips, and runs a single processing worker. Longer uploads are refused with a plain message instead of taking the service down.

Thirty seconds only fits because of `MAX_PROCESSING_SAMPLES`. Once a clip grows past that budget it is folded to mono, which halves a stereo recording while keeping its full frequency range. For noise reduction that is a cheaper loss than trimming the top of the spectrum, and it takes a 30 second stereo clip from 500 MB down to 411 MB. Clips short enough to fit the budget keep their channels untouched, and the interface says when a recording has been folded.

One caveat is worth stating plainly. Under sustained load, resident memory drifts slowly upward as the allocator retains what each job frees. `app/memory.py` hands that memory back after every job, which works on Linux as Render runs, but this was developed on macOS where the mechanism does not exist and so the benefit could not be measured. If the service restarts under load, check the Render logs for an out-of-memory kill and drop `MAX_DURATION_SECONDS` to 20.

The free instance also provides roughly a tenth of a CPU, so each filter change takes a few seconds rather than the fraction of a second it takes locally. The interface debounces slider input and shows a progress sweep while it waits.

Free instances sleep after about fifteen minutes of inactivity. The first visit afterwards waits through a cold start, and anything held in memory is gone, which a visitor sees as an expired upload.

To lift the limits, move to a paid instance and raise `MAX_DURATION_SECONDS`, `MAX_STORE_BYTES` and `DSP_WORKERS` together, then measure again.

### Configuration

Every backend setting is an environment variable with a working default. See `.env.example` for the full list, covering upload limits, clip retention, rate limits, worker count and the processing timeout.

Uploaded audio never reaches the deployed image. The Dockerfile copies only `backend/app`, `backend/requirements.txt` and the built frontend, and `.dockerignore` excludes audio at every depth. The demonstration clip the API can generate is synthesised from oscillators and noise at request time, so no recording is shipped.
