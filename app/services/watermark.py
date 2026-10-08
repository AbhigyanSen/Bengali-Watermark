"""Original-resolution Bengali Watermark Studio image rendering.

The browser sends its live watermark geometry as normalized ratios, so the
signature/date layout scales with the actual photograph instead of the
browser viewport. Image EXIF (including GPS) is intentionally not exported.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from math import isfinite

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

from app.services.date_formatter import format_timestamp, parse_camera_datetime

APP_DIR = Path(__file__).resolve().parents[1]
IMAGE_DIR = APP_DIR / "static" / "images"
FONT_DIR = APP_DIR / "static" / "fonts"
MAX_RENDER_PIXELS = 36_000_000  # Prevent huge memory use on small Render instances.


class RenderError(ValueError):
    pass


class FontUnavailableError(RenderError):
    pass


def _get_font(size: int, bold: bool, language: str) -> ImageFont.FreeTypeFont:
    choices = (["bengali-bold.ttf", "bengali.ttf"] if bold
               else ["bengali-light.ttf", "bengali.ttf"])
    for name in choices:
        path = FONT_DIR / name
        if path.is_file():
            try:
                font = ImageFont.truetype(str(path), size)
            except OSError as exc:
                raise FontUnavailableError(f"Cannot load font: {name}.") from exc
            if language == "bn" and font.layout_engine != ImageFont.Layout.RAQM:
                raise FontUnavailableError(
                    "Pillow RAQM Bengali shaping is unavailable on this server."
                )
            return font
    raise FontUnavailableError(
        "Bengali font missing. Place a licensed Noto Sans Bengali font at "
        "app/static/fonts/bengali.ttf (optional: bengali-light.ttf and bengali-bold.ttf)."
    )


def _prepare_signature(choice: str) -> tuple[Image.Image, tuple[int, int, int]]:
    if choice not in {"light", "dark"}:
        raise RenderError("Signature must be light or dark.")
    path = IMAGE_DIR / f"signature_{choice}.png"
    if not path.is_file():
        raise RenderError(f"Missing signature PNG: {path.name}.")
    try:
        with Image.open(path) as source:
            if source.width * source.height > 10_000_000:
                raise RenderError("Signature PNG is too large.")
            rgba = source.convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise RenderError("The signature PNG cannot be decoded.") from exc

    alpha = rgba.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a >= 32 else 0).getbbox()
    if bbox is None:
        raise RenderError("The signature PNG is completely transparent.")

    # Align with browser's 1%-padded alpha crop; PIL bounding boxes use
    # exclusive right/bottom coordinates.
    margin = max(3, round(min(rgba.size) * .01))
    left, top, right, bottom = bbox
    crop_box = (
        max(0, left - margin), max(0, top - margin),
        min(rgba.width, right + margin), min(rgba.height, bottom + margin),
    )
    rgba = rgba.crop(crop_box)

    hist = [[0] * 256 for _ in range(3)]
    total_weight = 0
    for r, g, b, a in (rgba.get_flattened_data() if hasattr(rgba, "get_flattened_data") else rgba.getdata()):
        if a >= 96:
            hist[0][r] += a
            hist[1][g] += a
            hist[2][b] += a
            total_weight += a

    if total_weight:
        channels = []
        for channel in hist:
            cumulative = 0
            median = 0
            for value, weight in enumerate(channel):
                cumulative += weight
                if cumulative >= total_weight / 2:
                    median = value
                    break
            channels.append(median)
        ink = tuple(channels)
    else:
        ink = (196, 188, 179) if choice == "light" else (39, 43, 47)
    return rgba, ink


def _ratio(value: float | None, default: float, name: str, low: float, high: float) -> float:
    if value is None:
        return default
    if not isfinite(value) or not low <= value <= high:
        raise RenderError(f"Invalid {name} parameter.")
    return value


def _dot_width(font: ImageFont.FreeTypeFont) -> int:
    return max(3, round(font.size * .30))


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> float:
    # Noto Sans Bengali does not contain U+00B7 (middle dot). Drawing its
    # missing-glyph box would make the exported date differ from the preview.
    # Measure text around the separator, which is drawn as a small circle.
    parts = text.split("·")
    return sum(draw.textlength(part, font=font) for part in parts) + (_dot_width(font) * (len(parts) - 1))


def _wrap_caption(draw: ImageDraw.ImageDraw, caption: str,
                  font: ImageFont.FreeTypeFont, maximum_width: int) -> list[str]:
    """Wrap at spaces like the HTML preview; reject an unbreakable long word."""
    result = []
    current = ""
    for word in caption.split():
        candidate = f"{current} {word}" if current else word
        if _text_width(draw, candidate, font) <= maximum_width:
            current = candidate
        else:
            if current:
                result.append(current)
            current = word
            if _text_width(draw, current, font) > maximum_width:
                raise RenderError("The date is too wide for the photo at this font size.")
    if current:
        result.append(current)
    return result


def _caption_layer(caption: str, font: ImageFont.FreeTypeFont, color: tuple[int, int, int],
                   max_width: int, line_height: float) -> Image.Image:
    dummy = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    lines = _wrap_caption(dummy, caption, font, max_width)
    # Remove only the unsupported U+00B7 glyph for bbox measurements. It is
    # subsequently drawn as a circle between text segments.
    bounds = [dummy.textbbox((0, 0), line.replace("·", ""), font=font) for line in lines]
    step = max(1, round(font.size * line_height))
    height = max(1, (len(lines) - 1) * step +
                 max(max(font.size, b[3] - b[1]) for b in bounds) + 5)
    width = min(max_width + 4, max(1, round(max(_text_width(dummy, line, font) for line in lines)) + 5))
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    painter = ImageDraw.Draw(layer)
    for i, (line, bbox) in enumerate(zip(lines, bounds)):
        x = 2.0
        y = 2 + i * step - bbox[1]
        segments = line.split("·")
        for j, segment in enumerate(segments):
            painter.text((round(x), y), segment, font=font, fill=(*color, 255))
            x += dummy.textlength(segment, font=font)
            if j < len(segments) - 1:
                dot_width = _dot_width(font)
                radius = max(1, round(font.size * .045))
                cx = round(x + dot_width / 2)
                cy = 2 + i * step + max(1, round((bbox[3] - bbox[1]) * .55))
                painter.ellipse((cx-radius, cy-radius, cx+radius, cy+radius),
                                fill=(*color, 255))
                x += dot_width
    return layer


def render_photo(
    contents: bytes, *, camera_date: str, language: str, calendar: str,
    signature: str, bold: bool,
    signature_width_ratio: float | None = None,
    font_size_ratio: float | None = None,
    left_ratio: float | None = None,
    bottom_ratio: float | None = None,
    gap_ratio: float | None = None,
) -> tuple[bytes, str, str]:
    timestamp = parse_camera_datetime(camera_date)
    caption = format_timestamp(timestamp, language, calendar)
    signature_image, ink = _prepare_signature(signature)

    try:
        with Image.open(BytesIO(contents)) as original:
            fmt = (original.format or "").upper()
            if fmt not in {"JPEG", "PNG", "WEBP", "HEIF"}:
                raise RenderError("Supported exports: JPEG, PNG, WebP and HEIF input.")
            if original.width * original.height > MAX_RENDER_PIXELS:
                raise RenderError(
                    "The photo exceeds the current 36MP rendering limit. "
                    "Please use a 12MP photo; larger-photo support is planned."
                )
            icc = original.info.get("icc_profile", b"")
            # Apply camera orientation first, before placing bottom-left watermark.
            upright = ImageOps.exif_transpose(original)
            photo = upright.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise RenderError("The photo cannot be decoded.") from exc

    width, height = photo.size
    sig_ratio = _ratio(signature_width_ratio, .17, "signature width", .01, .70)
    font_ratio = _ratio(font_size_ratio, .014, "font size", .001, .12)
    left_frac = _ratio(left_ratio, .035, "left margin", 0, .25)
    bottom_frac = _ratio(bottom_ratio, .035, "bottom margin", 0, .25)
    gap_frac = _ratio(gap_ratio, .003, "watermark gap", 0, .10)

    left = round(width * left_frac)
    bottom = round(height * bottom_frac)
    max_width = max(1, width - left - round(width * .035))
    sig_w = min(max(1, round(width * sig_ratio)), max_width)
    sig_h = max(1, round(sig_w * signature_image.height / signature_image.width))
    signature_image = signature_image.resize((sig_w, sig_h), Image.Resampling.LANCZOS)

    font_size = max(7, round(width * font_ratio))
    font = _get_font(font_size, bold, language)
    text_layer = _caption_layer(caption, font, ink, max_width, 1.35)
    gap = max(0, round(height * gap_frac))
    text_y = height - bottom - text_layer.height
    sign_y = text_y - gap - sig_h
    if sign_y < 0 or left + sig_w > width:
        raise RenderError("The watermark does not fit this photograph. Try a wider image.")

    photo.alpha_composite(signature_image, (left, sign_y))
    photo.alpha_composite(text_layer, (left, text_y))
    result = BytesIO()
    save_options = {"icc_profile": icc} if isinstance(icc, bytes) and 0 < len(icc) < 262144 else {}
    if fmt == "PNG":
        photo.save(result, format="PNG", optimize=True, **save_options)
        mime, ext = "image/png", "png"
    elif fmt == "WEBP":
        photo.save(result, format="WEBP", quality=95, method=4, **save_options)
        mime, ext = "image/webp", "webp"
    else:
        photo.convert("RGB").save(result, format="JPEG", quality=95,
                                  subsampling=0, **save_options)
        mime, ext = "image/jpeg", "jpg"
    return result.getvalue(), mime, ext
