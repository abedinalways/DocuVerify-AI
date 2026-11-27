import { DocProcessorPage } from '../../doc-processor/doc-processor.types';

export const MAX_EXTRACTION_CHARS_PER_CHUNK = 24_000;

export interface TextExtractionChunk {
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
}

export function buildExtractionSystemInstruction(): string {
  return [
    'You are a strict financial document extraction engine.',
    'Extract structured invoice, receipt, or financial ledger records ONLY from the provided text.',
    'Rules:',
    '1. NEVER invent, guess, extrapolate, or calculate missing values.',
    '2. If any field is missing, illegible, or ambiguous, set that field to null and include the field name in uncertainFields with confidence <= 0.4.',
    '3. Keep rawInvoiceDate verbatim as written in the document, and set invoiceDate to YYYY-MM-DD only when unambiguous.',
    '4. Normalize currency to a 3-letter ISO code (e.g. USD, BDT, EUR, GBP) when clear, or preserve the printed symbol; otherwise null.',
    '5. Preserve printed numeric amounts verbatim without altering totals even if arithmetic looks inconsistent.',
    '6. If a document contains multiple distinct invoices, return one entry per invoice; if no invoice/receipt data exists, return an empty invoices array.',
  ].join('\n');
}

export function buildExtractionUserPrompt(
  filename: string,
  chunk: TextExtractionChunk,
): string {
  const locationContext =
    chunk.pageStart !== null && chunk.pageEnd !== null
      ? `Pages: ${chunk.pageStart}-${chunk.pageEnd}`
      : 'Full document';

  return [
    `Filename: ${filename}`,
    locationContext,
    'Document Content:',
    chunk.text,
  ].join('\n\n');
}

export function splitTextIntoExtractionChunks(
  rawText: string,
  pages?: DocProcessorPage[] | null,
  maxChars: number = MAX_EXTRACTION_CHARS_PER_CHUNK,
): TextExtractionChunk[] {
  if (pages && pages.length > 0) {
    return chunkByPages(pages, maxChars);
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  return chunkPlainText(trimmed, maxChars);
}

function chunkByPages(pages: DocProcessorPage[], maxChars: number): TextExtractionChunk[] {
  const chunks: TextExtractionChunk[] = [];
  let buffer: string[] = [];
  let currentLength = 0;
  let chunkStart: number | null = null;
  let chunkEnd: number | null = null;

  for (const page of pages) {
    const pageText = page.text.trim();
    if (!pageText) {
      continue;
    }

    const formatted = `--- Page ${page.page_number} ---\n${pageText}`;
    if (buffer.length > 0 && currentLength + formatted.length > maxChars) {
      chunks.push({
        text: buffer.join('\n\n'),
        pageStart: chunkStart,
        pageEnd: chunkEnd,
      });
      buffer = [];
      currentLength = 0;
      chunkStart = null;
      chunkEnd = null;
    }

    if (formatted.length > maxChars) {
      const subChunks = chunkPlainText(formatted, maxChars).map((sub) => ({
        ...sub,
        pageStart: page.page_number,
        pageEnd: page.page_number,
      }));
      chunks.push(...subChunks);
      continue;
    }

    if (chunkStart === null) {
      chunkStart = page.page_number;
    }
    chunkEnd = page.page_number;
    buffer.push(formatted);
    currentLength += formatted.length + 2;
  }

  if (buffer.length > 0) {
    chunks.push({
      text: buffer.join('\n\n'),
      pageStart: chunkStart,
      pageEnd: chunkEnd,
    });
  }

  return chunks;
}

function chunkPlainText(text: string, maxChars: number): TextExtractionChunk[] {
  if (text.length <= maxChars) {
    return [{ text, pageStart: null, pageEnd: null }];
  }

  const chunks: TextExtractionChunk[] = [];
  const lines = text.split('\n');
  let buffer: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (line.length > maxChars) {
      if (buffer.length > 0) {
        chunks.push({ text: buffer.join('\n'), pageStart: null, pageEnd: null });
        buffer = [];
        currentLength = 0;
      }
      for (let offset = 0; offset < line.length; offset += maxChars) {
        chunks.push({
          text: line.slice(offset, offset + maxChars),
          pageStart: null,
          pageEnd: null,
        });
      }
      continue;
    }

    if (buffer.length > 0 && currentLength + line.length + 1 > maxChars) {
      chunks.push({ text: buffer.join('\n'), pageStart: null, pageEnd: null });
      buffer = [];
      currentLength = 0;
    }

    buffer.push(line);
    currentLength += line.length + 1;
  }

  if (buffer.length > 0) {
    chunks.push({ text: buffer.join('\n'), pageStart: null, pageEnd: null });
  }

  return chunks;
}
