"""Step 03: metadata extracted from real JPEG/PNG image streams."""
from io import BytesIO

from PIL import ExifTags, Image, TiffImagePlugin

from app.services.metadata import _parse_exif_date, _gps_data, extract_metadata


def make_jpeg_with_exif():
    im = Image.new("RGB", (80, 40), "teal")
    exif = Image.Exif()
    exif[274] = 6
    exif[36867] = "2026:10:08 16:35:09"
    exif[36881] = "+05:30"
    exif[306] = "2026:10:09 13:00:00"  # intentionally different
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[1], gps[3] = "N", "E"
    gps[2] = tuple(TiffImagePlugin.IFDRational(x) for x in (22, 34, 30))
    gps[4] = tuple(TiffImagePlugin.IFDRational(x) for x in (88, 22, 10))
    output = BytesIO()
    im.save(output, "JPEG", exif=exif)
    output.seek(0)
    return output


def test_exif_capture_time_orientation_and_gps():
    metadata = extract_metadata(make_jpeg_with_exif())
    assert metadata["date_source"] == "DateTimeOriginal"
    assert metadata["captured_at"] == "2026-10-08T16:35"
    assert metadata["captured_seconds"] == 9
    assert metadata["timezone_offset"] == "+05:30"
    assert metadata["orientation"] == 6
    assert (metadata["display_width"], metadata["display_height"]) == (40, 80)
    assert metadata["gps"] == {"latitude": 22.575, "longitude": 88.3694444}
    assert metadata["warnings"] == []


def test_png_missing_exif_requires_manual_date():
    output = BytesIO()
    Image.new("RGB", (60, 30), "orange").save(output, "PNG")
    output.seek(0)
    metadata = extract_metadata(output)
    assert metadata["captured_at"] is None
    assert metadata["date_source"] is None
    assert metadata["gps"] is None
    assert metadata["orientation"] == 1
    assert any("manually" in warning for warning in metadata["warnings"])


def test_fallback_timestamp_is_labeled():
    output = BytesIO()
    exif = Image.Exif()
    exif[306] = "2020:01:02 03:04:05"
    Image.new("RGB", (20, 10)).save(output, "JPEG", exif=exif)
    output.seek(0)
    data = extract_metadata(output)
    assert data["date_source"] == "DateTime"
    assert data["captured_at"] == "2020-01-02T03:04"
    assert "may not be the original" in " ".join(data["warnings"])


def test_malformed_values_rejected_safely():
    assert _parse_exif_date("2026:13:99 80:00:00") is None
    assert _parse_exif_date("2026:10:08 08:13") is None
    assert _gps_data({1: "N", 2: (95, 0, 0), 3: "E", 4: (88, 0, 0)}) is None
    assert _gps_data({1: "S", 2: (23, 30, 0), 3: "W", 4: (46, 20, 0)}) == {
        "latitude": -23.5, "longitude": -46.3333333
    }


def test_invalid_image_fails():
    try:
        extract_metadata(BytesIO(b"This is not an image"))
    except ValueError as exc:
        assert "readable" in str(exc)
    else:
        raise AssertionError("Invalid image should have been rejected")
