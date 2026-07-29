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

The three band filters offer a choice of roll-off: a Butterworth magnitude response (flat passband, smooth monotonic slope), a raised-cosine taper of adjustable width, or an abrupt cutoff included for comparison, since the audible ringing it produces is the reason the other two exist.

### Measurement

Signal-to-noise ratio is computed without any manual marking of where the noise is. The application locates a low-energy reference window and a high-energy reference window by analysing frame energy across the clip, then measures both the original and the processed audio over those same sample ranges, so the before and after figures describe the same instants and are directly comparable. Noise power is subtracted from the signal window before the ratio is taken.

When a clip contains no genuinely quiet passage there is no honest noise reference available. The application detects this and marks the figures as indicative rather than presenting a number it cannot support.

A comparison view runs all four filters against the loaded clip and reports the change each one produces, computed live for that recording.

## Tech stack

**Backend** — Python 3.12, FastAPI, uvicorn. Signal processing with NumPy, SciPy and librosa; audio encoding and decoding with soundfile, falling back to ffmpeg for container formats libsndfile cannot open.

**Frontend** — React 19 with TypeScript, built by Vite. Hand-written CSS with no UI framework. Waveform and spectrogram rendering is done on canvas from numeric data sent by the API, and the filter response curve is drawn as SVG.

**Formats** — WAV, MP3, FLAC, OGG, M4A, AAC and AIFF, in mono or stereo, at any sample rate. Files above 48 kHz are resampled down; stereo is processed per channel.

### Handling of uploaded audio

Uploaded audio is decoded in memory and held in a process-local store with a time-to-live, then evicted. Nothing is written to a database or to persistent storage, and nothing survives a restart. The only disk contact is a short-lived temporary file used when a file has to be handed to ffmpeg, removed as soon as decoding completes.

Because decoded clips live in the memory of one process, the service is designed to run as a single worker. Running multiple workers without sticky sessions will produce "upload no longer available" errors, as a clip identifier issued by one worker is unknown to the others.

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

Open http://localhost:5173. The dev server proxies `/api` to port 8000, so development runs same-origin and needs no CORS configuration.

### Tests

```bash
./.venv/bin/pip install -r backend/requirements-dev.txt && cd backend && ../.venv/bin/python -m pytest
```

The suite covers the transform round trip across sample rates, cutoff placement, noise-window frame indexing, roll-off shape, stereo handling, decoding, and the behaviour of the SNR measurement as input noise varies.

## Deployment

### Single container

The Dockerfile builds the frontend and serves it from the same process as the API. One origin means no CORS configuration is required.

```bash
docker compose up --build
```

Then open http://localhost:8000.

To deploy on Fly.io, edit the `app` name and `ALLOWED_ORIGINS` in `fly.toml` to a name of your own, then:

```bash
fly launch --copy-config --no-deploy && fly deploy && fly scale count 1
```

`fly scale count 1` is not optional. Decoded clips live in one machine's memory, so a second machine would receive clip identifiers it has never seen and reject them.

On Render or Railway, create a service from the repository, select the Docker environment, set the health check path to `/api/health`, and keep the instance count at one. No environment variables are required for a same-origin deployment; set `ALLOWED_ORIGINS` to the public URL if you later split the frontend out.

Uploaded audio never reaches the deployed image. The Dockerfile copies only `backend/app`, `backend/requirements.txt` and the built frontend, and `.dockerignore` excludes audio at every depth. The demonstration clip is synthesised at runtime from oscillators and noise, so no recording of any kind is shipped.

Size the instance for memory rather than CPU: processing is fast, but decoded clips are held in memory. The defaults in `app/config.py` cap the store at 512 MB, which suits a 1 GB instance. On a 512 MB instance, lower `MAX_STORE_BYTES` and `MAX_CLIPS`.

### Split deployment

To host the frontend on a static platform such as Vercel or Netlify and the backend separately:

1. Deploy the backend from the Dockerfile, or run `uvicorn app.main:app` directly, leaving `STATIC_DIR` unset.
2. Set `ALLOWED_ORIGINS` on the backend to the frontend's public URL, comma-separated if there is more than one.
3. Build the frontend with `VITE_API_BASE_URL` set to the backend's public URL. Root directory `frontend`, build command `npm run build`, output directory `dist`.

Check the platform's own request body limit against `MAX_UPLOAD_BYTES` and its request timeout against `PROCESSING_TIMEOUT_SECONDS`; the lower of each pair is what applies. Platforms that idle containers to sleep will drop in-memory clips on wake, which surfaces to the user as an expired upload.

### Configuration

All backend settings are environment variables with working defaults. See `.env.example` for the full list, covering upload limits, clip retention, rate limits and the processing timeout.

## Abuse protection

Uploads are capped by both file size and audio duration. Upload and processing requests are rate limited per client address over a sliding window. Every processing job runs under a timeout. Errors are returned as plain messages written for a reader; internal paths, library errors and tracebacks are logged for the operator and never sent to the client.

## Credit

<!-- Add your name and a link here if you want the project attributed. -->

## Licence

<!-- Add a licence here. MIT is a common choice for a project like this. -->
