import io

import cv2
import numpy as np
import openpyxl
import pymupdf
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app

client = TestClient(app)


def _make_text_image_bytes(text: str, angle: float = 0.0, fmt: str = "PNG") -> bytes:
    canvas = np.full((600, 1000), 255, dtype=np.uint8)
    cv2.putText(canvas, text, (60, 220), cv2.FONT_HERSHEY_SIMPLEX, 1.2, 0, 3)

    if angle != 0.0:
        matrix = cv2.getRotationMatrix2D((500, 300), angle, 1.0)
        canvas = cv2.warpAffine(canvas, matrix, (1000, 600), borderValue=255)

    buf = io.BytesIO()
    Image.fromarray(canvas).save(buf, format=fmt)
    return buf.getvalue()


def _make_hybrid_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "INVOICE #INV-2026-01\nSupplier: CareGuide Ltd\nTotal: 500.00 USD")

    p2 = doc.new_page()
    img_bytes = _make_text_image_bytes("SCANNED PAGE 2 TOTAL 250.00")
    p2.insert_image(pymupdf.Rect(50, 50, 550, 350), stream=img_bytes)

    p3 = doc.new_page()
    p3.insert_text((72, 72), "Page 3 Summary: Subtotal 450.00 Tax 50.00 Total 500.00")

    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def _make_multisheet_xlsx_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Invoices"
    ws.append(["Care Guide Supplies"])
    ws.append(["Batch Report", "2026-11-26"])
    ws.append([])
    ws.append(["Item", "Qty", "Amount", "Amount"])
    ws.append(["Gloves", 10, 55.0, 55.0])
    ws.append(["Masks", 20, 40.0, 40.0])
    wb.create_sheet("Empty")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "doc-processor"}


def test_process_hybrid_pdf_full_and_chunked() -> None:
    pdf_bytes = _make_hybrid_pdf_bytes()

    full_res = client.post(
        "/process",
        files={"file": ("invoice.pdf", pdf_bytes, "application/pdf")},
    )
    assert full_res.status_code == 200
    body = full_res.json()
    assert body["status"] == "success"
    assert body["total_pages"] == 3
    assert body["page_count"] == 3
    assert body["extraction_method"] == "hybrid"
    assert body["digital_pages"] == 2
    assert body["ocr_pages"] == 1
    assert "250.00" in body["raw_text"]

    chunk_res = client.post(
        "/process?start_page=2&end_page=3",
        files={"file": ("invoice.pdf", pdf_bytes, "application/pdf")},
    )
    assert chunk_res.status_code == 200
    chunk = chunk_res.json()
    assert chunk["status"] == "success"
    assert chunk["total_pages"] == 3
    assert chunk["start_page"] == 2
    assert chunk["end_page"] == 3
    assert chunk["page_count"] == 2
    assert chunk["pages"][0]["page_number"] == 2


def test_process_tilted_png_and_multiframe_tiff() -> None:
    tilted_png = _make_text_image_bytes("TOTAL USD 1250.00", angle=5.0, fmt="PNG")
    png_res = client.post(
        "/process",
        files={"file": ("scan.png", tilted_png, "image/png")},
    )
    assert png_res.status_code == 200
    png_body = png_res.json()
    assert png_body["status"] == "success"
    assert "1250.00" in png_body["raw_text"]

    f1 = Image.open(io.BytesIO(_make_text_image_bytes("TIFF PAGE ONE 100.00")))
    f2 = Image.open(io.BytesIO(_make_text_image_bytes("TIFF PAGE TWO 200.00")))
    tiff_buf = io.BytesIO()
    f1.save(tiff_buf, format="TIFF", save_all=True, append_images=[f2])

    tiff_res = client.post(
        "/process",
        files={"file": ("multi.tiff", tiff_buf.getvalue(), "image/tiff")},
    )
    assert tiff_res.status_code == 200
    tiff_body = tiff_res.json()
    assert tiff_body["status"] == "success"
    assert tiff_body["page_count"] == 2
    assert "200.00" in tiff_body["raw_text"]


def test_process_csv_and_xlsx() -> None:
    csv_bytes = b"invoice_no;vendor;total\n00123;CareGuide;450.75\n"
    csv_res = client.post(
        "/process",
        files={"file": ("ledger.csv", csv_bytes, "text/csv")},
    )
    assert csv_res.status_code == 200
    csv_body = csv_res.json()
    assert csv_body["status"] == "success"
    assert csv_body["sheets"][0]["rows"][0]["invoice_no"] == "00123"
    assert csv_body["sheets"][0]["rows"][0]["total"] == 450.75

    xlsx_res = client.post(
        "/process",
        files={
            "file": (
                "report.xlsx",
                _make_multisheet_xlsx_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert xlsx_res.status_code == 200
    xlsx_body = xlsx_res.json()
    assert xlsx_body["status"] == "success"
    assert xlsx_body["page_count"] == 2
    assert xlsx_body["sheets"][0]["columns"] == ["Item", "Qty", "Amount", "Amount_2"]
    assert xlsx_body["sheets"][0]["row_count"] == 2
    assert xlsx_body["sheets"][1]["row_count"] == 0


def test_validation_and_corrupted_file_failures() -> None:
    empty_res = client.post("/process", files={"file": ("empty.pdf", b"", "application/pdf")})
    assert empty_res.status_code == 200
    assert empty_res.json()["status"] == "failed"

    bad_ext = client.post(
        "/process",
        files={"file": ("script.exe", b"MZ...", "application/octet-stream")},
    )
    assert bad_ext.status_code == 200
    assert bad_ext.json()["status"] == "failed"

    fake_csv = client.post(
        "/process",
        files={"file": ("fake.csv", b"\x89PNG\r\n\x1a\n\x00\x00", "text/csv")},
    )
    assert fake_csv.status_code == 200
    assert fake_csv.json()["status"] == "failed"

    corrupt_pdf = client.post(
        "/process",
        files={"file": ("bad.pdf", b"%PDF-1.4\nbroken", "application/pdf")},
    )
    assert corrupt_pdf.status_code == 200
    assert corrupt_pdf.json()["status"] == "failed"


def test_process_batch_mixed_files() -> None:
    csv_bytes = b"id,total\nINV-1,100\n"
    bad_bytes = b"not-a-pdf"

    res = client.post(
        "/process-batch",
        files=[
            ("files", ("ok.csv", csv_bytes, "text/csv")),
            ("files", ("broken.pdf", bad_bytes, "application/pdf")),
        ],
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 2
    assert body["succeeded"] == 1
    assert body["failed"] == 1
