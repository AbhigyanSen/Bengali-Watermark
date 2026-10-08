"""Image metadata, font catalog, date formatting and full-resolution export."""
from __future__ import annotations

from io import BytesIO
import logging

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse, FileResponse

from app.services.bengali_calendar import CalendarRangeError
from app.services.date_formatter import format_timestamp, parse_camera_datetime
from app.services.metadata import extract_metadata
from app.services.font_catalog import list_fonts, resolve_font
from app.services.watermark import FontUnavailableError, RenderError, render_photo

logger = logging.getLogger(__name__)
router = APIRouter()
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _read_limited(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail='Image is empty.')
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail='Maximum upload size is 50MB.')
    return data


@router.post('/metadata')
def read_image_metadata(file: UploadFile = File(...)):
    try:
        return {'file_size_bytes': file.size, **extract_metadata(BytesIO(_read_limited(file)))}
    except ValueError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    finally:
        file.file.close()


@router.get('/format-date')
def get_formatted_date(captured_at: str = Query(...), language: str = Query('bn'), calendar: str = Query('panjika')):
    try:
        text = format_timestamp(parse_camera_datetime(captured_at), language, calendar)
    except CalendarRangeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {'formatted': text, 'language': language, 'calendar': calendar,
            'reference': 'Kolkata Bisuddha Siddhanta, verified 2025-2026' if calendar == 'panjika' else 'Gregorian'}


@router.get('/fonts')
def get_fonts():
    return list_fonts()


@router.get('/font/{language}/{filename}')
def get_font_file(language: str, filename: str):
    path = resolve_font(language, filename)
    if path is None:
        raise HTTPException(404, 'Font not found.')
    return FileResponse(path, media_type='font/otf' if path.suffix.lower() == '.otf' else 'font/ttf',
                        headers={'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'})


@router.post('/render')
def render_image(
    file: UploadFile = File(...), captured_at: str = Form(...),
    language: str = Form('bn'), calendar: str = Form('gregorian'),
    signature: str = Form('light'), bold: bool = Form(False),
    signature_width_ratio: float | None = Form(None),
    font_size_ratio: float | None = Form(None),
    left_ratio: float | None = Form(None), bottom_ratio: float | None = Form(None),
    gap_ratio: float | None = Form(None), font_name: str | None = Form(None),
    signature_x: float | None = Form(None), signature_y: float | None = Form(None),
    date_x: float | None = Form(None), date_y: float | None = Form(None),
    location_x: float | None = Form(None), location_y: float | None = Form(None),
    location_text: str = Form(''), date_text: str = Form(''),
    location_font_size_ratio: float | None = Form(None),
    location_font_name: str | None = Form(None),
):
    try:
        logger.info('Rendering %s, %s, %s', file.content_type, calendar, signature)
        raw = _read_limited(file)
        result, mime, ext = render_photo(
            raw, camera_date=captured_at, language=language, calendar=calendar,
            signature=signature, bold=bold, signature_width_ratio=signature_width_ratio,
            font_size_ratio=font_size_ratio, left_ratio=left_ratio,
            bottom_ratio=bottom_ratio, gap_ratio=gap_ratio, font_name=font_name,
            signature_x=signature_x, signature_y=signature_y, date_x=date_x,
            date_y=date_y, location_x=location_x, location_y=location_y,
            location_text=location_text, date_text=date_text,
            location_font_size_ratio=location_font_size_ratio,
            location_font_name=location_font_name,
        )
    except CalendarRangeError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    except FontUnavailableError as exc:
        raise HTTPException(503, detail=str(exc)) from exc
    except (RenderError, ValueError) as exc:
        raise HTTPException(400, detail=str(exc)) from exc
    finally:
        file.file.close()
    return StreamingResponse(BytesIO(result), media_type=mime,
                             headers={'Content-Disposition': f'attachment; filename="watermarked.{ext}"',
                                      'Cache-Control': 'no-store'})
