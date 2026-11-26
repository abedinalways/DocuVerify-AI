import datetime
import io
from typing import Any

import chardet
import numpy as np
import pandas as pd

MAX_HEADER_SCAN_ROWS = 15
MAX_TEXT_ROWS_PER_SHEET = 2000


def _clean_cell(val: Any) -> Any:
    if val is None or pd.isna(val):
        return None
    if isinstance(val, (pd.Timestamp, datetime.datetime, datetime.date)):
        return val.isoformat()
    if isinstance(val, (np.integer, np.floating, np.bool_)):
        return val.item()
    if isinstance(val, str):
        stripped = val.strip()
        return stripped if stripped else None
    return val


def _is_text_header_candidate(val: Any) -> bool:
    cleaned = _clean_cell(val)
    if not isinstance(cleaned, str):
        return False
    return not cleaned.replace(".", "", 1).replace("-", "", 1).isdigit()


def _detect_header_row(raw_df: pd.DataFrame) -> int:
    if raw_df.empty:
        return 0

    scan_limit = min(MAX_HEADER_SCAN_ROWS, len(raw_df))
    best_idx = 0
    best_score = (-1, -1)

    for idx in range(scan_limit):
        row_vals = [_clean_cell(v) for v in raw_df.iloc[idx].tolist()]
        non_null = sum(1 for v in row_vals if v is not None)
        if non_null == 0:
            continue

        text_count = sum(1 for v in row_vals if _is_text_header_candidate(v))
        score = (text_count, non_null)
        if score > best_score:
            best_score = score
            best_idx = idx

    return best_idx


def _deduplicate_columns(raw_headers: list[Any]) -> list[str]:
    seen: dict[str, int] = {}
    columns: list[str] = []

    for idx, val in enumerate(raw_headers):
        cleaned = _clean_cell(val)
        base = str(cleaned) if cleaned is not None else f"column_{idx + 1}"
        count = seen.get(base, 0) + 1
        seen[base] = count
        columns.append(base if count == 1 else f"{base}_{count}")

    return columns


def _coerce_numeric_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in df.columns:
        non_null = df[col].dropna()
        if non_null.empty:
            continue

        has_leading_zero_id = any(
            isinstance(v, str)
            and len(v.strip()) > 1
            and v.strip().startswith("0")
            and v.strip()[1].isdigit()
            for v in non_null
        )
        if has_leading_zero_id:
            continue

        converted = pd.to_numeric(non_null, errors="coerce")
        if converted.notna().all():
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def _build_sheet_data(
    sheet_name: str,
    raw_df: pd.DataFrame,
) -> tuple[dict[str, Any], str, str | None]:
    raw_df = raw_df.dropna(how="all").reset_index(drop=True)
    if raw_df.empty:
        return (
            {
                "sheet_name": sheet_name,
                "row_count": 0,
                "columns": [],
                "rows": [],
            },
            "",
            None,
        )

    header_idx = _detect_header_row(raw_df)
    columns = _deduplicate_columns(raw_df.iloc[header_idx].tolist())
    data_df = _coerce_numeric_columns(raw_df.iloc[header_idx + 1:])

    records: list[dict[str, Any]] = []
    for row in data_df.itertuples(index=False, name=None):
        item = {columns[i]: _clean_cell(row[i]) for i in range(len(columns))}
        if any(v is not None for v in item.values()):
            records.append(item)

    text_lines: list[str] = []
    for row in raw_df.iloc[:MAX_TEXT_ROWS_PER_SHEET].itertuples(index=False, name=None):
        cleaned_cells = [_clean_cell(c) for c in row]
        if any(cell is not None for cell in cleaned_cells):
            rendered = [str(cell) if cell is not None else "" for cell in cleaned_cells]
            text_lines.append("\t".join(rendered).rstrip())

    warning = None
    if len(raw_df) > MAX_TEXT_ROWS_PER_SHEET:
        warning = (
            f"Sheet '{sheet_name}': raw_text truncated to first {MAX_TEXT_ROWS_PER_SHEET} "
            f"of {len(raw_df)} rows."
        )

    sheet_payload = {
        "sheet_name": sheet_name,
        "row_count": len(records),
        "columns": columns,
        "rows": records,
    }
    return sheet_payload, "\n".join(text_lines), warning


def _read_csv_raw(content: bytes) -> tuple[pd.DataFrame, list[str]]:
    warnings: list[str] = []
    detected = chardet.detect(content[:10000])
    encoding = detected.get("encoding") or "utf-8"

    try:
        df = pd.read_csv(
            io.BytesIO(content),
            encoding=encoding,
            header=None,
            sep=None,
            engine="python",
        )
    except UnicodeDecodeError:
        df = pd.read_csv(
            io.BytesIO(content),
            encoding="latin-1",
            header=None,
            sep=None,
            engine="python",
        )
        warnings.append("CSV encoding fallback to latin-1 was used.")
    except pd.errors.ParserError:
        df = pd.read_csv(io.BytesIO(content), encoding=encoding, header=None)

    return df, warnings


def process_spreadsheet_bytes(content: bytes, ext: str) -> dict[str, Any]:
    sheets: list[dict[str, Any]] = []
    text_blocks: list[str] = []
    warnings: list[str] = []

    try:
        if ext == ".csv":
            raw_df, csv_warnings = _read_csv_raw(content)
            warnings.extend(csv_warnings)
            sheet_data, sheet_text, trunc_warning = _build_sheet_data("default", raw_df)
            sheets.append(sheet_data)
            if sheet_text:
                text_blocks.append(sheet_text)
            if trunc_warning:
                warnings.append(trunc_warning)

        elif ext in (".xlsx", ".xls"):
            engine = "openpyxl" if ext == ".xlsx" else "xlrd"
            excel_dict = pd.read_excel(
                io.BytesIO(content),
                sheet_name=None,
                header=None,
                engine=engine,
            )
            if not excel_dict:
                raise ValueError("Excel workbook contains no readable sheets.")

            for sheet_name, raw_df in excel_dict.items():
                sheet_data, sheet_text, trunc_warning = _build_sheet_data(str(sheet_name), raw_df)
                sheets.append(sheet_data)
                if sheet_text:
                    text_blocks.append(f"--- Sheet: {sheet_name} ---\n{sheet_text}")
                if trunc_warning:
                    warnings.append(trunc_warning)
        else:
            raise ValueError(f"Unsupported spreadsheet extension: {ext}")

    except Exception as exc:
        raise ValueError(f"Corrupted or unreadable spreadsheet ({ext}): {exc}") from exc

    return {
        "page_count": len(sheets),
        "extraction_method": "spreadsheet_parser",
        "ocr_confidence": 1.0,
        "raw_text": "\n\n".join(text_blocks),
        "pages": None,
        "sheets": sheets,
        "warnings": warnings,
    }
