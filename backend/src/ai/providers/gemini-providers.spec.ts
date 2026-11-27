import { GeminiClient } from './gemini.client';
import { GeminiEmbeddingProvider } from './gemini-embedding.provider';
import { GeminiLlmProvider } from './gemini-llm.provider';

describe('Gemini Providers', () => {
  const samplePayload = {
    invoices: [
      {
        invoiceNumber: 'INV-101',
        invoiceDate: '2026-11-27',
        rawInvoiceDate: '27 Nov 2026',
        supplierName: 'CareGuide Supplies',
        customerName: 'Dhaka Clinic',
        currency: 'USD',
        subtotal: 100,
        tax: 15,
        total: 115,
        lineItems: [
          {
            description: 'Surgical Gloves',
            quantity: 10,
            unitPrice: 10,
            amount: 100,
            uncertain: false,
          },
        ],
        confidenceMap: {
          invoiceNumber: 0.99,
          invoiceDate: 0.95,
          supplierName: 0.98,
          customerName: 0.94,
          currency: 0.99,
          subtotal: 0.99,
          tax: 0.98,
          total: 0.99,
          lineItems: 0.96,
        },
        uncertainFields: [],
        sourcePageStart: null,
        sourcePageEnd: null,
      },
    ],
  };

  it('extracts structured invoices with GeminiLlmProvider and falls back on 503', async () => {
    const mockGenerateContent = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('High demand'), { status: 503 }))
      .mockResolvedValueOnce({ text: JSON.stringify(samplePayload) });

    const mockClient = {
      getSdk: () => ({ models: { generateContent: mockGenerateContent } }),
      getExtractionModelCandidates: () => ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    } as unknown as GeminiClient;

    const provider = new GeminiLlmProvider(mockClient);
    const result = await provider.extractInvoices({
      filename: 'inv.pdf',
      rawText: 'INVOICE INV-101 Total 115 USD',
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].invoiceNumber).toBe('INV-101');
  });

  it('generates 768-dimensional embeddings with GeminiEmbeddingProvider', async () => {
    const fakeVector = Array.from({ length: 768 }, (_, i) => i * 0.001);
    const mockEmbedContent = jest.fn().mockResolvedValue({
      embeddings: [{ values: fakeVector }],
    });

    const mockClient = {
      getSdk: () => ({ models: { embedContent: mockEmbedContent } }),
      getEmbeddingModel: () => 'gemini-embedding-001',
    } as unknown as GeminiClient;

    const provider = new GeminiEmbeddingProvider(mockClient);
    const vector = await provider.generateEmbedding('Invoice #101 CareGuide Supplies');

    expect(vector).toHaveLength(768);
    expect(mockEmbedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-embedding-001',
        config: { outputDimensionality: 768 },
      }),
    );
  });
});
