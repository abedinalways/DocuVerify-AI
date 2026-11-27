import { Injectable } from '@nestjs/common';
import {
  ConfidenceMap,
  ExtractedInvoiceCandidate,
  ExtractedLineItem,
} from '../ai.types';

const PLACEHOLDER_STRINGS = new Set([
  'n/a',
  'na',
  'none',
  'null',
  'nil',
  'unknown',
  'not available',
  'not specified',
  'unspecified',
  '-',
  '--',
]);

const DEFAULT_CONFIDENCE_FIELDS: (keyof ConfidenceMap)[] = [
  'invoiceNumber',
  'invoiceDate',
  'supplierName',
  'customerName',
  'currency',
  'subtotal',
  'tax',
  'total',
  'lineItems',
];

@Injectable()
export class InvoiceGroundingSanitizer {
  sanitizeBatch(
    candidates: ExtractedInvoiceCandidate[],
    rawText: string,
    hasPageMetadata: boolean,
  ): ExtractedInvoiceCandidate[] {
    const normalizedText = this.normalizeForTextMatch(rawText);
    const alphaNumText = this.normalizeAlphaNum(rawText);
    const numericText = this.normalizeNumericText(rawText);

    return candidates.map((candidate) =>
      this.sanitizeSingle(
        candidate,
        normalizedText,
        alphaNumText,
        numericText,
        hasPageMetadata,
      ),
    );
  }

