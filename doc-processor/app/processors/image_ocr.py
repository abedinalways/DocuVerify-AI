import io
from typing import Any

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageSequence, UnidentifiedImageError

TESSERACT_CONFIG = "--oem 3 --psm 6"
MIN_OCR_DIMENSION = 1000
LOW_CONFIDENCE_THRESHOLD = 0.6


def _compute_deskew_angle(gray_img: np.ndarray) -> float:
    _, binary = cv2.threshold(gray_img, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    ys, xs = np.where(binary > 0)
    if len(xs) < 50:
        return 0.0

    coords = np.column_stack((xs, ys)).astype(np.float32)
    angle = cv2.minAreaRect(coords)[-1]

    if angle < -45:
        correction = 90 + angle
    elif angle > 45:
        correction = angle - 90
    else:
        correction = angle

    if abs(correction) < 0.5 or abs(correction) > 15.0:
        return 0.0

    return float(correction)


def _deskew(gray_img: np.ndarray) -> np.ndarray:
    angle = _compute_deskew_angle(gray_img)
    if angle == 0.0:
        return gray_img

    h, w = gray_img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    return cv2.warpAffine(
        gray_img,
        matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=255,
    )


def preprocess_for_ocr(pil_img: Image.Image) -> np.ndarray:
    gray = np.array(pil_img.convert("L"))
    h, w = gray.shape[:2]

    if h < MIN_OCR_DIMENSION or w < MIN_OCR_DIMENSION:
        scale = max(MIN_OCR_DIMENSION / max(h, 1), MIN_OCR_DIMENSION / max(w, 1), 1.5)
        scale = min(scale, 2.5)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    denoised = cv2.medianBlur(gray, 3)
    deskewed = _deskew(denoised)
    return cv2.adaptiveThreshold(
        deskewed,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )


def _parse_confidence(raw_conf: Any) -> float | None:
    try:
        value = float(raw_conf)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def _group_words_by_paragraph(
    data: dict[str, list[Any]],
) -> tuple[dict[tuple[int, int], dict[int, list[str]]], list[float]]:
    texts = data.get("text", [])
    confs = data.get("conf", [])
    blocks = data.get("block_num", [])
    pars = data.get("par_num", [])
    lines = data.get("line_num", [])

    confidences: list[float] = []
    paragraphs: dict[tuple[int, int], dict[int, list[str]]] = {}

    for idx, raw_word in enumerate(texts):
        word = str(raw_word).strip()
        if not word:
            continue

        conf = _parse_confidence(confs[idx] if idx < len(confs) else None)
        if conf is not None:
            confidences.append(conf)

        key = (
            int(blocks[idx]) if idx < len(blocks) else 0,
            int(pars[idx]) if idx < len(pars) else 0,
        )
        line_id = int(lines[idx]) if idx < len(lines) else 0
        paragraphs.setdefault(key, {}).setdefault(line_id, []).append(word)

    return paragraphs, confidences


def _reconstruct_text_and_confidence(data: dict[str, list[Any]]) -> tuple[str, float]:
    paragraphs, confidences = _group_words_by_paragraph(data)
    paragraph_blocks = [
        "\n".join(" ".join(words) for words in par_lines.values())
        for par_lines in paragraphs.values()
    ]
    extracted_text = "\n\n".join(block for block in paragraph_blocks if block).strip()
    avg_conf = round((sum(confidences) / len(confidences)) / 100.0, 4) if confidences else 0.0
    return extracted_text, avg_conf


def ocr_pil_image(pil_img: Image.Image) -> tuple[str, float]:
    processed = preprocess_for_ocr(pil_img)
    data = pytesseract.image_to_data(
        processed,
        config=TESSERACT_CONFIG,
        output_type=pytesseract.Output.DICT,
    )
    return _reconstruct_text_and_confidence(data)


def process_image_bytes(content: bytes) -> dict[str, Any]:
    try:
        with Image.open(io.BytesIO(content)) as probe:
            probe.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError(f"Corrupted or unreadable image file: {exc}") from exc

    pages: list[dict[str, Any]] = []
    warnings: list[str] = []
    confidences: list[float] = []

    try:
        with Image.open(io.BytesIO(content)) as img:
            for idx, frame in enumerate(ImageSequence.Iterator(img), start=1):
                with frame.convert("RGB") as rgb_frame:
                    text, conf = ocr_pil_image(rgb_frame)

                confidences.append(conf)
                if conf < LOW_CONFIDENCE_THRESHOLD:
                    warnings.append(
                        f"Page {idx}: Low OCR confidence ({conf:.2f}) - image quality may be poor."
                    )
                pages.append({
                    "page_number": idx,
                    "method": "ocr",
                    "confidence": conf,
                    "text": text,
                })
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError(f"Corrupted or unreadable image file: {exc}") from exc

    combined_text = "\n\n".join(
        f"--- Page {p['page_number']} ---\n{p['text']}" for p in pages if p["text"]
    )
    avg_conf = round(sum(confidences) / len(confidences), 4) if confidences else 0.0

    return {
        "page_count": len(pages),
        "extraction_method": "ocr",
        "ocr_confidence": avg_conf,
        "raw_text": combined_text,
        "pages": pages,
        "sheets": None,
        "warnings": warnings,
    }
