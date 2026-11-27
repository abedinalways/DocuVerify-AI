import { DocumentType } from '@prisma/client';
import * as path from 'node:path';

export const ALLOWED_EXTENSIONS = new Set<string>([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.tiff',
  '.tif',
  '.xlsx',
  '.xls',
  '.csv',
]);

export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 20;

const IMAGE_EXTENSIONS = new Set<string>(['.jpg', '.jpeg', '.png', '.tiff', '.tif']);
const SPREADSHEET_EXTENSIONS = new Set<string>(['.xlsx', '.xls', '.csv']);

export function extractNormalizedExtension(filename: string): string {
  return path.extname(filename.trim()).toLowerCase();
}

export function isSupportedExtension(ext: string): boolean {
  return ALLOWED_EXTENSIONS.has(ext);
}

export function resolveDocumentType(ext: string): DocumentType {
  if (ext === '.pdf') {
    return DocumentType.PDF;
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return DocumentType.IMAGE;
  }
  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    return DocumentType.SPREADSHEET;
  }
  throw new Error(`Unsupported file extension: ${ext}`);
}
