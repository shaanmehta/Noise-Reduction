"""Tests for the HTTP layer."""

from __future__ import annotations

import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def clip_id(client: TestClient) -> str:
    response = client.post("/api/clips/sample")
    assert response.status_code == 200
    return response.json()["clip"]["clip_id"]


def make_wav(seconds: float = 1.5, sample_rate: int = 22_050, channels: int = 1) -> bytes:
    rng = np.random.default_rng(5)
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = ((t % 0.6) < 0.3).astype(np.float32)
    signal = envelope * 0.5 * np.sin(2 * np.pi * 300 * t) + 0.03 * rng.standard_normal(t.size)
    data = signal if channels == 1 else np.stack([signal, signal * 0.9], axis=1)
    buffer = io.BytesIO()
    sf.write(buffer, data.astype(np.float32), sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


class TestAudioDelivery:
    """Byte ranges are what make an audio element seekable in the browser."""

    def test_advertises_range_support(self, client: TestClient, clip_id: str):
        response = client.get(f"/api/clips/{clip_id}/audio/original.wav")

        assert response.status_code == 200
        assert response.headers["accept-ranges"] == "bytes"
        assert response.headers["content-type"] == "audio/wav"

    def test_serves_a_partial_range(self, client: TestClient, clip_id: str):
        url = f"/api/clips/{clip_id}/audio/original.wav"
        whole = client.get(url).content

        response = client.get(url, headers={"Range": "bytes=100-199"})

        assert response.status_code == 206
        assert len(response.content) == 100
        assert response.content == whole[100:200]
        assert response.headers["content-range"] == f"bytes 100-199/{len(whole)}"

    def test_open_ended_range_runs_to_the_end(self, client: TestClient, clip_id: str):
        url = f"/api/clips/{clip_id}/audio/original.wav"
        whole = client.get(url).content

        response = client.get(url, headers={"Range": "bytes=1000-"})

        assert response.status_code == 206
        assert response.content == whole[1000:]

    def test_suffix_range_returns_the_tail(self, client: TestClient, clip_id: str):
        url = f"/api/clips/{clip_id}/audio/original.wav"
        whole = client.get(url).content

        response = client.get(url, headers={"Range": "bytes=-500"})

        assert response.status_code == 206
        assert response.content == whole[-500:]

    def test_unsatisfiable_range_is_rejected(self, client: TestClient, clip_id: str):
        response = client.get(
            f"/api/clips/{clip_id}/audio/original.wav", headers={"Range": "bytes=99999999-"}
        )

        assert response.status_code == 416

    def test_processed_audio_downloads_with_a_fixed_name(self, client: TestClient, clip_id: str):
        render = client.post(f"/api/clips/{clip_id}/process", json={"kind": "spectral_gate"})
        assert render.status_code == 200

        response = client.get(render.json()["audio_url"])

        assert response.status_code == 200
        assert 'filename="Processed-Audio.wav"' in response.headers["content-disposition"]
        assert response.headers["accept-ranges"] == "bytes"


class TestUploadFlow:
    def test_upload_process_and_download(self, client: TestClient):
        upload = client.post(
            "/api/clips", files={"file": ("take-1.wav", make_wav(), "audio/wav")}
        )
        assert upload.status_code == 200
        clip = upload.json()

        result = client.post(
            f"/api/clips/{clip['clip']['clip_id']}/process",
            json={"kind": "spectral_gate", "threshold_db": 6.0, "reduction_db": -24.0},
        )
        assert result.status_code == 200
        body = result.json()

        audio = client.get(body["audio_url"])
        decoded, rate = sf.read(io.BytesIO(audio.content))

        assert rate == clip["clip"]["sample_rate"]
        assert abs(len(decoded) / rate - clip["clip"]["duration_seconds"]) < 0.02
        assert body["snr_delta_db"] > 0

    def test_compare_returns_every_filter(self, client: TestClient, clip_id: str):
        response = client.post(f"/api/clips/{clip_id}/compare", json={"kind": "spectral_gate"})

        assert response.status_code == 200
        entries = response.json()["entries"]
        assert {entry["kind"] for entry in entries} == {
            "spectral_gate",
            "low_pass",
            "high_pass",
            "band_pass",
        }


class TestErrors:
    @pytest.mark.parametrize(
        "payload,filename",
        [(b"", "empty.wav"), (b"not audio at all" * 80, "notes.txt")],
    )
    def test_bad_uploads_are_refused_without_leaking_internals(
        self, client: TestClient, payload: bytes, filename: str
    ):
        response = client.post("/api/clips", files={"file": (filename, payload, "audio/wav")})

        assert response.status_code in {413, 415, 429}
        assert "Traceback" not in response.text
        assert "/Users/" not in response.text

    def test_unknown_clip_is_a_clean_404(self, client: TestClient):
        response = client.get("/api/clips/not-a-real-clip")

        assert response.status_code == 404
        assert "Traceback" not in response.text
