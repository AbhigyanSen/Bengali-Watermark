"""Bengali Watermark Studio — API and frontend host (Step 03)."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routes.image import router as image_router

APP_DIR = Path(__file__).resolve().parent

app = FastAPI(title="Bengali Watermark Studio", version="0.3.0")
app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")
app.include_router(image_router, prefix="/api/image", tags=["images"])


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(APP_DIR / "templates" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "step": 3}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
