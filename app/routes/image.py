"""Photo metadata, canonical date formatting, and image rendering endpoints."""
from __future__ import annotations

from io import BytesIO
import logging

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from app.services.bengali_calendar import CalendarRangeError
from app.services.date_formatter import format_timestamp, parse_camera_datetime
from app.services.metadata import extract_metadata
from app.services.watermark import FontUnavailableError, RenderError, render_photo

logger = logging.getLogger(__name__)
router = APIRouter()
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _read_limited(file: UploadFile) -> bytes:
    # A bounded chunk read avoids unbounded memory for malicious uploads.
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Maximum upload size is 50 MB.")
    return data


@router.post("/metadata")
def read_image_metadata(file: UploadFile = File(...)):
    try:
        result = extract_metadata(BytesIO(_read_limited(file)))
        return {"file_size_bytes": file.size, **result}
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    finally:
        file.file.close()


@router.get("/format-date")
def get_formatted_date(
    captured_at: str = Query(...),
    language: str = Query("bn"),
    calendar: str = Query("panjika"),
):
    try:
        text = format_timestamp(parse_camera_datetime(captured_at), language, calendar)
    except CalendarRangeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"formatted": text, "language": language, "calendar": calendar,
            "reference": "Kolkata Bisuddha Siddhanta, verified 2025-2026" if calendar == "panjika" else "Gregorian"}


@router.post("/render")
def render_image(
    file: UploadFile = File(...),
    captured_at: str = Form(...),
    language: str = Form("bn"),
    calendar: str = Form("gregorian"),
    signature: str = Form("light"),
    bold: bool = Form(False),
):
    try:
        logger.info("Rendering watermark: format=%s, calendar=%s, signature=%s", file.content_type, calendar, signature)
        raw = _read_limited(file)
        result, mime, ext = render_photo(raw, camera_date=captured_at, language=language,
                                         calendar=calendar, signature=signature, bold=bold)
    except CalendarRangeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FontUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ValueError, RenderError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        file.file.close()
    return StreamingResponse(BytesIO(result), media_type=mime,
                             headers={"Content-Disposition": f'attachment; filename="watermarked.{ext}"',
                                      "Cache-Control": "no-store"})
