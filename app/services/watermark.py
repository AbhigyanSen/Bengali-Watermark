"""Original-resolution watermark rendering; normalized positions match the preview."""
from __future__ import annotations

from io import BytesIO
from math import isfinite
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

from app.services.date_formatter import format_timestamp, parse_camera_datetime
from app.services.font_catalog import FONT_ROOT, load_defaults, pick_bold, resolve_font

APP_DIR = Path(__file__).resolve().parents[1]
IMAGE_DIR = APP_DIR / 'static' / 'images'
FONT_DIR = FONT_ROOT  # Retained for Step 4/5 callers and tests.
MAX_RENDER_PIXELS = 36_000_000


class RenderError(ValueError):
    pass


class FontUnavailableError(RenderError):
    pass


def _get_font(size: int, bold: bool, language: str, chosen: str | None = None) -> ImageFont.FreeTypeFont:
    folder = 'bengali' if language == 'bn' else 'english'
    requested = chosen or load_defaults()[folder]
    font_path = pick_bold(folder, requested) if bold else resolve_font(folder, requested)
    if chosen and font_path is None:
        raise FontUnavailableError(f'Selected font is missing: {chosen}. Add it to fonts/{folder}/.')
    if font_path is None:
        legacy = ['bengali-bold.ttf', 'bengali.ttf'] if bold else ['bengali-light.ttf', 'bengali.ttf']
        font_path = next((FONT_DIR / p for p in legacy if (FONT_DIR / p).is_file() and (FONT_DIR / p).stat().st_size > 0), None)
    if font_path is None:
        raise FontUnavailableError(f'No usable {folder} font found. Add fonts to app/static/fonts/{folder}/.')
    try:
        font = ImageFont.truetype(str(font_path), size)
    except OSError as exc:
        raise FontUnavailableError(f'Cannot load font: {font_path.name}.') from exc
    if language == 'bn' and font.layout_engine != ImageFont.Layout.RAQM:
        raise FontUnavailableError('Pillow RAQM Bengali shaping is unavailable.')
    return font


def _signature(choice: str) -> tuple[Image.Image, tuple[int, int, int]]:
    if choice not in {'light', 'dark'}:
        raise RenderError('Signature must be light or dark.')
    path = IMAGE_DIR / f'signature_{choice}.png'
    if not path.is_file():
        raise RenderError(f'Missing {path.name}.')
    try:
        with Image.open(path) as source:
            if source.width * source.height > 10_000_000:
                raise RenderError('Signature image is too large.')
            rgba = source.convert('RGBA')
    except (OSError, UnidentifiedImageError) as exc:
        raise RenderError('Signature cannot be decoded.') from exc
    alpha = rgba.getchannel('A')
    bbox = alpha.point(lambda a: 255 if a >= 32 else 0).getbbox()
    if bbox is None:
        raise RenderError('Signature contains no visible ink.')
    margin = max(3, round(min(rgba.size) * .01))
    l, t, r, b = bbox
    rgba = rgba.crop((max(0, l-margin), max(0, t-margin), min(rgba.width, r+margin), min(rgba.height, b+margin)))
    histogram = [[0] * 256 for _ in range(3)]
    total = 0
    for r, g, b, a in rgba.getdata():
        if a >= 96:
            for i, c in enumerate((r, g, b)):
                histogram[i][c] += a
            total += a
    if total:
        color = []
        for channel in histogram:
            running = 0
            for value, weight in enumerate(channel):
                running += weight
                if running >= total / 2:
                    color.append(value)
                    break
        ink = tuple(color)
    else:
        ink = (196, 188, 179) if choice == 'light' else (39, 43, 47)
    return rgba, ink


def _ratio(value: float | None, default: float, name: str, low: float = 0, high: float = 1) -> float:
    if value is None:
        return default
    if not isfinite(value) or not low <= value <= high:
        raise RenderError(f'Invalid {name}.')
    return value


def _render_text(text: str, font: ImageFont.FreeTypeFont, ink: tuple[int, int, int], bold: bool = False) -> Image.Image:
    # Draw U+00B7 as a dot: some Bengali font families lack this separator.
    # Synthetic stroke keeps Bold functional if this family has no real bold face.
    stroke = max(1, round(font.size * .035)) if bold else 0
    pieces = text.split('·')
    draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    widths = [draw.textlength(part, font=font) for part in pieces]
    dot_space = max(3, round(font.size * .30))
    width = max(2, round(sum(widths) + dot_space * (len(pieces)-1) + 8))
    bbox = draw.textbbox((0, 0), text.replace('·', ''), font=font, stroke_width=stroke)
    height = max(font.size + 7, bbox[3] - bbox[1] + 8)
    layer = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    painter = ImageDraw.Draw(layer)
    x = 4.0
    baseline_y = 4 - bbox[1]
    for index, piece in enumerate(pieces):
        painter.text((round(x), baseline_y), piece, font=font, fill=(*ink, 255), stroke_width=stroke, stroke_fill=(*ink, 255))
        x += widths[index]
        if index < len(pieces)-1:
            radius = max(1, round(font.size * .055))
            cx = round(x + dot_space / 2)
            cy = max(radius, round(height * .55))
            painter.ellipse((cx-radius, cy-radius, cx+radius, cy+radius), fill=(*ink, 255))
            x += dot_space
    return layer


