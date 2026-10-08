"""Read image metadata without OCR, geocoding, or storing images.

EXIF timestamps normally contain the camera's wall-clock time. Preserve that
clock value for watermark formatting; do NOT guess the timezone from the server,
browser, GPS, or upload time. If missing, the UI must request manual entry.
"""

from __future__ import annotations

import math
import re
import warnings
from datetime import datetime
from typing import Any, BinaryIO

from PIL import ExifTags, Image, UnidentifiedImageError

try:
    from pillow_heif import register_heif_opener
except ImportError:  # HEIF support is unavailable until pillow-heif is installed
    register_heif_opener = None
else:
    register_heif_opener(thumbnails=False)

# Metadata inspection doesn't decode the entire image, but a higher threshold
# lets us read headers of the S24 Ultra's ~200MP images without rejecting them.
MAX_METADATA_PIXELS = 250_000_000
# Pillow's default ~89MP limit would reject 200MP phone originals at open().
# Raise the *header inspection* bound; future pixel-decoding code must apply
# its own stricter resource budget before loading image pixel data.
Image.MAX_IMAGE_PIXELS = MAX_METADATA_PIXELS
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF"}

_EXIF_DATE_RE = re.compile(r"^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$")
_OFFSET_RE = re.compile(r"^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$")


def _as_string(value: Any) -> str | None:
    if isinstance(value, bytes):
        value = value.decode("ascii", errors="ignore")
    if not isinstance(value, str):
        return None
    value = value.strip("\x00 ")
    return value or None


def _parse_exif_date(raw: Any) -> datetime | None:
    text = _as_string(raw)
    if not text or not _EXIF_DATE_RE.fullmatch(text):
        return None
    try:
        return datetime.strptime(text, "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def _to_decimal(dms: Any, direction: Any) -> float | None:
    """Convert GPS degrees/minutes/seconds to signed decimal degrees."""
    if not isinstance(dms, (tuple, list)) or len(dms) != 3:
        return None
    ref = (_as_string(direction) or "").upper()
    if ref not in {"N", "S", "E", "W"}:
        return None
    try:
        deg, minute, sec = (float(value) for value in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if not all(math.isfinite(value) for value in (deg, minute, sec)):
        return None
    if not (0 <= minute < 60 and 0 <= sec < 60 and deg >= 0):
        return None
    number = deg + minute / 60 + sec / 3600
    maximum = 90 if ref in {"N", "S"} else 180
    if number > maximum:
        return None
    return round(-number if ref in {"S", "W"} else number, 7)


def _gps_data(gps_ifd: dict[int, Any]) -> dict[str, float] | None:
    if not gps_ifd:
        return None
    lat = _to_decimal(gps_ifd.get(2), gps_ifd.get(1))
    lon = _to_decimal(gps_ifd.get(4), gps_ifd.get(3))
    if lat is None or lon is None:
        return None
    return {"latitude": lat, "longitude": lon}


def extract_metadata(file_obj: BinaryIO) -> dict[str, Any]:
    """Parse metadata from the supplied file-like object. Never modify it.

    Raises ValueError for unsupported, invalid, or unreasonably large images.
    """
    try:
        # Don't globally disable Pillow's decompression checks.
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(file_obj) as photo:
                fmt = (photo.format or "").upper()
                if fmt not in SUPPORTED_FORMATS:
                    raise ValueError("Unsupported image format. Use JPEG, PNG, WebP or HEIC/HEIF.")

                width, height = photo.size
                if width <= 0 or height <= 0 or width * height > MAX_METADATA_PIXELS:
                    raise ValueError("Image dimensions are outside the supported range.")

                exif = photo.getexif()
                # HEIF images may store EXIF bytes in photo.info.
                if not exif and photo.info.get("exif"):
                    exif = Image.Exif()
                    exif.load(photo.info["exif"])

                exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
                gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
                orientation = exif.get(274, 1)
                orientation = int(orientation) if orientation in range(1, 9) else 1

                # DateTimeOriginal > DateTimeDigitized > Image DateTime.
                # The latter two can refer to edits/digitization, so label them.
                candidates = (
                    ("DateTimeOriginal", exif_ifd.get(36867, exif.get(36867)), exif_ifd.get(36881, exif.get(36881))),
                    ("DateTimeDigitized", exif_ifd.get(36868, exif.get(36868)), exif_ifd.get(36882, exif.get(36882))),
                    ("DateTime", exif.get(306), exif.get(36880)),
                )
                capture = None
                source = None
                offset = None
                for label, raw, raw_offset in candidates:
                    parsed = _parse_exif_date(raw)
                    if parsed is not None:
                        capture, source = parsed, label
                        candidate_offset = _as_string(raw_offset)
                        if candidate_offset and _OFFSET_RE.fullmatch(candidate_offset):
                            offset = candidate_offset
                        break

                warnings_list: list[str] = []
                if capture is None:
                    warnings_list.append("No usable EXIF date found. Enter the photo date/time manually.")
                elif source != "DateTimeOriginal":
                    warnings_list.append(f"Using EXIF {source}; this may not be the original capture time. Please verify.")
                if offset is None and capture is not None:
                    warnings_list.append("EXIF timezone is unknown; the camera's recorded clock time is preserved.")

                gps = _gps_data(gps_ifd)
                if not gps:
                    warnings_list.append("GPS coordinates are not embedded in this image.")

                # Orientation 5–8 swaps the display dimensions.
                display_width, display_height = ((height, width) if orientation in {5, 6, 7, 8} else (width, height))
                return {
                    "image_format": fmt,
                    "width": width,
                    "height": height,
                    "display_width": display_width,
                    "display_height": display_height,
                    "orientation": orientation,
                    "captured_at": capture.strftime("%Y-%m-%dT%H:%M") if capture else None,
                    "captured_seconds": capture.second if capture else None,
                    "date_source": source,
                    "timezone_offset": offset,
                    "gps": gps,
                    "warnings": warnings_list,
                }
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("The selected file is not a readable or supported image.") from exc
