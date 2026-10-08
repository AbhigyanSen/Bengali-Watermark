"""Bengali Watermark Studio - local font gallery (development helper).

Run from the project root:
    python font_gallery.py

Uses only Python's standard library; opens a local browser page to compare
TTF/OTF fonts in app/static/fonts/{english,bengali}, choose language defaults,
and safely move unwanted font files into app/static/fonts/_deleted.

IMPORTANT: This tool DOES NOT change the production image renderer yet.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import threading
from urllib.parse import quote, unquote, urlsplit
import webbrowser


PROJECT_ROOT = Path(__file__).resolve().parent
FONT_ROOT = PROJECT_ROOT / "app" / "static" / "fonts"
DEFAULTS_PATH = FONT_ROOT / "font_defaults.json"
LANGUAGES = ("english", "bengali")
EXTENSIONS = {".ttf", ".otf"}
SESSION_TOKEN = secrets.token_urlsafe(32)

HTML = r'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Font Gallery · Bengali Watermark Studio</title>
  <style>
    :root { color-scheme: light; --ink:#23303a; --muted:#687783; --line:#dee6eb;
      --green:#126b61; --light:#eaf5f1; --paper:#fff; --bg:#f4f7f9; }
    * {box-sizing:border-box}
    body {margin:0; background:var(--bg); color:var(--ink); font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    button {font:inherit; cursor:pointer}
    button:focus-visible {outline:3px solid #91c8bb; outline-offset:3px}
    .shell {max-width:1120px; margin:auto; padding:28px 20px 60px}
    header {display:flex; justify-content:space-between; align-items:center; gap:14px; margin-bottom:14px}
    .brand {font-weight:750; font-size:14px; letter-spacing:-.01em}
    .tag {font-size:11px; color:#166052; background:#dff2e9; padding:7px 11px; border-radius:30px; white-space:nowrap}
    h1 {font-size:clamp(26px,4vw,40px); margin:14px 0 7px; letter-spacing:-.045em}
    .sub {line-height:1.6; color:var(--muted); font-size:14px; margin:0 0 22px}
    .tabs {display:flex; background:#e8eef1; padding:5px; border-radius:13px; gap:5px; margin:22px 0}
    .tab {flex:1; border:0; padding:12px; border-radius:9px; color:#5f707b; background:transparent; font-weight:650}
    .tab.active {background:white; color:var(--green); box-shadow:0 2px 9px #19373916}
    .toolbar {display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 14px}
    h2 {font-size:16px; margin:0}
    .count {color:var(--muted); font-size:12px}
    .grid {display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px}
    .card {border:1px solid var(--line); border-radius:16px; background:white; overflow:hidden; min-width:0}
    .card.selected {border-color:#4ba494; box-shadow:0 0 0 2px #d9eee6}
    .top {display:flex; align-items:flex-start; justify-content:space-between; gap:9px; padding:17px 17px 6px}
    .name {font-size:13px; font-weight:750; overflow-wrap:anywhere; line-height:1.4; margin:0}
    .metadata {color:#82909a; font-size:11px; margin-top:5px}
    .selected-tag {font-size:10px; color:#0d6655; background:#dcf5ea; border-radius:20px; padding:5px 8px; white-space:nowrap}
    .previews {padding:4px 17px 12px}
    .example {padding:12px 0; border-bottom:1px solid #eff2f4}
    .example:last-child {border-bottom:0}
    .language-label {display:block; font:650 10px system-ui,sans-serif; color:#83909c; letter-spacing:.08em; text-transform:uppercase; margin-bottom:7px}
    .sample {font-size:18px; line-height:1.65; overflow-wrap:anywhere; font-weight:400}
    .sample.bn {font-size:20px; line-height:1.8}
    .actions {display:flex; justify-content:space-between; gap:10px; align-items:center; border-top:1px solid #edf1f3; padding:12px 16px}
    .primary {background:var(--green); border:1px solid var(--green); color:white; border-radius:8px; padding:9px 13px; font-size:12px; font-weight:700}
    .primary:disabled {background:#eaf5f1; border-color:#d4e8de; color:#327767; cursor:default}
    .danger {border:1px solid transparent; background:transparent; color:#ac4444; border-radius:8px; padding:9px 10px; font-size:12px}
    .danger:hover {background:#fdf1f0}
    .info {border:1px solid var(--line); border-radius:12px; padding:13px 15px; background:#fff; color:#667783; font-size:12px; line-height:1.65; margin-top:21px}
    .empty {grid-column:1/-1; border:1px dashed #a8b8c0; background:white; border-radius:15px; text-align:center; padding:55px 20px; color:var(--muted); line-height:1.7}
    .empty strong {display:block; color:var(--ink); margin-bottom:6px}
    .status {min-height:20px; color:var(--green); font-size:12px; margin:8px 0}
    .status.error {color:#b33e38}
    code {background:#edf1f3; padding:1px 5px; border-radius:4px; overflow-wrap:anywhere}
    @media(max-width:700px){.shell{padding:17px 12px 45px}.grid{grid-template-columns:1fr}.tabs{margin:17px 0}.sample{font-size:17px}.sample.bn{font-size:19px}}
  </style>
</head>
<body>
  <main class="shell">
    <header><span class="brand">বাংলা Watermark Studio / Font Gallery</span><span class="tag">Local only</span></header>
    <h1>Find your perfect font.</h1>
    <p class="sub">Compare your own fonts with real English and Bengali samples. Choose one default for each language. Nothing is uploaded to the internet.</p>
    <div class="tabs" role="tablist" aria-label="Language">
      <button class="tab active" id="tab-english" role="tab" aria-selected="true" type="button">English <span id="count-english"></span></button>
      <button class="tab" id="tab-bengali" role="tab" aria-selected="false" type="button">বাংলা <span id="count-bengali"></span></button>
    </div>
    <section aria-label="Available fonts">
      <div class="toolbar"><h2 id="section-title">English fonts</h2><span class="count" id="default-label">No default selected</span></div>
      <div class="status" id="status" role="status" aria-live="polite"></div>
      <div class="grid" id="font-grid"></div>
    </section>
    <div class="info">
      <strong>Font folders:</strong> <code>app/static/fonts/english/</code> and <code>app/static/fonts/bengali/</code>.<br>
      Selecting a default saves it in <code>app/static/fonts/font_defaults.json</code>.
      <strong>Delete</strong> removes the font from the active collection but moves it into <code>app/static/fonts/_deleted/</code> for recovery.<br>
      Font selection in the main watermark app will be connected in the next version. Some fonts only support one language; unsupported characters may display using a fallback font.
    </div>
  </main>
  <script>
    "use strict";
    const TOKEN = __TOKEN_JSON__;
    const ENGLISH = "The quick brown fox jumps over the lazy dog — 08 October 2026.";
    const BENGALI = "আজকের সুন্দর মুহূর্তগুলো স্মৃতিতে রয়ে যাবে — ০৮ অক্টোবর ২০২৬।";
    const fontFaces = new Map();
    let faceCounter = 0;
    let language = "english";
    let gallery = {fonts:{english:[],bengali:[]},defaults:{english:null,bengali:null}};
    const $ = id => document.getElementById(id);

    function status(message, error = false) {
      $("status").textContent = message;
      $("status").classList.toggle("error", error);
    }

    async function request(path, body) {
      const opts = body === undefined ? {} : {
        method: "POST",
        headers: {"Content-Type":"application/json", "X-Gallery-Token":TOKEN},
        body: JSON.stringify(body)
      };
      const response = await fetch(path, opts);
      let data;
      try { data = await response.json(); } catch { throw new Error("Invalid server response."); }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    }

    async function ensureFace(item) {
      const key = `${language}/${item.name}`;
      if (fontFaces.has(key)) return fontFaces.get(key);
      const family = `local_gallery_${++faceCounter}`;
      const record = {family, promise: null};
      fontFaces.set(key, record);
      const face = new FontFace(family, `url(${JSON.stringify(item.url)})`);
      record.promise = face.load().then(loaded => {
        document.fonts.add(loaded);
        return true;
      }).catch(error => {
        console.warn("Font failed to load:", item.name, error);
        return false;
      });
      return record;
    }

    function sample(label, value, isBengali) {
      const wrapper = document.createElement("div");
      wrapper.className = "example";
      const labelEl = document.createElement("span");
      labelEl.className = "language-label";
      labelEl.textContent = label;
      const demo = document.createElement("div");
      demo.className = isBengali ? "sample bn" : "sample";
      demo.lang = isBengali ? "bn" : "en";
      demo.textContent = value;
      wrapper.append(labelEl, demo);
      return {wrapper, demo};
    }

    function draw() {
      const fonts = gallery.fonts[language] || [];
      const selected = gallery.defaults[language];
      const grid = $("font-grid");
      grid.replaceChildren();
      $("section-title").textContent = language === "english" ? "English fonts" : "Bengali fonts";
      $("default-label").textContent = selected ? `Default: ${selected}` : "No default selected";
      for (const lang of ["english", "bengali"]) {
        $("tab-"+lang).classList.toggle("active", lang === language);
        $("tab-"+lang).setAttribute("aria-selected", String(lang === language));
        $("count-"+lang).textContent = `(${gallery.fonts[lang].length})`;
      }
      if (!fonts.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        const title = document.createElement("strong");
        title.textContent = "No fonts here yet";
        const body = document.createElement("span");
        body.textContent = `Copy .ttf or .otf files into app/static/fonts/${language}/ and refresh this page.`;
        empty.append(title,body);
        grid.appendChild(empty);
        return;
      }
      for (const item of fonts) {
        const isDefault = selected === item.name;
        const card = document.createElement("article");
        card.className = `card${isDefault ? " selected" : ""}`;
        const top = document.createElement("div");
        top.className = "top";
        const about = document.createElement("div");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = item.name;
        const meta = document.createElement("div");
        meta.className = "metadata";
        meta.textContent = `${(item.bytes / 1024).toFixed(0)} KB`;
        about.append(name, meta);
        top.appendChild(about);
        if (isDefault) {
          const badge = document.createElement("span");
          badge.className = "selected-tag";
          badge.textContent = "Default ✓";
          top.appendChild(badge);
        }
        const previews = document.createElement("div");
        previews.className = "previews";
        const en = sample("English demo", ENGLISH, false);
        const bn = sample("বাংলা নমুনা", BENGALI, true);
        previews.append(en.wrapper, bn.wrapper);
        const actions = document.createElement("div");
        actions.className = "actions";
        const set = document.createElement("button");
        set.className = "primary";
        set.type = "button";
        set.textContent = isDefault ? "Current default" : "Set as default";
        set.disabled = isDefault;
        set.addEventListener("click", async () => {
          set.disabled = true;
          try {
            gallery = await request("/api/default", {language, filename:item.name});
            status(`Selected ${item.name} as your ${language} default.`);
            draw();
          } catch (error) {status(error.message, true); set.disabled = false;}
        });
        const remove = document.createElement("button");
        remove.className = "danger";
        remove.type = "button";
        remove.textContent = "Delete";
        remove.title = "Moves font to _deleted folder (recoverable)";
        remove.addEventListener("click", async () => {
          const message = `Remove ${item.name} from the ${language} collection?\n\nIt will be moved to app/static/fonts/_deleted/${language}/, not permanently erased.`;
          if (!window.confirm(message)) return;
          remove.disabled = true;
          try {
            gallery = await request("/api/delete", {language, filename:item.name});
            fontFaces.delete(`${language}/${item.name}`);
            status(`${item.name} moved to the _deleted folder.`);
            draw();
          } catch (error) {status(error.message, true); remove.disabled = false;}
        });
        actions.append(set, remove);
        card.append(top, previews, actions);
        grid.appendChild(card);
        ensureFace(item).then(record => {
          en.demo.style.fontFamily = `"${record.family}", "Segoe UI", sans-serif`;
          bn.demo.style.fontFamily = `"${record.family}", "Nirmala UI", sans-serif`;
          record.promise.then(ok => {
            if (!ok) {
              meta.textContent = "Cannot preview — invalid font file";
              meta.style.color = "#af4848";
            }
          });
        });
      }
    }

    async function refresh() {
      gallery = await request("/api/fonts");
      draw();
    }
    $("tab-english").addEventListener("click", () => {language="english"; status(""); draw();});
    $("tab-bengali").addEventListener("click", () => {language="bengali"; status(""); draw();});
    refresh().catch(error => status(error.message, true));
  </script>
</body>
</html>'''


def prepare_folders() -> None:
    for language in LANGUAGES:
        (FONT_ROOT / language).mkdir(parents=True, exist_ok=True)


def load_defaults() -> dict[str, str | None]:
    defaults: dict[str, str | None] = {"english": None, "bengali": None}
    if DEFAULTS_PATH.is_file():
        try:
            raw = json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for language in LANGUAGES:
                    if isinstance(raw.get(language), str):
                        defaults[language] = raw[language]
        except (OSError, ValueError):
            pass
    for language in LANGUAGES:
        name = defaults[language]
        if name is not None:
            try:
                font_path = safe_font_path(language, name)
                if not font_path.is_file():
                    defaults[language] = None
            except ValueError:
                defaults[language] = None
    return defaults


def save_defaults(defaults: dict[str, str | None]) -> None:
    temporary = FONT_ROOT / f".font_defaults_{secrets.token_hex(5)}.tmp"
    try:
        temporary.write_text(
            json.dumps(defaults, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, DEFAULTS_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def safe_font_path(language: object, filename: object) -> Path:
    if language not in LANGUAGES:
        raise ValueError("Invalid font language.")
    if not isinstance(filename, str) or not filename or len(filename) > 250:
        raise ValueError("Invalid font filename.")
    if filename in {".", ".."} or any(char in filename for char in "/\\\0"):
        raise ValueError("Invalid font filename.")
    if Path(filename).name != filename or Path(filename).suffix.lower() not in EXTENSIONS:
        raise ValueError("Only individual TTF/OTF files are allowed.")
    folder = (FONT_ROOT / language).resolve()
    candidate = FONT_ROOT / language / filename
    if candidate.is_symlink() or candidate.resolve().parent != folder:
        raise ValueError("Font path is not allowed.")
    return candidate


def snapshot() -> dict:
    defaults = load_defaults()
    result: dict[str, list[dict]] = {}
    for language in LANGUAGES:
        folder = FONT_ROOT / language
        items = []
        for path in sorted(folder.iterdir(), key=lambda entry: entry.name.casefold()):
            if not path.is_file() or path.is_symlink() or path.suffix.lower() not in EXTENSIONS:
                continue
            items.append({
                "name": path.name,
                "bytes": path.stat().st_size,
                "url": f"/font/{language}/{quote(path.name, safe='')}",
            })
        result[language] = items
    return {"fonts": result, "defaults": defaults}


class FontGalleryHandler(BaseHTTPRequestHandler):
    server_version = "LocalFontGallery/1.0"

    def _send(self, status: int, content: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(content)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _host_ok(self) -> bool:
        # Restrict access to the exact loopback origin to prevent DNS rebinding.
        expected = f"127.0.0.1:{self.server.server_port}"
        return self.headers.get("Host") == expected

    def do_GET(self) -> None:
        if not self._host_ok():
            self._json(403, {"error": "Localhost access only."})
            return
        path = urlsplit(self.path).path
        if path == "/":
            html = HTML.replace("__TOKEN_JSON__", json.dumps(SESSION_TOKEN))
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/fonts":
            try:
                self._json(200, snapshot())
            except OSError as exc:
                self._json(500, {"error": str(exc)})
        elif path.startswith("/font/"):
            pieces = path.split("/", 3)
            if len(pieces) != 4:
                self._json(404, {"error": "Unknown font."})
                return
            try:
                font_path = safe_font_path(pieces[2], unquote(pieces[3]))
                if not font_path.is_file():
                    raise FileNotFoundError("Font no longer exists.")
                suffix = font_path.suffix.lower()
                mime = "font/ttf" if suffix == ".ttf" else "font/otf"
                self._send(200, font_path.read_bytes(), mime)
            except (ValueError, FileNotFoundError):
                self._json(404, {"error": "Font not found."})
            except OSError as exc:
                self._json(500, {"error": str(exc)})
        else:
            self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if not self._host_ok():
            self._json(403, {"error": "Localhost access only."})
            return
        origin = self.headers.get("Origin")
        if origin != f"http://127.0.0.1:{self.server.server_port}":
            self._json(403, {"error": "Invalid request origin."})
            return
        if not secrets.compare_digest(self.headers.get("X-Gallery-Token", ""), SESSION_TOKEN):
            self._json(403, {"error": "Invalid gallery session."})
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self._json(415, {"error": "JSON required."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 4096:
                raise ValueError("Request is too large or empty.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Invalid request body.")
            language = data.get("language")
            filename = data.get("filename")
            font_path = safe_font_path(language, filename)
            if not font_path.is_file():
                raise ValueError("Font not found. Refresh the gallery.")
            if self.path == "/api/default":
                defaults = load_defaults()
                defaults[language] = filename
                save_defaults(defaults)
            elif self.path == "/api/delete":
                # Recoverable deletion: keep removed files outside active folders.
                defaults = load_defaults()
                was_default = defaults.get(language) == filename
                archive = FONT_ROOT / "_deleted" / language
                archive.mkdir(parents=True, exist_ok=True)
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                destination = archive / f"{stamp}_{secrets.token_hex(3)}_{filename}"
                font_path.rename(destination)
                if was_default:
                    defaults[language] = None
                    save_defaults(defaults)
            else:
                self._json(404, {"error": "Unknown operation."})
                return
            self._json(200, snapshot())
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except OSError as exc:
            self._json(500, {"error": f"Cannot update font files: {exc}"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Preview, choose, and organize English and Bengali fonts locally.")
    parser.add_argument("--port", type=int, default=8765, help="Local port (default 8765; use 0 for automatic).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    args = parser.parse_args()
    prepare_folders()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), FontGalleryHandler)
    except OSError:
        if args.port == 8765:
            server = ThreadingHTTPServer(("127.0.0.1", 0), FontGalleryHandler)
        else:
            raise
    url = f"http://127.0.0.1:{server.server_port}"
    print("\nBengali Watermark Studio — Local Font Gallery", flush=True)
    print(f"Font folder: {FONT_ROOT}", flush=True)
    print(f"Open: {url}", flush=True)
    print("Press Ctrl+C to stop. The gallery is accessible only from this computer.\n", flush=True)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nFont gallery stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
