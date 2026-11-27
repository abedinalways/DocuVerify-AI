import {
  Document,
  DocumentContent,
  ExtractedInvoice,
  ProcessingLog,
  ValidationIssue,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type DocumentWithRelations = Document & {
  content?: Pick<DocumentContent, 'id'> | null;
  extractedInvoices?: ExtractedInvoice[];
  validationIssues?: ValidationIssue[];
  processingLogs?: ProcessingLog[];
  _count?: {
    validationIssues: number;
    extractedInvoices: number;
  };
};

function decimalToNumber(value: Decimal | null): number | null {
  return value === null ? null : Number(value);
}

export function toExtractedInvoiceDto(invoice: ExtractedInvoice) {
  return {
    id: invoice.id,
    documentId: invoice.documentId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.toISOString().slice(0, 10) : null,
    rawInvoiceDate: invoice.rawInvoiceDate,
    supplierName: invoice.supplierName,
    customerName: invoice.customerName,
    currency: invoice.currency,
    subtotal: decimalToNumber(invoice.subtotal),
    tax: decimalToNumber(invoice.tax),
    total: decimalToNumber(invoice.total),
    lineItems: invoice.lineItems,
    confidenceMap: invoice.confidenceMap,
    isManuallyCorrected: invoice.isManuallyCorrected,
    correctedBy: invoice.correctedBy,
    correctedAt: invoice.correctedAt?.toISOString() ?? null,
    sourcePageStart: invoice.sourcePageStart,
    sourcePageEnd: invoice.sourcePageEnd,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function toDocumentSummaryDto(doc: DocumentWithRelations) {
  return {
    id: doc.id,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    fileExtension: doc.fileExtension,
    documentType: doc.documentType,
    fileSizeBytes: Number(doc.fileSizeBytes),
    sha256Hash: doc.sha256Hash,
    status: doc.status,
    progressPercent: doc.progressPercent,
    pageCount: doc.pageCount,
    processedPages: doc.processedPages,
    extractionMethod: doc.extractionMethod,
    ocrConfidence: doc.ocrConfidence,
    processingTimeMs: doc.processingTimeMs,
    lastError: doc.lastError,
    warnings: doc.warnings,
    invoiceCount: doc._count?.extractedInvoices ?? doc.extractedInvoices?.length ?? 0,
    issueCount: doc._count?.validationIssues ?? doc.validationIssues?.length ?? 0,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    processedAt: doc.processedAt?.toISOString() ?? null,
  };
}

export function toDocumentDetailDto(doc: DocumentWithRelations) {
  return {
    ...toDocumentSummaryDto(doc),
    hasContent: Boolean(doc.content),
    extractedInvoices: (doc.extractedInvoices ?? []).map(toExtractedInvoiceDto),
    validationIssues: doc.validationIssues ?? [],
    processingLogs: doc.processingLogs ?? [],
  };
}
