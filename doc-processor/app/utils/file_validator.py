import hashlib
from pathlib import Path

SUPPORTED_EXTENSIONS = frozenset({
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".tiff",
    ".tif",
    ".xlsx",
    ".xls",
    ".csv",
})

MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024

MAGIC_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".tiff": (b"II*\x00", b"MM\x00*"),
    ".tif": (b"II*\x00", b"MM\x00*"),
    ".xlsx": (b"PK\x03\x04",),
    ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
}


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _is_valid_pdf_header(content: bytes) -> bool:
    return b"%PDF-" in content[:1024]


def _is_valid_text_csv(content: bytes) -> bool:
    sample = content[:8192]
    if b"\x00" in sample or not content.strip():
        return False

    control_bytes = sum(1 for b in sample if b < 32 and b not in (9, 10, 13))
    return (control_bytes / len(sample)) <= 0.05


def _check_content_error(ext: str, content: bytes) -> str | None:
    if not content:
        return "Uploaded file is empty (0 bytes)."

    if len(content) > MAX_FILE_SIZE_BYTES:
        limit_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        return f"File exceeds maximum allowed size of {limit_mb} MB."

    if ext == ".pdf" and not _is_valid_pdf_header(content):
        return "Invalid PDF signature (file may be corrupted or renamed)."

    if ext == ".csv" and not _is_valid_text_csv(content):
        return "CSV file is empty or contains invalid binary data."

    if ext in MAGIC_SIGNATURES:
        signatures = MAGIC_SIGNATURES[ext]
        if not any(content.startswith(sig) for sig in signatures):
            return f"File signature does not match '{ext}' format."

    return None


def validate_file(filename: str, content: bytes) -> tuple[bool, str, str]:
    if not filename or not filename.strip():
        return False, "", "Filename is missing."

    ext = Path(filename.strip()).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        allowed = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        return False, ext, f"Unsupported file format '{ext}'. Allowed: {allowed}"

    content_error = _check_content_error(ext, content)
    if content_error:
        return False, ext, content_error

    return True, ext, ""