def _place(photo: Image.Image, layer: Image.Image, x: float, y: float, name: str) -> None:
    w, h = photo.size
    px = round(w * x)
    py = round(h * y)
    if px < 0 or py < 0 or px + layer.width > w + 1 or py + layer.height > h + 1:
        raise RenderError(f'{name} is outside the photograph. Drag it back inside the preview.')
    photo.alpha_composite(layer, (px, py))


def render_photo(
    contents: bytes, *, camera_date: str, language: str, calendar: str,
    signature: str, bold: bool,
    signature_width_ratio: float | None = None,
    font_size_ratio: float | None = None,
    left_ratio: float | None = None,
    bottom_ratio: float | None = None,
    gap_ratio: float | None = None,
    font_name: str | None = None,
    signature_x: float | None = None, signature_y: float | None = None,
    date_x: float | None = None, date_y: float | None = None,
    location_x: float | None = None, location_y: float | None = None,
    location_text: str = '', date_text: str = '',
    location_font_size_ratio: float | None = None,
    location_font_name: str | None = None,
) -> tuple[bytes, str, str]:
    if language not in {'bn', 'en'}:
        raise RenderError('Unsupported language.')
    when = parse_camera_datetime(camera_date)
    caption = (date_text.strip() if date_text.strip() else format_timestamp(when, language, calendar))
    if len(caption) > 180 or len(location_text) > 180:
        raise RenderError('Watermark text must be 180 characters or fewer.')
    sign, ink = _signature(signature)
    try:
        with Image.open(BytesIO(contents)) as original:
            fmt = (original.format or '').upper()
            if fmt not in {'JPEG', 'PNG', 'WEBP', 'HEIF'}:
                raise RenderError('Unsupported photo format.')
            if original.width * original.height > MAX_RENDER_PIXELS:
                raise RenderError('Photo exceeds 36MP limit.')
            icc = original.info.get('icc_profile', b'')
            upright = ImageOps.exif_transpose(original)
            photo = upright.convert('RGBA')
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise RenderError('Photo could not be decoded.') from exc

    width, height = photo.size
    sign_ratio = _ratio(signature_width_ratio, .17, 'signature width', .01, .70)
    text_ratio = _ratio(font_size_ratio, .014, 'date font size', .001, .12)
    loc_ratio = _ratio(location_font_size_ratio, text_ratio, 'location font size', .001, .12)
    left = _ratio(left_ratio, .035, 'left margin', 0, .3)
    bottom = _ratio(bottom_ratio, .035, 'bottom margin', 0, .3)
    gap = _ratio(gap_ratio, .003, 'gap', 0, .1)
    sign_w = min(width, max(1, round(width * sign_ratio)))
    sign_h = max(1, round(sign_w * sign.height / sign.width))
    sign = sign.resize((sign_w, sign_h), Image.Resampling.LANCZOS)
    font = _get_font(max(7, round(width * text_ratio)), bold, language, font_name)
    date_layer = _render_text(caption, font, ink, bold=bold)
    if date_layer.width > width:
        raise RenderError('Date text is too long for this photograph.')
    loc_layer = None
    if location_text.strip():
        loc_lang = 'bn' if any('\u0980' <= c <= '\u09ff' for c in location_text) else 'en'
        loc_font = _get_font(max(7, round(width * loc_ratio)), False, loc_lang, location_font_name or (font_name if loc_lang == language else None))
        loc_layer = _render_text(location_text.strip(), loc_font, ink)
        if loc_layer.width > width:
            raise RenderError('Location text is too long for this photograph.')
    # Keep Step 5 geometry as fallback for existing clients.
    date_top = 1 - bottom - date_layer.height / height
    sign_top = date_top - gap - sign_h / height
    _place(photo, sign,
           _ratio(signature_x, left, 'signature x'),
           _ratio(signature_y, sign_top, 'signature y'), 'Signature')
    _place(photo, date_layer,
           _ratio(date_x, left, 'date x'),
           _ratio(date_y, date_top, 'date y'), 'Date')
    if loc_layer is not None:
        _place(photo, loc_layer,
               _ratio(location_x, max(0, 1-bottom-loc_layer.width/width), 'location x'),
               _ratio(location_y, max(0, 1-bottom-loc_layer.height/height), 'location y'), 'Location')
    out = BytesIO()
    save_options = {'icc_profile': icc} if isinstance(icc, bytes) and 0 < len(icc) < 262144 else {}
    if fmt == 'PNG':
        photo.save(out, format='PNG', optimize=True, **save_options)
        mime, ext = 'image/png', 'png'
    elif fmt == 'WEBP':
        photo.save(out, format='WEBP', quality=95, method=4, **save_options)
        mime, ext = 'image/webp', 'webp'
    else:
        photo.convert('RGB').save(out, format='JPEG', quality=95, subsampling=0, **save_options)
        mime, ext = 'image/jpeg', 'jpg'
    return out.getvalue(), mime, ext
