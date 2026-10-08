"""Safe, read-only catalog of the user's English and Bengali fonts."""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

FONT_ROOT = Path(__file__).resolve().parents[1] / 'static' / 'fonts'
DEFAULTS_FILE = FONT_ROOT / 'font_defaults.json'
LANGUAGES = {'english': 'en', 'bengali': 'bn'}
FALLBACK_DEFAULTS = {
    'english': 'SunnyspellsRegular-MV9ze.otf',
    'bengali': 'Li Mahfuj AK Unicode.ttf',
}
EXTENSIONS = {'.ttf', '.otf'}
MAX_FONT_BYTES = 15_000_000

# Suffix variants as used by font collections, e.g. Anek Bangla Condensed ExtraBold.
STYLE_END = re.compile(
    r'(?:[\s_\-]*(?:ExtraBold|ExtraLight|SemiBold|SemiLight|UltraBold|'
    r'Bold|Light|Medium|Regular|Italic|Oblique|Thin|Black|Heavy|Book))$', re.I
)
WIDTH_END = re.compile(r'(?:[\s_\-]*(?:ExtraCondensed|SemiCondensed|Condensed|Expanded|ExtraExpanded|Narrow))$', re.I)


def _files(language: str) -> list[Path]:
    if language not in LANGUAGES:
        return []
    directory = FONT_ROOT / language
    if not directory.is_dir():
        return []
    return sorted(
        (p for p in directory.iterdir()
         if p.is_file() and p.suffix.lower() in EXTENSIONS
         and 0 < p.stat().st_size <= MAX_FONT_BYTES),
        key=lambda p: p.name.casefold()
    )


def resolve_font(language: str, filename: str) -> Path | None:
    """Only return existing fonts directly inside the selected language folder."""
    if language not in LANGUAGES or not isinstance(filename, str):
        return None
    if filename != Path(filename).name or '/' in filename or '\\' in filename:
        return None
    if filename in ('.', '..') or Path(filename).suffix.lower() not in EXTENSIONS:
        return None
    return next((p for p in _files(language) if p.name == filename), None)


def load_defaults() -> dict[str, str | None]:
    defaults = dict(FALLBACK_DEFAULTS)
    try:
        raw = json.loads(DEFAULTS_FILE.read_text(encoding='utf-8'))
        if isinstance(raw, dict):
            for language in LANGUAGES:
                value = raw.get(language)
                if isinstance(value, str) and value.strip():
                    defaults[language] = value
    except (OSError, ValueError):
        pass
    return defaults


def _family_variant(stem: str) -> tuple[str, str]:
    # Strip foundry suffix (e.g. SunnyspellsRegular-MV9ze).
    stem = re.sub(r'-(?=[A-Za-z0-9]{5,7}$)[A-Za-z0-9]{5,7}$', '', stem)
    variant_parts: list[str] = []
    work = stem.strip()
    while True:
        match = STYLE_END.search(work) or WIDTH_END.search(work)
        if not match or not work[:match.start()].strip(' _-'):
            break
        variant_parts.insert(0, match.group().strip(' _-'))
        work = work[:match.start()].strip(' _-')
    family = re.sub(r'[_-]+', ' ', work).strip()
    family = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', family)
    return family or stem, ' '.join(variant_parts) or 'Regular'


def list_fonts() -> dict:
    defaults = load_defaults()
    result: dict[str, list[dict]] = {}
    selected: dict[str, str | None] = {}
    for language in LANGUAGES:
        group_map: dict[str, dict] = {}
        files = _files(language)
        selected[language] = defaults[language] if resolve_font(language, defaults[language]) else (files[0].name if files else None)
        for p in files:
            family, variant = _family_variant(p.stem)
            key = family.casefold()
            if key not in group_map:
                group_map[key] = {'family': family, 'variants': []}
            group_map[key]['variants'].append({
                'name': p.name, 'variant': variant,
                'url': f'/api/image/font/{language}/{quote(p.name)}',
                'selected': p.name == selected[language]
            })
        groups = list(group_map.values())
        for group in groups:
            group['variants'].sort(key=lambda v: (v['variant'].lower() != 'regular', v['variant'].lower(), v['name'].lower()))
        result[language] = sorted(groups, key=lambda g: g['family'].casefold())
    return {'groups': result, 'defaults': selected,
            'configured_defaults': defaults,
            'samples': {'english': 'The quick brown fox — October 08, 2026.',
                        'bengali': 'আজকের সুন্দর মুহূর্তগুলো স্মৃতিতে রয়ে যাবে — ০৮ অক্টোবর ২০২৬।'}}


def pick_bold(language: str, filename: str) -> Path | None:
    """Prefer actual bold version when user enables Bold on a regular face."""
    selected = resolve_font(language, filename)
    if selected is None:
        return None
    family, variant = _family_variant(selected.stem)
    if 'bold' in variant.casefold() or 'black' in variant.casefold():
        return selected
    for path in _files(language):
        candidate_family, candidate_variant = _family_variant(path.stem)
        if candidate_family.casefold() == family.casefold() and candidate_variant.lower() == 'bold':
            return path
    return selected
