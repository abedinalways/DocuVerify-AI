import asyncio
import time
from typing import Any

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.processors.image_ocr import process_image_bytes
from app.processors.pdf_processor import process_pdf_bytes
from app.processors.spreadsheet_processor import process_spreadsheet_bytes
from app.utils.file_validator import compute_sha256, validate_file

MAX_BATCH_CONCURRENCY = 4
IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".tiff", ".tif"})
SPREADSHEET_EXTENSIONS = frozenset({".xlsx", ".xls", ".csv"})

app = FastAPI(
    title="DocuVerify AI - Document Processor Service",
    version="1.0.0",
)


def _dispatch_processor(
    content: bytes,
    ext: str,
    start_page: int,
    end_page: int | None,
) -> dict[str, Any]:
    if ext == ".pdf":
        return process_pdf_bytes(content, start_page=start_page, end_page=end_page)
    if ext in IMAGE_EXTENSIONS:
        return process_image_bytes(content)
    if ext in SPREADSHEET_EXTENSIONS:
        return process_spreadsheet_bytes(content, ext)
    raise ValueError(f"Unsupported file type: {ext}")


def _build_failure_result(
    filename: str,
    ext: str,
    content: bytes,
    elapsed_ms: float,
    error_message: str,
) -> dict[str, Any]:
    return {
        "status": "failed",
        "filename": filename,
        "file_type": ext,
        "file_size_bytes": len(content),
        "file_hash": compute_sha256(content) if content else None,
        "processing_time_ms": round(elapsed_ms, 2),
        "error": error_message,
    }


async def _handle_single_file(
    file: UploadFile,
    start_page: int = 1,
    end_page: int | None = None,
) -> dict[str, Any]:
    start = time.perf_counter()
    filename = file.filename or "unknown"

    try:
        content = await file.read()
    finally:
        await file.close()

    is_valid, ext, err_msg = validate_file(filename, content)
    if not is_valid:
        return _build_failure_result(
            filename,
            ext,
            content,
            (time.perf_counter() - start) * 1000,
            err_msg,
        )

    try:
        result = await run_in_threadpool(
            _dispatch_processor,
            content,
            ext,
            start_page,
            end_page,
        )
        return {
            "status": "success",
            "filename": filename,
            "file_type": ext,
            "file_size_bytes": len(content),
            "file_hash": compute_sha256(content),
            "processing_time_ms": round((time.perf_counter() - start) * 1000, 2),
            "error": None,
            **result,
        }
    except (ValueError, OSError, RuntimeError, LookupError, TypeError) as exc:
        return _build_failure_result(
            filename,
            ext,
            content,
            (time.perf_counter() - start) * 1000,
            str(exc),
        )


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "doc-processor"}


@app.post("/process")
async def process_document(
    file: UploadFile = File(...),
    start_page: int = Query(default=1, ge=1),
    end_page: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    return await _handle_single_file(file, start_page=start_page, end_page=end_page)


@app.post("/process-batch")
async def process_batch(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(MAX_BATCH_CONCURRENCY)

    async def _bounded_process(upload: UploadFile) -> dict[str, Any]:
        async with semaphore:
            return await _handle_single_file(upload)

    results = await asyncio.gather(*(_bounded_process(f) for f in files))
    success_count = sum(1 for r in results if r["status"] == "success")
    return {
        "total": len(results),
        "succeeded": success_count,
        "failed": len(results) - success_count,
        "results": results,
    }
