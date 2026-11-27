jest.mock('@nestjs/bullmq', () => ({
  Processor: () => () => undefined,
  WorkerHost: class {},
}));

import { DocumentStatus, DocumentType, ExtractionMethod } from '@prisma/client';
import { Job } from 'bullmq';
import { DocProcessorClient } from '../doc-processor/doc-processor.client';
import { DocumentsRepository } from '../documents/documents.repository';
import { StorageService } from '../storage/storage.service';
import { DocumentJobPayload, DocumentPostProcessor } from './document-pipeline.types';
import { DocumentProcessingProcessor } from './document-processing.processor';

describe('DocumentProcessingProcessor', () => {
  const mockRepository = {
    findById: jest.fn(),
    updateProcessingState: jest.fn(),
    appendLog: jest.fn(),
    saveParsedContent: jest.fn(),
  } as unknown as DocumentsRepository;

  const mockStorage = {
    readBuffer: jest.fn(),
  } as unknown as StorageService;

  const mockDocClient = {
    processDocument: jest.fn(),
  } as unknown as DocProcessorClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes large PDFs in page chunks and merges output cleanly', async () => {
    (mockRepository.findById as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      originalFilename: 'big.pdf',
      storagePath: '/uploads/big.pdf',
      mimeType: 'application/pdf',
      documentType: DocumentType.PDF,
      warnings: [],
    });
    (mockStorage.readBuffer as jest.Mock).mockResolvedValue(Buffer.from('%PDF-1.4'));

    (mockDocClient.processDocument as jest.Mock)
      .mockResolvedValueOnce({
        status: 'success',
        total_pages: 30,
        page_count: 25,
        extraction_method: 'digital_text',
        ocr_confidence: 1.0,
        digital_pages: 25,
        ocr_pages: 0,
        raw_text: 'Pages 1-25 text',
        pages: Array.from({ length: 25 }, (_, i) => ({
          page_number: i + 1,
          method: 'digital_text',
          confidence: 1.0,
          text: `Page ${i + 1}`,
        })),
        warnings: [],
      })
      .mockResolvedValueOnce({
        status: 'success',
        total_pages: 30,
        page_count: 5,
        extraction_method: 'ocr',
        ocr_confidence: 0.85,
        digital_pages: 0,
        ocr_pages: 5,
        raw_text: 'Pages 26-30 text',
        pages: Array.from({ length: 5 }, (_, i) => ({
          page_number: i + 26,
          method: 'ocr',
          confidence: 0.85,
          text: `Page ${i + 26}`,
        })),
        warnings: ['Page 28: Low OCR confidence'],
      });

    const mockPostProcessor: DocumentPostProcessor = {
      run: jest.fn().mockResolvedValue(DocumentStatus.NEEDS_REVIEW),
    };

    const processor = new DocumentProcessingProcessor(
      mockRepository,
      mockStorage,
      mockDocClient,
      [mockPostProcessor],
    );

    await processor.process({
      data: { documentId: 'doc-1' },
      attemptsMade: 0,
    } as Job<DocumentJobPayload>);

    expect(mockDocClient.processDocument).toHaveBeenCalledTimes(2);
    expect(mockDocClient.processDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startPage: 1, endPage: 25 }),
    );
    expect(mockDocClient.processDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ startPage: 26, endPage: 30 }),
    );
    expect(mockRepository.saveParsedContent).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        rawText: 'Pages 1-25 text\n\nPages 26-30 text',
      }),
    );
    expect(mockRepository.updateProcessingState).toHaveBeenLastCalledWith(
      'doc-1',
      expect.objectContaining({
        status: DocumentStatus.NEEDS_REVIEW,
        progressPercent: 100,
        pageCount: 30,
        processedPages: 30,
        extractionMethod: ExtractionMethod.HYBRID,
      }),
    );
  });

  it('marks document FAILED and logs error when doc-processor fails', async () => {
    (mockRepository.findById as jest.Mock).mockResolvedValue({
      id: 'doc-fail',
      originalFilename: 'broken.pdf',
      storagePath: '/uploads/broken.pdf',
      mimeType: 'application/pdf',
      documentType: DocumentType.PDF,
      warnings: [],
    });
    (mockStorage.readBuffer as jest.Mock).mockResolvedValue(Buffer.from('bad'));
    (mockDocClient.processDocument as jest.Mock).mockRejectedValue(
      new Error('Corrupted PDF file'),
    );

    const processor = new DocumentProcessingProcessor(
      mockRepository,
      mockStorage,
      mockDocClient,
    );

    await expect(
      processor.process({
        data: { documentId: 'doc-fail' },
        attemptsMade: 0,
      } as Job<DocumentJobPayload>),
    ).rejects.toThrow('Corrupted PDF file');

    expect(mockRepository.updateProcessingState).toHaveBeenLastCalledWith(
      'doc-fail',
      expect.objectContaining({
        status: DocumentStatus.FAILED,
        lastError: 'Corrupted PDF file',
      }),
    );
  });
});
