export interface DocProcessorPage {
  page_number: number;
  method: 'digital_text' | 'ocr';
  confidence: number;
  text: string;
}

export interface DocProcessorSheet {
  sheet_name: string;
  row_count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface DocProcessorResponse {
  status: 'success' | 'failed';
  filename: string;
  file_type: string;
  file_size_bytes: number;
  file_hash: string | null;
  processing_time_ms: number;
  error: string | null;
  total_pages?: number;
  start_page?: number;
  end_page?: number;
  page_count?: number;
  extraction_method?: 'digital_text' | 'ocr' | 'hybrid' | 'spreadsheet_parser';
  ocr_confidence?: number;
  digital_pages?: number;
  ocr_pages?: number;
  raw_text?: string;
  pages?: DocProcessorPage[] | null;
  sheets?: DocProcessorSheet[] | null;
  warnings?: string[];
}

export interface ProcessFileRequest {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  startPage?: number;
  endPage?: number;
}
