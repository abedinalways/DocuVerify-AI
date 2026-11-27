import { ExtractedInvoiceCandidate } from '../ai.types';
import { InvoiceGroundingSanitizer } from './invoice-grounding.sanitizer';

describe('InvoiceGroundingSanitizer', () => {
  const sanitizer = new InvoiceGroundingSanitizer();

  const buildCandidate = (
    overrides: Partial<ExtractedInvoiceCandidate> = {},
  ): ExtractedInvoiceCandidate => ({
    invoiceNumber: 'INV-2026-01',
    invoiceDate: '2026-11-27',
    rawInvoiceDate: '27 Nov 2026',
    supplierName: 'CareGuide BD',
    customerName: 'Cottage Care',
    currency: 'usd',
    subtotal: 100,
    tax: 15,
    total: 115,
    lineItems: [
      {
        description: 'Gloves',
        quantity: 10,
        unitPrice: 10,
        amount: 100,
        uncertain: false,
      },
    ],
    confidenceMap: {
      invoiceNumber: 0.99,
      invoiceDate: 0.96,
      supplierName: 0.98,
      customerName: 0.95,
      currency: 0.99,
      subtotal: 0.99,
      tax: 0.98,
      total: 0.99,
      lineItems: 0.97,
    },
    uncertainFields: [],
    sourcePageStart: 1,
    sourcePageEnd: 1,
    ...overrides,
  });

  it('normalizes placeholder strings, rejects impossible dates, and preserves grounded values', () => {
    const rawText = 'INVOICE INV-2026-01 Date: 27 Nov 2026 CareGuide BD Cottage Care Subtotal 100 Tax 15 Total 115.00 USD';
    const [result] = sanitizer.sanitizeBatch(
      [
        buildCandidate({
          customerName: 'N/A',
          invoiceDate: '2026-02-31',
          rawInvoiceDate: '31 Feb 2026',
          lineItems: [
            { description: 'Gloves', quantity: 10, unitPrice: 10, amount: 100, uncertain: false },
            { description: null, quantity: null, unitPrice: null, amount: null, uncertain: true },
          ],
        }),
      ],
      rawText,
      false,
    );

    expect(result.customerName).toBeNull();
    expect(result.currency).toBe('USD');
    expect(result.invoiceDate).toBeNull();
    expect(result.rawInvoiceDate).toBe('31 Feb 2026');
    expect(result.uncertainFields).toContain('invoiceDate');
    expect(result.confidenceMap.invoiceDate).toBeLessThanOrEqual(0.35);
    expect(result.lineItems).toHaveLength(1);
    expect(result.sourcePageStart).toBeNull();
  });

  it('flags ungrounded hallucinated invoice numbers and totals', () => {
    const rawText = 'Receipt from CareGuide BD Amount 50.00';
    const [result] = sanitizer.sanitizeBatch(
      [
        buildCandidate({
          invoiceNumber: 'INV-HALLUCINATED-999',
          total: 9999.99,
        }),
      ],
      rawText,
      true,
    );

    expect(result.uncertainFields).toContain('invoiceNumber');
    expect(result.uncertainFields).toContain('total');
    expect(result.confidenceMap.invoiceNumber).toBeLessThanOrEqual(0.35);
    expect(result.confidenceMap.total).toBeLessThanOrEqual(0.4);
  });
});
