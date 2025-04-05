from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import os
from typing import List

router = APIRouter()

@router.post("/upload")
async def upload_images(
    files: List[UploadFile] = File(...),
    save_location: str = Form("/images")
):
    # Ensure the save location exists
    if not os.path.exists(save_location):
        os.makedirs(save_location)

    saved_files = []
    for file in files:
        file_path = os.path.join(save_location, file.filename)
        try:
            with open(file_path, "wb") as f:
                f.write(await file.read())
            saved_files.append(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save {file.filename}: {str(e)}")

    return {"message": "Files uploaded successfully", "saved_files": saved_files}