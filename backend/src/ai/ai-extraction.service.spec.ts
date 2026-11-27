import { ProcessingStage, StageStatus } from '@prisma/client';
import { AiExtractionRepository } from './ai-extraction.repository';
import { AiExtractionService } from './ai-extraction.service';
import { EmbeddingProvider, LlmExtractorProvider } from './ai.types';
import { InvoiceGroundingSanitizer } from './sanitizers/invoice-grounding.sanitizer';

describe('AiExtractionService', () => {
  const mockLlm: LlmExtractorProvider = {
    extractInvoices: jest.fn(),
  };

  const mockEmbedding: EmbeddingProvider = {
    generateEmbedding: jest.fn(),
  };

  const mockRepository = {
    replaceAutomatedExtractions: jest.fn(),
    saveDocumentEmbedding: jest.fn(),
    appendLog: jest.fn(),
  } as unknown as AiExtractionRepository;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips AI calls when rawText is empty', async () => {
    const service = new AiExtractionService(
      mockLlm,
      mockEmbedding,
      new InvoiceGroundingSanitizer(),
      mockRepository,
    );

    const outcome = await service.processDocumentAi({
      documentId: 'doc-empty',
      filename: 'blank.pdf',
      rawText: '   ',
    });

    expect(outcome).toEqual({
      extractedCount: 0,
      hasUncertainExtraction: true,
      embedded: false,
    });
    expect(mockLlm.extractInvoices).not.toHaveBeenCalled();
    expect(mockRepository.appendLog).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: ProcessingStage.AI_EXTRACTION,
        status: StageStatus.FAILED,
      }),
    );
  });

  it('extracts, sanitizes, persists invoices, and saves pgvector embedding', async () => {
    (mockLlm.extractInvoices as jest.Mock).mockResolvedValue({
      invoices: [
        {
          invoiceNumber: 'CG-100',
          invoiceDate: '2026-11-27',
          rawInvoiceDate: '2026-11-27',
          supplierName: 'CareGuide BD',
          customerName: 'Cottage Care',
          currency: 'USD',
          subtotal: 100,
          tax: 0,
          total: 100,
          lineItems: [],
          confidenceMap: {
            invoiceNumber: 0.99,
            invoiceDate: 0.99,
            supplierName: 0.99,
            customerName: 0.99,
            currency: 0.99,
            subtotal: 0.99,
            tax: 0.99,
            total: 0.99,
            lineItems: 0.95,
          },
          uncertainFields: [],
          sourcePageStart: null,
          sourcePageEnd: null,
        },
      ],
      rawResponses: [{ ok: true }],
    });
    const fakeVector = Array.from({ length: 768 }, () => 0.05);
    (mockEmbedding.generateEmbedding as jest.Mock).mockResolvedValue(fakeVector);

    const service = new AiExtractionService(
      mockLlm,
      mockEmbedding,
      new InvoiceGroundingSanitizer(),
      mockRepository,
    );

    const outcome = await service.processDocumentAi({
      documentId: 'doc-1',
      filename: 'invoice.pdf',
      rawText: 'CG-100 2026-11-27 CareGuide BD Cottage Care Subtotal 100 Tax 0 Total 100 USD',
    });

    expect(outcome).toEqual({
      extractedCount: 1,
      hasUncertainExtraction: false,
      embedded: true,
    });
    expect(mockRepository.replaceAutomatedExtractions).toHaveBeenCalledTimes(1);
    expect(mockRepository.saveDocumentEmbedding).toHaveBeenCalledWith('doc-1', fakeVector);
  });
});
