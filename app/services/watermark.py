"""Create original-resolution watermarked photographs with Pillow (Step 4).

This service processes the request in memory. It strips EXIF/GPS from the
export and preserves the original photograph dimensions (after EXIF rotation).
The frontend download button remains disabled until Step 5.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat, UnidentifiedImageError

from app.services.date_formatter import format_timestamp, parse_camera_datetime

APP_DIR = Path(__file__).resolve().parents[1]
IMAGE_DIR = APP_DIR / "static" / "images"
FONT_DIR = APP_DIR / "static" / "fonts"
# The free Render plan may have memory limits; the application must not
# silently downsample giant 200MP photos. Larger-image support is future work.
MAX_RENDER_PIXELS = 36_000_000


class RenderError(ValueError):
    pass


class FontUnavailableError(RenderError):
    pass


def _get_font(size: int, bold: bool, language: str) -> ImageFont.FreeTypeFont:
    requested = (["bengali-bold.ttf", "bengali.ttf"] if bold else ["bengali-light.ttf", "bengali.ttf"])
    for name in requested:
        path = FONT_DIR / name
        if path.is_file():
            font = ImageFont.truetype(str(path), size)
            # RAQM handles Bengali shaping, particularly conjuncts and matras.
            if language == "bn" and font.layout_engine != ImageFont.Layout.RAQM:
                raise FontUnavailableError("Bengali text shaping (RAQM) is unavailable in Pillow on this server.")
            return font
    raise FontUnavailableError(
        "Bengali font missing. Add a licensed Noto Sans Bengali font as "
        "app/static/fonts/bengali.ttf (and optionally bengali-light.ttf and bengali-bold.ttf)."
    )


def _prepare_signature(choice: str) -> tuple[Image.Image, tuple[int, int, int]]:
    if choice not in {"light", "dark"}:
        raise RenderError("Signature must be light or dark.")
    path = IMAGE_DIR / f"signature_{choice}.png"
    if not path.is_file():
        raise RenderError(f"Signature image {path.name} is missing.")
    with Image.open(path) as src:
        src.load()
        rgba = src.convert("RGBA")
    if rgba.width * rgba.height > 10_000_000:
        raise RenderError("Signature PNG is unexpectedly large.")
    alpha = rgba.getchannel("A")
    # Match browser crop threshold of at least 32/255 opacity.
    mask = alpha.point(lambda value: 255 if value >= 32 else 0)
    bounds = mask.getbbox()
    if bounds is None:
        raise RenderError("Signature image is completely transparent.")
    margin = max(3, round(min(rgba.size) * .01))
    l, t, r, b = bounds
    cropbox = (max(0, l - margin), max(0, t - margin), min(rgba.width, r + margin), min(rgba.height, b + margin))
    rgba = rgba.crop(cropbox)
    # Use median channels of sufficiently opaque pixels, like the JS preview.
    # Exact single-color PNGs are matched; gradients use their median ink color.
    samples = []
    for red, green, blue, a in rgba.getdata():
        if a >= 96:
            samples.append((red, green, blue))
    if samples:
        channels = []
        for i in range(3):
            channel = sorted(x[i] for x in samples)
            channels.append(channel[len(channel)//2])
        rgb = tuple(channels)
    else:
        rgb = ((196,188,179) if choice == "light" else (39,43,47))
    return rgba, rgb


def render_photo(
    contents: bytes,
    *,
    camera_date: str,
    language: str,
    calendar: str,
    signature: str,
    bold: bool,
) -> tuple[bytes, str, str]:
    when = parse_camera_datetime(camera_date)
    caption = format_timestamp(when, language, calendar)
    signature_image, ink = _prepare_signature(signature)
    try:
        with Image.open(BytesIO(contents)) as original:
            fmt = (original.format or "").upper()
            if fmt not in {"JPEG", "PNG", "WEBP", "HEIF"}:
                raise RenderError("Unsupported image format. Use JPEG, PNG, WebP or HEIF.")
            if original.width * original.height > MAX_RENDER_PIXELS:
                raise RenderError(
                    "This image exceeds the 36-megapixel rendering limit. "
                    "Please use a 12MP photo for now; 50MP/200MP support is planned."
                )
            # EXIF orientation applied before drawing; orientation metadata is
            # intentionally not copied into the new image.
            photo = ImageOps.exif_transpose(original).convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise RenderError("The photo could not be decoded.") from exc

    width, height = photo.size
    left = max(1, round(width * .035))
    bottom = max(1, round(height * .035))
    available_width = max(1, width - left - round(width * .035))
    # Matching the current preview's signature ratio (~17% image width).
    sig_width = min(max(1, round(width * .17)), available_width)
    sig_height = max(1, round(sig_width * signature_image.height / signature_image.width))
    signature_image = signature_image.resize((sig_width, sig_height), Image.Resampling.LANCZOS)

    font_size = max(9, round(width * .014))
    dummy = ImageDraw.Draw(photo)
    font = _get_font(font_size, bold, language)
    bbox = dummy.textbbox((0, 0), caption, font=font)
    while bbox[2] - bbox[0] > available_width and font_size > 9:
        font_size -= 1
        font = _get_font(font_size, bold, language)
        bbox = dummy.textbbox((0, 0), caption, font=font)
    if bbox[2] - bbox[0] > available_width:
        raise RenderError("The watermark text is too long for this image.")

    # Draw text on a transparent layer to avoid font bbox offsets and clipping.
    ink_layer = Image.new("RGBA", (bbox[2] - bbox[0] + 4, bbox[3] - bbox[1] + 4), (0, 0, 0, 0))
    painter = ImageDraw.Draw(ink_layer)
    painter.text((2 - bbox[0], 2 - bbox[1]), caption, font=font, fill=(*ink, 255))
    text_h = ink_layer.height
    gap = max(2, round(width * .003))
    y_text = height - bottom - text_h
    y_sig = y_text - gap - sig_height
    if y_sig < 0:
        raise RenderError("The image is too short for this watermark layout.")
    rgba = photo.convert("RGBA")
    rgba.alpha_composite(signature_image, (left, y_sig))
    rgba.alpha_composite(ink_layer, (left, y_text))
    output = BytesIO()
    # Keep user's original format where possible. WebP -> high-quality WebP.
    if fmt == "PNG":
        rgba.save(output, format="PNG", optimize=True)
        mime = "image/png"
        ext = "png"
    elif fmt == "WEBP":
        rgba.convert("RGB").save(output, format="WEBP", quality=95, method=4)
        mime = "image/webp"
        ext = "webp"
    else:
        rgba.convert("RGB").save(output, format="JPEG", quality=95, subsampling=0)
        mime = "image/jpeg"
        ext = "jpg"
    return output.getvalue(), mime, ext
