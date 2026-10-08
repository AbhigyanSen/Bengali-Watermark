"""End-to-end FastAPI metadata upload and frontend hosting smoke tests."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def test_fastapi_hosts_page_and_health():
    assert client.get("/").status_code == 200
    assert "Bengali Watermark Studio" in client.get("/").text
    assert client.get("/static/js/app.js").status_code == 200
    assert client.get("/static/css/style.css").status_code == 200
    assert client.get("/api/health").json() == {"status": "ok", "step": 3}


def test_upload_valid_photo_no_exif():
    stream = BytesIO()
    Image.new("RGB", (24, 15)).save(stream, "PNG")
    response = client.post("/api/image/metadata", files={"file": ("photo.png", stream.getvalue(), "image/png")})
    assert response.status_code == 200, response.text
    assert response.json()["captured_at"] is None
    assert response.json()["width"] == 24
    assert response.json()["height"] == 15


def test_empty_and_spoofed_uploads():
    response = client.post("/api/image/metadata", files={"file": ("empty.jpg", b"", "image/jpeg")})
    assert response.status_code == 400
    response = client.post("/api/image/metadata", files={"file": ("fake.jpg", b"abcdef", "image/jpeg")})
    assert response.status_code == 415


def test_large_upload_limit():
    # Validating limits on metadata endpoints prevents oversized bodies from
    # entering the image decoder; the HTTP parser may spool uploads to disk.
    blob = b"\0" * (50 * 1024 * 1024 + 1)
    response = client.post("/api/image/metadata", files={"file": ("too-big.png", blob, "image/png")})
    assert response.status_code == 413
