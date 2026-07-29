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



