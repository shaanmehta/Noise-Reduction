# NoiseReduce

An application for reducing noise in audio using short-time Fourier transform (STFT) filtering, with signal-to-noise measurement of the result.

Upload a recording, choose a filtering approach, adjust its parameters against live waveform and spectrogram views, compare the processed audio against the original, and download the results.

Click the link to access the online application: https://noisereduce-mry9.onrender.com/

## What it does

Audio is transformed into a time-frequency representation, a gain is applied across that representation, and the result is transformed back into a waveform. Four approaches are available:

Spectral Gate: Splits audio into frequency bins and mutes/passes specific bands.
Low-Pass: Keeps content below a cutoff.
High-Pass: Keeps content above a cutoff.
Band-Pass: Keeps a single band and rejects both extremes.

### Measurement

Signal-to-noise ratio is computed without any manual marking of where the noise is. The application locates a low-energy reference window and a high-energy reference window by analysing frame energy across the clip, then measures both the original and the processed audio over those same sample ranges. The before/after figures describe the same instants and are directly comparable. Noise power is subtracted from the signal window before the ratio is taken.

A comparison view runs all four filters against the loaded clip and reports the change each one produces, computed live for that recording.

## Stack

**Backend** — Python 3.12, FastAPI, uvicorn. Signal processing with NumPy, SciPy and librosa; audio encoding and decoding with soundfile, falling back to ffmpeg for container formats libsndfile cannot open.

**Frontend** — React 19 with TypeScript, built by Vite. Hand-written CSS with no UI framework. Waveform and spectrogram rendering is done on canvas from numeric data sent by the API, and the filter response curve is drawn as SVG.

**Formats** — WAV, MP3, FLAC, OGG, M4A, AAC and AIFF, in mono or stereo, at any sample rate. Files above 48 kHz are resampled down; stereo is processed per channel.

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

## Deployment

The Dockerfile builds the frontend and serves it from the same process as the API, so the whole application is one container on one origin and needs no CORS configuration.

Run that image locally:

```bash
docker compose up --build
```

## File Size Limit
Exceeding a host's memory limit does not surface as an error. The container is killed and the visitor gets a dead page, which is why the deployed limits are set from measurement (30 seconds / 10 MB)
