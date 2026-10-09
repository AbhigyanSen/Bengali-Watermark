"""Image metadata, font catalog, date formatting and full-resolution export."""
from __future__ import annotations

from io import BytesIO
import logging
import warnings

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse, FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from app.services.bengali_calendar import CalendarRangeError
from app.services.date_formatter import format_timestamp, parse_camera_datetime
from app.services.metadata import extract_metadata, register_heif_opener
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


# The browser cannot reliably display HEIC/HEIF (and a few unusual JPEGs).
# Return a small, orientation-corrected JPEG for the PREVIEW only.
# Metadata and final export continue to receive the ORIGINAL file bytes.
MAX_PREVIEW_PIXELS = 50_000_000
MAX_PREVIEW_EDGE = 1800


@router.post('/preview')
def get_compatible_preview(file: UploadFile = File(...)):
    try:
        raw = _read_limited(file)
        heif_hint = (file.filename or '').lower().endswith(('.heic', '.heif')) or (
            (file.content_type or '').lower() in {'image/heic', 'image/heif'}
        )
        if heif_hint and register_heif_opener is None:
            raise HTTPException(
                status_code=415,
                detail='HEIC/HEIF decoder unavailable. Install pillow-heif using pip install -r requirements.txt.',
            )
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(BytesIO(raw)) as source:
                    fmt = (source.format or '').upper()
                    if fmt not in {'JPEG', 'PNG', 'WEBP', 'HEIF'}:
                        raise HTTPException(415, detail='Unsupported photo format. Choose JPG, PNG, WebP, or HEIC/HEIF.')
                    if source.width * source.height > MAX_PREVIEW_PIXELS:
                        raise HTTPException(413, detail='This photograph is too large for a preview (limit: 50 megapixels).')
                    source.draft('RGB', (MAX_PREVIEW_EDGE, MAX_PREVIEW_EDGE))
                    upright = ImageOps.exif_transpose(source)
                    upright.thumbnail((MAX_PREVIEW_EDGE, MAX_PREVIEW_EDGE), Image.Resampling.LANCZOS)
                    if upright.mode in {'RGBA', 'LA', 'P'} or 'transparency' in upright.info:
                        rgba = upright.convert('RGBA')
                        background = Image.new('RGB', rgba.size, 'white')
                        background.paste(rgba, mask=rgba.getchannel('A'))
                        preview = background
                    else:
                        preview = upright.convert('RGB')
                    output = BytesIO()
                    preview.save(output, format='JPEG', quality=85, optimize=True)
        except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError,
                Image.DecompressionBombWarning) as exc:
            detail = ('Unable to decode this HEIC/HEIF photo. Check pillow-heif installation or try converting it to JPG.'
                      if heif_hint else 'Unable to decode this photograph. The file may be damaged or use an unsupported codec.')
            raise HTTPException(415, detail=detail) from exc
        return StreamingResponse(
            BytesIO(output.getvalue()), media_type='image/jpeg',
            headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
        )
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
