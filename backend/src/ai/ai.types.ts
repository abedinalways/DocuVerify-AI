import { DocProcessorPage } from '../doc-processor/doc-processor.types';

export const LLM_EXTRACTOR_PROVIDER = Symbol('LLM_EXTRACTOR_PROVIDER');
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

export interface ExtractedLineItem {
  description: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  uncertain: boolean;
}

export interface ConfidenceMap {
  invoiceNumber: number;
  invoiceDate: number;
  supplierName: number;
  customerName: number;
  currency: number;
  subtotal: number;
  tax: number;
  total: number;
  lineItems: number;
}

export interface ExtractedInvoiceCandidate {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  rawInvoiceDate: string | null;
  supplierName: string | null;
  customerName: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lineItems: ExtractedLineItem[];
  confidenceMap: ConfidenceMap;
  uncertainFields: string[];
  sourcePageStart: number | null;
  sourcePageEnd: number | null;
}

export interface ExtractionInput {
  filename: string;
  rawText: string;
  pages?: DocProcessorPage[] | null;
}

export interface ExtractionProviderResult {
  invoices: ExtractedInvoiceCandidate[];
  rawResponses: unknown[];
}

export interface LlmExtractorProvider {
  extractInvoices(input: ExtractionInput): Promise<ExtractionProviderResult>;
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
}
