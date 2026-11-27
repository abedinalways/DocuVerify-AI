import { DocumentStatus, ExtractionMethod } from '@prisma/client';
import { AiExtractionService } from './ai-extraction.service';
import { AiPostProcessor } from './ai-post-processor';

describe('AiPostProcessor', () => {
  const mockAiService = {
    processDocumentAi: jest.fn(),
  } as unknown as AiExtractionService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns NEEDS_REVIEW when extracted fields are uncertain', async () => {
    (mockAiService.processDocumentAi as jest.Mock).mockResolvedValue({
      extractedCount: 1,
      hasUncertainExtraction: true,
      embedded: true,
    });

    const postProcessor = new AiPostProcessor(mockAiService);
    const status = await postProcessor.run({
      documentId: 'doc-1',
      filename: 'scan.pdf',
      rawText: 'Invoice 123',
      pageCount: 1,
      extractionMethod: ExtractionMethod.OCR,
      pages: null,
      sheets: null,
      warnings: [],
    });

    expect(status).toBe(DocumentStatus.NEEDS_REVIEW);
  });

  it('returns void when extraction is confident', async () => {
    (mockAiService.processDocumentAi as jest.Mock).mockResolvedValue({
      extractedCount: 1,
      hasUncertainExtraction: false,
      embedded: true,
    });

    const postProcessor = new AiPostProcessor(mockAiService);
    const status = await postProcessor.run({
      documentId: 'doc-2',
      filename: 'clean.pdf',
      rawText: 'Invoice 456',
      pageCount: 1,
      extractionMethod: ExtractionMethod.DIGITAL_TEXT,
      pages: null,
      sheets: null,
      warnings: [],
    });

    expect(status).toBeUndefined();
  });
});
