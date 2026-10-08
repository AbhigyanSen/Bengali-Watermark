"""Step 03 metadata API; rendering is implemented in later steps."""

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.metadata import extract_metadata

router = APIRouter()
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


@router.post("/metadata")
def read_image_metadata(file: UploadFile = File(...)):
    # File size is verified before reading image pixels or metadata.
    try:
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded image is empty.")
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Maximum upload size is 50 MB.")
        try:
            result = extract_metadata(file.file)
        except ValueError as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        return {"file_size_bytes": size, **result}
    finally:
        file.file.close()
