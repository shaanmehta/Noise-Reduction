"""Tests for the signal processing layer.

Several of these exist specifically to pin down defects that were present in
the original scripts this project grew out of, so that they cannot return.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.dsp import audio_io, filters, metrics, visualize
from app.dsp.sample import generate_sample
from app.dsp.stft import forward, inverse, plan_stft


def band_energy(signal: np.ndarray, sample_rate: int, centre: float, halfwidth: float = 40.0) -> float:
    n = 1 << int(np.ceil(np.log2(max(len(signal), 2))))
    spectrum = np.abs(np.fft.rfft(signal, n=n))
    frequencies = np.fft.rfftfreq(n, d=1.0 / sample_rate)
    selected = (frequencies > centre - halfwidth) & (frequencies < centre + halfwidth)
    return float(np.sum(spectrum[selected] ** 2))


def two_tone(sample_rate: int = 44_100, seconds: float = 2.0) -> np.ndarray:
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    return (0.4 * np.sin(2 * np.pi * 500 * t) + 0.4 * np.sin(2 * np.pi * 8000 * t)).astype(np.float32)


def noisy_speech(sample_rate: int = 22_050, seconds: float = 3.0, seed: int = 3) -> np.ndarray:
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = ((t % 1.0) < 0.45).astype(np.float32)
    voice = envelope * (0.5 * np.sin(2 * np.pi * 240 * t) + 0.2 * np.sin(2 * np.pi * 720 * t))
    return (voice + 0.02 * rng.standard_normal(t.size)).astype(np.float32)


class TestFrequencyMapping:
    def test_bin_frequencies_match_transform_size(self):
        """Bin spacing must be sample_rate / n_fft, not sample_rate / n_bins."""
        plan = plan_stft(44_100)
        frequencies = plan.frequencies

        assert frequencies.size == plan.n_bins
        assert frequencies[0] == pytest.approx(0.0)
        assert frequencies[-1] == pytest.approx(plan.nyquist)
        assert np.diff(frequencies)[0] == pytest.approx(44_100 / plan.n_fft)
        # Monotonic all the way up: no fold-back into negative frequencies.
        assert np.all(np.diff(frequencies) > 0)

    def test_naive_fftfreq_mapping_would_be_wrong(self):
        """Guards the specific miscalculation this project had to correct."""
        plan = plan_stft(44_100)
        naive = np.abs(np.fft.fftfreq(plan.n_bins, d=1.0 / 44_100))

        assert naive[1] == pytest.approx(2 * plan.frequencies[1], rel=1e-3)
        # The naive vector turns back on itself partway up the spectrum.
        assert not np.all(np.diff(naive) > 0)

    @pytest.mark.parametrize(
        "kind,low,high,kept,rejected",
        [
            ("low_pass", 20.0, 2000.0, 500.0, 8000.0),
            ("high_pass", 2000.0, 20_000.0, 8000.0, 500.0),
            ("band_pass", 6000.0, 10_000.0, 8000.0, 500.0),
        ],
    )
    def test_cutoffs_land_where_requested(self, kind, low, high, kept, rejected):
        sample_rate = 44_100
        signal = two_tone(sample_rate)
        plan = plan_stft(sample_rate)
        segments = metrics.detect_segments(signal, sample_rate)
        settings = filters.FilterSettings(
            kind=kind, low_cutoff_hz=low, high_cutoff_hz=high, rolloff="butterworth", order=6
        )

        output = filters.apply_filter(signal, sample_rate, plan, settings, segments).audio

        keep_ratio = band_energy(output, sample_rate, kept) / band_energy(signal, sample_rate, kept)
        drop_ratio = band_energy(output, sample_rate, rejected) / band_energy(signal, sample_rate, rejected)

        assert 10 * np.log10(keep_ratio) > -1.0
        assert 10 * np.log10(drop_ratio + 1e-20) < -40.0


class TestNoiseWindow:
    def test_noise_frames_are_indexed_by_hop_not_sample_rate(self):
        """A duration scaled by the sample rate overshoots the frame count."""
        sample_rate = 22_050
        signal = noisy_speech(sample_rate)
        plan = plan_stft(sample_rate)
        magnitude = np.abs(forward(signal, plan))
        segments = metrics.detect_segments(signal, sample_rate)

        selected = filters._noise_frames(segments, plan, magnitude.shape[1])

        assert magnitude.shape[1] < int(sample_rate * 0.1)
        assert 0 < int(selected.sum()) < magnitude.shape[1]
        assert plan.frames_for_seconds(0.1) == pytest.approx(
            0.1 * sample_rate / plan.hop_length, abs=1
        )

    def test_noise_reference_is_quieter_than_signal_reference(self):
        sample_rate = 22_050
        signal = noisy_speech(sample_rate)
        segments = metrics.detect_segments(signal, sample_rate)

        assert segments.noise.any() and segments.signal.any()
        assert segments.separation_db > 8.0
        assert metrics.rms_dbfs(signal[segments.noise]) < metrics.rms_dbfs(signal[segments.signal])


class TestRolloff:
    def test_smooth_rolloffs_avoid_the_binary_edge(self):
        plan = plan_stft(44_100)
        base = dict(kind="low_pass", high_cutoff_hz=3000.0, order=4, transition_hz=400.0)

        hard = filters.frequency_response(filters.FilterSettings(rolloff="brickwall", **base), plan)
        cosine = filters.frequency_response(filters.FilterSettings(rolloff="cosine", **base), plan)
        butter = filters.frequency_response(
            filters.FilterSettings(rolloff="butterworth", **base), plan
        )

        assert set(np.unique(hard)) <= {0.0, 1.0}
        for smooth in (cosine, butter):
            intermediate = np.sum((smooth > 0.02) & (smooth < 0.98))
            assert intermediate > 5
            assert np.all(np.diff(smooth) <= 1e-6)

    def test_butterworth_is_maximally_flat_and_monotonic(self):
        plan = plan_stft(44_100)
        settings = filters.FilterSettings(kind="low_pass", high_cutoff_hz=3000.0, order=4)
        response = filters.frequency_response(settings, plan)
        frequencies = plan.frequencies

        passband = response[frequencies < 1500.0]
        assert np.all(passband > 0.99)
        at_cutoff = float(np.interp(3000.0, frequencies, response))
        assert at_cutoff == pytest.approx(0.7071, abs=0.01)
        assert float(np.interp(12_000.0, frequencies, response)) < 0.01


class TestReconstruction:
    @pytest.mark.parametrize("sample_rate", [8000, 16_000, 44_100, 48_000])
    def test_transform_round_trips(self, sample_rate):
        signal = noisy_speech(sample_rate, seconds=1.5)
        plan = plan_stft(sample_rate)

        restored = inverse(forward(signal, plan), plan, len(signal))

        assert restored.shape == signal.shape
        assert np.max(np.abs(restored - signal)) < 1e-5

    def test_window_geometry_scales_with_sample_rate(self):
        for sample_rate in (8000, 16_000, 44_100, 48_000):
            plan = plan_stft(sample_rate)
            window_seconds = plan.win_length / sample_rate
            assert 0.02 < window_seconds < 0.12
            assert plan.hop_length == plan.n_fft // 4
            assert plan.win_length == plan.n_fft

    def test_stereo_shape_and_channel_independence(self):
        sample_rate = 44_100
        left = noisy_speech(sample_rate, seconds=1.5, seed=1)
        right = noisy_speech(sample_rate, seconds=1.5, seed=2)
        stereo = np.stack([left, right])
        plan = plan_stft(sample_rate)
        segments = metrics.detect_segments(stereo.mean(axis=0), sample_rate)

        settings = filters.FilterSettings(kind="low_pass", high_cutoff_hz=2000.0)
        output = filters.apply_filter(stereo, sample_rate, plan, settings, segments).audio

        assert output.shape == stereo.shape
        assert not np.allclose(output[0], output[1])


class TestMetrics:
    def test_snr_improves_after_gating(self):
        sample_rate = 22_050
        signal = noisy_speech(sample_rate)
        plan = plan_stft(sample_rate)
        segments = metrics.detect_segments(signal, sample_rate)
        before = metrics.signal_to_noise_db(signal, segments)

        settings = filters.FilterSettings(kind="spectral_gate", threshold_db=6.0, reduction_db=-24.0)
        output = filters.apply_filter(signal, sample_rate, plan, settings, segments).audio

        assert metrics.signal_to_noise_db(output, segments) > before + 3.0

    def test_snr_rises_with_cleaner_input(self):
        """The measurement must track noise level rather than return a constant."""
        sample_rate = 22_050
        rng = np.random.default_rng(11)
        t = np.arange(int(3.0 * sample_rate)) / sample_rate
        envelope = ((t % 1.0) < 0.45).astype(np.float32)
        voice = envelope * 0.5 * np.sin(2 * np.pi * 240 * t)

        measurements = []
        for noise_level in (0.08, 0.02, 0.005):
            noisy = (voice + noise_level * rng.standard_normal(t.size)).astype(np.float32)
            segments = metrics.detect_segments(noisy, sample_rate)
            measurements.append(metrics.signal_to_noise_db(noisy, segments))

        assert measurements[0] < measurements[1] < measurements[2]

    def test_continuous_tone_is_flagged_unreliable(self):
        """A clip with no quiet passage has no honest noise reference."""
        sample_rate = 44_100
        segments = metrics.detect_segments(two_tone(sample_rate), sample_rate)
        assert not segments.reliable

    def test_segments_are_reusable_across_signals(self):
        sample_rate = 22_050
        signal = noisy_speech(sample_rate)
        segments = metrics.detect_segments(signal, sample_rate)
        plan = plan_stft(sample_rate)
        settings = filters.FilterSettings(kind="band_pass", low_cutoff_hz=150.0, high_cutoff_hz=3000.0)

        output = filters.apply_filter(signal, sample_rate, plan, settings, segments).audio

        assert output.shape == signal.shape
        assert np.isfinite(metrics.signal_to_noise_db(output, segments))


class TestDecoding:
    @pytest.mark.parametrize("sample_rate", [8000, 16_000, 44_100, 48_000])
    def test_wav_round_trip(self, sample_rate):
        signal = noisy_speech(sample_rate, seconds=1.2)
        payload = audio_io.encode_wav(signal[None, :], sample_rate)

        decoded = audio_io.decode(payload, "clip.wav")

        assert decoded.sample_rate == sample_rate
        assert decoded.channels == 1
        assert decoded.duration == pytest.approx(1.2, abs=0.01)

    def test_stereo_is_preserved(self):
        sample_rate = 44_100
        stereo = np.stack([noisy_speech(sample_rate, 1.0, 1), noisy_speech(sample_rate, 1.0, 2)])
        decoded = audio_io.decode(audio_io.encode_wav(stereo, sample_rate), "s.wav")

        assert decoded.channels == 2
        assert decoded.original_channels == 2

    def test_high_rates_are_resampled_down(self):
        signal = noisy_speech(96_000, seconds=1.0)
        decoded = audio_io.decode(audio_io.encode_wav(signal[None, :], 96_000), "hi.wav")

        assert decoded.sample_rate == audio_io.MAX_SAMPLE_RATE
        assert decoded.original_sample_rate == 96_000
        assert decoded.duration == pytest.approx(1.0, abs=0.02)

    def test_empty_and_junk_uploads_are_rejected(self):
        with pytest.raises(Exception):
            audio_io.decode(b"", "empty.wav")
        with pytest.raises(Exception):
            audio_io.decode(b"this is not audio" * 100, "notes.txt")


class TestSample:
    def test_generated_clip_is_usable_and_noisy(self):
        audio, sample_rate = generate_sample()
        segments = metrics.detect_segments(audio, sample_rate)

        assert sample_rate == 44_100
        assert 4.0 < len(audio) / sample_rate < 5.0
        assert np.max(np.abs(audio)) < 1.0
        assert segments.reliable
        assert 0.0 < metrics.signal_to_noise_db(audio, segments) < 40.0

    def test_generation_is_deterministic(self):
        first, _ = generate_sample()
        second, _ = generate_sample()
        assert np.array_equal(first, second)


class TestVisuals:
    def test_waveform_and_spectrogram_shapes(self):
        sample_rate = 22_050
        signal = noisy_speech(sample_rate)
        plan = plan_stft(sample_rate)

        peaks = visualize.waveform_peaks(signal, buckets=400)
        grid = visualize.spectrogram(signal, plan)

        assert len(peaks["min"]) == len(peaks["max"]) == 400
        assert all(lo <= hi for lo, hi in zip(peaks["min"], peaks["max"]))
        assert grid["height"] == visualize.SPECTROGRAM_BANDS
        assert 0 < grid["width"] <= visualize.SPECTROGRAM_FRAMES
        assert len(grid["bandEdgesHz"]) == visualize.SPECTROGRAM_BANDS + 1

    def test_response_curve_is_none_for_the_gate(self):
        plan = plan_stft(44_100)
        assert visualize.response_curve(None, plan) is None