  private sanitizeSingle(
    candidate: ExtractedInvoiceCandidate,
    normalizedText: string,
    alphaNumText: string,
    numericText: string,
    hasPageMetadata: boolean,
  ): ExtractedInvoiceCandidate {
    const uncertainSet = new Set<string>(
      Array.isArray(candidate.uncertainFields)
        ? candidate.uncertainFields.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        : [],
    );

    const confidenceMap = this.normalizeConfidenceMap(candidate.confidenceMap);

    const invoiceNumber = this.normalizeString(candidate.invoiceNumber);
    const rawInvoiceDate = this.normalizeString(candidate.rawInvoiceDate);
    const invoiceDate = this.normalizeIsoDate(candidate.invoiceDate);
    const supplierName = this.normalizeString(candidate.supplierName);
    const customerName = this.normalizeString(candidate.customerName);
    const currency = this.normalizeCurrency(candidate.currency);
    const subtotal = this.normalizeNumber(candidate.subtotal);
    const tax = this.normalizeNumber(candidate.tax);
    const total = this.normalizeNumber(candidate.total);
    const lineItems = this.sanitizeLineItems(candidate.lineItems);

    if (candidate.invoiceDate && !invoiceDate) {
      uncertainSet.add('invoiceDate');
      confidenceMap.invoiceDate = Math.min(confidenceMap.invoiceDate, 0.35);
    }

    this.verifyAlphaNumGrounding(
      'invoiceNumber',
      invoiceNumber,
      alphaNumText,
      uncertainSet,
      confidenceMap,
    );
    this.verifyTokenGrounding('supplierName', supplierName, normalizedText, uncertainSet, confidenceMap);
    this.verifyTokenGrounding('customerName', customerName, normalizedText, uncertainSet, confidenceMap);
    this.verifyNumericGrounding('subtotal', subtotal, numericText, uncertainSet, confidenceMap);
    this.verifyNumericGrounding('tax', tax, numericText, uncertainSet, confidenceMap);
    this.verifyNumericGrounding('total', total, numericText, uncertainSet, confidenceMap);

    return {
      invoiceNumber,
      invoiceDate,
      rawInvoiceDate,
      supplierName,
      customerName,
      currency,
      subtotal,
      tax,
      total,
      lineItems,
      confidenceMap,
      uncertainFields: Array.from(uncertainSet),
      sourcePageStart: hasPageMetadata ? candidate.sourcePageStart : null,
      sourcePageEnd: hasPageMetadata ? candidate.sourcePageEnd : null,
    };
  }

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed || PLACEHOLDER_STRINGS.has(trimmed.toLowerCase())) {
      return null;
    }
    return trimmed;
  }

  private normalizeCurrency(value: unknown): string | null {
    const cleaned = this.normalizeString(value);
    if (!cleaned) {
      return null;
    }
    return /^[a-zA-Z]{3}$/.test(cleaned) ? cleaned.toUpperCase() : cleaned;
  }

  private normalizeNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeIsoDate(value: unknown): string | null {
    const cleaned = this.normalizeString(value);
    if (!cleaned || !/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return null;
    }

    const [year, month, day] = cleaned.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    if (
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() !== month - 1 ||
      utcDate.getUTCDate() !== day
    ) {
      return null;
    }

    return cleaned;
  }

  private sanitizeLineItems(items: unknown): ExtractedLineItem[] {
    if (!Array.isArray(items)) {
      return [];
    }

    const sanitized: ExtractedLineItem[] = [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') {
        continue;
      }

      const record = rawItem as Record<string, unknown>;
      const description = this.normalizeString(record.description);
      const quantity = this.normalizeNumber(record.quantity);
      const unitPrice = this.normalizeNumber(record.unitPrice);
      const amount = this.normalizeNumber(record.amount);

      if (description === null && quantity === null && unitPrice === null && amount === null) {
        continue;
      }

      sanitized.push({
        description,
        quantity,
        unitPrice,
        amount,
        uncertain: Boolean(record.uncertain) || description === null || amount === null,
      });
    }

    return sanitized;
  }

  private normalizeConfidenceMap(rawMap: unknown): ConfidenceMap {
    const source = rawMap && typeof rawMap === 'object' ? (rawMap as Record<string, unknown>) : {};
    const result = {} as ConfidenceMap;

    for (const key of DEFAULT_CONFIDENCE_FIELDS) {
      const val = Number(source[key]);
      if (Number.isFinite(val)) {
        result[key] = Math.max(0, Math.min(1, Number(val.toFixed(4))));
      } else {
        result[key] = 0;
      }
    }

    return result;
  }

  private verifyAlphaNumGrounding(
    field: keyof ConfidenceMap,
    value: string | null,
    alphaNumText: string,
    uncertainSet: Set<string>,
    confidenceMap: ConfidenceMap,
  ): void {
    if (!value) {
      return;
    }
    const token = this.normalizeAlphaNum(value);
    if (token.length >= 3 && !alphaNumText.includes(token)) {
      uncertainSet.add(field);
      confidenceMap[field] = Math.min(confidenceMap[field], 0.35);
    }
  }

  private verifyTokenGrounding(
    field: keyof ConfidenceMap,
    value: string | null,
    normalizedText: string,
    uncertainSet: Set<string>,
    confidenceMap: ConfidenceMap,
  ): void {
    if (!value) {
      return;
    }
    const tokens = this.normalizeForTextMatch(value)
      .split(' ')
      .filter((t) => t.length >= 3);

    if (tokens.length > 0 && !tokens.some((token) => normalizedText.includes(token))) {
      uncertainSet.add(field);
      confidenceMap[field] = Math.min(confidenceMap[field], 0.35);
    }
  }

  private verifyNumericGrounding(
    field: keyof ConfidenceMap,
    value: number | null,
    numericText: string,
    uncertainSet: Set<string>,
    confidenceMap: ConfidenceMap,
  ): void {
    if (value === null) {
      return;
    }

    const candidates = new Set([
      String(value),
      value.toFixed(2),
      value.toFixed(2).replace(/\.00$/, ''),
    ]);

    const found = Array.from(candidates).some((pattern) => numericText.includes(pattern));
    if (!found) {
      uncertainSet.add(field);
      confidenceMap[field] = Math.min(confidenceMap[field], 0.4);
    }
  }

  private normalizeForTextMatch(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private normalizeAlphaNum(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private normalizeNumericText(text: string): string {
    return text.replace(/,/g, '');
  }
}
