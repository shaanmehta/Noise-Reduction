"""A synthetic demonstration clip, generated on demand.

The clip is produced entirely from oscillators and pseudorandom noise with a
fixed seed, so it carries no recording of anyone and needs no licensing. It is
built to exercise the filters: a voiced, speech-like source with clear pauses,
sitting in a bed of broadband hiss, mains hum and low rumble.
"""

from __future__ import annotations

import numpy as np

SAMPLE_RATE = 44_100
DURATION = 4.5
SEED = 20240517

# Resonances that give the harmonic stack a vowel-like colour, in Hz.
FORMANTS = ((620.0, 90.0, 1.0), (1180.0, 110.0, 0.7), (2620.0, 180.0, 0.35))

# Start time, length and pitch of each spoken-sounding burst, in seconds and Hz.
SYLLABLES = (
    (0.55, 0.30, 132.0),
    (0.95, 0.22, 148.0),
    (1.28, 0.38, 118.0),
    (2.05, 0.26, 140.0),
    (2.42, 0.30, 126.0),
    (2.85, 0.20, 154.0),
    (3.45, 0.42, 112.0),
)


def _formant_gain(frequencies: np.ndarray) -> np.ndarray:
    """Resonant envelope applied across the harmonic series."""
    gain = np.zeros_like(frequencies)
    for centre, bandwidth, weight in FORMANTS:
        gain += weight / (1.0 + ((frequencies - centre) / bandwidth) ** 2)
    return gain


def _syllable(duration: float, f0: float, rng: np.random.Generator) -> np.ndarray:
    """One voiced burst: a harmonic stack under a smooth amplitude envelope."""
    n = int(duration * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE

    # Pitch drifts downward slightly across the burst, with a little vibrato.
    contour = f0 * (1.0 - 0.08 * t / max(duration, 1e-6))
    contour *= 1.0 + 0.012 * np.sin(2.0 * np.pi * 5.2 * t)
    phase = 2.0 * np.pi * np.cumsum(contour) / SAMPLE_RATE

    signal = np.zeros(n)
    n_harmonics = int(6000 / f0)
    for harmonic in range(1, n_harmonics + 1):
        amplitude = _formant_gain(np.array([harmonic * f0]))[0] / harmonic**0.5
        if amplitude < 0.005:
            continue
        signal += amplitude * np.sin(harmonic * phase + rng.uniform(0, 2 * np.pi))

    # Raised-cosine attack and release so bursts do not click.
    envelope = np.ones(n)
    ramp = max(1, int(0.025 * SAMPLE_RATE))
    fade = 0.5 - 0.5 * np.cos(np.pi * np.linspace(0, 1, ramp))
    envelope[:ramp] *= fade
    envelope[-ramp:] *= fade[::-1]
    envelope *= 1.0 - 0.25 * (t / max(duration, 1e-6))

    peak = float(np.max(np.abs(signal))) or 1.0
    return signal / peak * envelope


def generate_sample() -> tuple[np.ndarray, int]:
    """Return (clean_plus_noise, sample_rate) for the demonstration clip."""
    rng = np.random.default_rng(SEED)
    n = int(DURATION * SAMPLE_RATE)
    t = np.arange(n) / SAMPLE_RATE
    voice = np.zeros(n)

    for start, length, f0 in SYLLABLES:
        burst = _syllable(length, f0, rng)
        offset = int(start * SAMPLE_RATE)
        end = min(n, offset + burst.size)
        voice[offset:end] += burst[: end - offset] * rng.uniform(0.75, 1.0)

    # Broadband hiss, tilted so the energy sits above the voiced band.
    hiss = rng.standard_normal(n)
    hiss = np.convolve(hiss, np.array([1.0, -0.72]), mode="same")
    hiss /= float(np.max(np.abs(hiss))) or 1.0

    # Mains hum with a couple of harmonics, plus slow rumble.
    hum = sum(
        amplitude * np.sin(2.0 * np.pi * frequency * t + phase)
        for frequency, amplitude, phase in ((50.0, 1.0, 0.0), (100.0, 0.45, 1.1), (150.0, 0.2, 2.3))
    )
    hum /= float(np.max(np.abs(hum))) or 1.0
    rumble = np.sin(2.0 * np.pi * 32.0 * t) * (0.6 + 0.4 * np.sin(2.0 * np.pi * 0.7 * t))

    mixture = 0.62 * voice + 0.055 * hiss + 0.035 * hum + 0.02 * rumble
    peak = float(np.max(np.abs(mixture))) or 1.0
    return (mixture / peak * 0.89).astype(np.float32), SAMPLE_RATE
