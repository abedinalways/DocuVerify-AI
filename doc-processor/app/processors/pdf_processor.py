from typing import Any

import pymupdf
from PIL import Image

from app.processors.image_ocr import LOW_CONFIDENCE_THRESHOLD, ocr_pil_image

MIN_DIGITAL_TEXT_CHARS = 25
OCR_RENDER_DPI = 220


def _extract_page(page: pymupdf.Page, page_number: int) -> tuple[dict[str, Any], str | None]:
    digital_text = page.get_text("text").strip()
    if len(digital_text) >= MIN_DIGITAL_TEXT_CHARS:
        return (
            {
                "page_number": page_number,
                "method": "digital_text",
                "confidence": 1.0,
                "text": digital_text,
            },
            None,
        )

    pix = page.get_pixmap(dpi=OCR_RENDER_DPI, colorspace=pymupdf.csRGB, alpha=False)
    try:
        with Image.frombytes("RGB", (pix.width, pix.height), pix.samples) as pil_img:
            ocr_text, conf = ocr_pil_image(pil_img)
    finally:
        del pix

    warning = (
        f"Page {page_number}: Low OCR confidence ({conf:.2f})."
        if conf < LOW_CONFIDENCE_THRESHOLD
        else None
    )
    return (
        {
            "page_number": page_number,
            "method": "ocr",
            "confidence": conf,
            "text": ocr_text,
        },
        warning,
    )


def _resolve_extraction_method(digital_count: int, ocr_count: int) -> str:
    if digital_count > 0 and ocr_count > 0:
        return "hybrid"
    if ocr_count > 0:
        return "ocr"
    return "digital_text"


def _extract_page_range(
    doc: pymupdf.Document,
    start_page: int,
    end_page: int,
) -> tuple[list[dict[str, Any]], int, int, list[str]]:
    pages: list[dict[str, Any]] = []
    warnings: list[str] = []
    digital_count = 0
    ocr_count = 0

    for idx in range(start_page - 1, end_page):
        page_result, warning = _extract_page(doc.load_page(idx), idx + 1)
        pages.append(page_result)
        if page_result["method"] == "digital_text":
            digital_count += 1
        else:
            ocr_count += 1
        if warning:
            warnings.append(warning)

    return pages, digital_count, ocr_count, warnings


def process_pdf_bytes(
    content: bytes,
    start_page: int = 1,
    end_page: int | None = None,
) -> dict[str, Any]:
    if start_page < 1:
        raise ValueError("start_page must be >= 1.")

    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Corrupted or unreadable PDF file: {exc}") from exc

    try:
        if doc.is_encrypted:
            raise ValueError("PDF is password-protected / encrypted and cannot be processed.")

        total_pages = len(doc)
        if total_pages == 0:
            raise ValueError("PDF contains 0 pages.")

        resolved_end = min(end_page, total_pages) if end_page is not None else total_pages
        if start_page > resolved_end:
            raise ValueError(
                f"Invalid page range {start_page}-{resolved_end} for PDF with {total_pages} pages."
            )

        pages, digital_count, ocr_count, warnings = _extract_page_range(
            doc, start_page, resolved_end
        )
    finally:
        doc.close()

    all_confs = [p["confidence"] for p in pages]
    avg_conf = round(sum(all_confs) / len(all_confs), 4) if all_confs else 0.0
    combined_text = "\n\n".join(
        f"--- Page {p['page_number']} ---\n{p['text']}" for p in pages if p["text"]
    )

    return {
        "total_pages": total_pages,
        "start_page": start_page,
        "end_page": resolved_end,
        "page_count": len(pages),
        "extraction_method": _resolve_extraction_method(digital_count, ocr_count),
        "ocr_confidence": avg_conf,
        "digital_pages": digital_count,
        "ocr_pages": ocr_count,
        "raw_text": combined_text,
        "pages": pages,
        "sheets": None,
        "warnings": warnings,
    }
