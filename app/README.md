# Bengali Watermark Studio · Version 1.5 UI and font support

## Replace these application files

- `app/templates/index.html`
- `app/static/css/style.css`
- `app/static/js/app.js`
- `app/routes/image.py`
- `app/services/watermark.py`
- `app/main.py`
- **Add** `app/services/font_catalog.py`
- **Add or update** `app/static/fonts/font_defaults.json`

The ZIP preserves the project's relative paths. Unzip into your existing project root and overwrite the listed code files. Do **not** delete your current signature PNGs, fonts, metadata service, or Bengali calendar files.

## Font folders

```text
app/static/fonts/
    font_defaults.json
    english/
        SunnyspellsRegular-MV9ze.otf
        ...other English .ttf/.otf files...
    bengali/
        Li Mahfuj AK Unicode.ttf
        ...other Bengali .ttf/.otf files...
    bengali.ttf             (keep existing working fallback)
    bengali-light.ttf       (keep existing working fallback)
    bengali-bold.ttf        (keep existing working fallback)
```

**Font files are not included in this ZIP.** Copy your own licensed TTF/OTF files into the language directories. The local `font_gallery.py` already writes `font_defaults.json` in the correct directory. Its selected defaults take precedence; don't replace your existing configuration if you've subsequently changed your choices.

Defaults configured from screenshots:

```json
{"english":"SunnyspellsRegular-MV9ze.otf", "bengali":"Li Mahfuj AK Unicode.ttf"}
```

The app scans the font folders on each `/api/image/fonts` request. Restart/reload when changing files; the initial page loads the catalog once. It groups filenames by family and expandable Regular/Bold/Italic/Condensed variants. Font previews and exports use the selected face; a Bold face is preferred when Bold timestamp is on, with a synthetic bold fallback.

## New interface

- Minimal screen with photo preview, language, timestamp summary, Bold, optional location, and Download.
- Advanced settings start **collapsed** on both desktop and mobile.
- Advanced: date/time editing, custom timestamp, location text, Panjika calendar, signature light/dark, left/center/right presets, and free drag of the three independent watermark layers.
- Enable **Move individual elements** and drag on the photo. Reset positions to return to the chosen alignment.
- GPS metadata yields **coordinates**, not a street address. Type a place/address manually in Advanced to override coordinates. If neither GPS nor manual place is available, location is hidden.
- The output image is rendered at original resolution. The frontend passes normalized coordinates/font sizes to the Pillow backend.

## Run locally

```cmd
python -m app.main
```

Open `http://localhost:8000`, hard-refresh, upload a photo, open Advanced when you need it, select fonts, try alignments/dragging, and download. Check JPEG landscape, portrait, Bengali Panjika and English.

## Notes

- Keep your deployed v1.4 as the rollback reference until you've checked v1.5 downloads with your actual font families.
- Free tier still has the prior 36MP processing limit; extra-large camera images may fail.
- Some ANSI/non-Unicode fonts cannot shape modern Bengali Unicode text; use Unicode fonts for reliable exports. Check that font licenses permit web embedding/distribution before committing them to a public repository.
- No deletion API was added to Render. The separate `font_gallery.py` remains a local-only helper for moving unwanted fonts to `_deleted`.
- Existing metadata and calendar logic is reused; Panjika conversion is still limited to validated 2025–2026 dates.
