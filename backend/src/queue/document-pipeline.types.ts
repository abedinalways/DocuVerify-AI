import { DocumentStatus, ExtractionMethod } from '@prisma/client';
import { DocProcessorPage, DocProcessorSheet } from '../doc-processor/doc-processor.types';

export const DOCUMENT_POST_PROCESSORS = Symbol('DOCUMENT_POST_PROCESSORS');

export interface DocumentJobPayload {
  documentId: string;
}

export interface ParsedDocumentSummary {
  documentId: string;
  rawText: string;
  pageCount: number;
  extractionMethod: ExtractionMethod;
  pages: DocProcessorPage[] | null;
  sheets: DocProcessorSheet[] | null;
  warnings: string[];
}

export interface DocumentPostProcessor {
  run(parsed: ParsedDocumentSummary): Promise<DocumentStatus | void>;
}
