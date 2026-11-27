import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';
import { DocumentJobDispatcher } from './documents.types';

describe('DocumentsService', () => {
  const mockRepository = {
    findBySha256: jest.fn(),
    createPendingDocument: jest.fn(),
    findMany: jest.fn(),
    findById: jest.fn(),
    findContentByDocumentId: jest.fn(),
  } as unknown as DocumentsRepository;

  const mockStorage = {
    removeFile: jest.fn(),
    inspectFile: jest.fn(),
  } as unknown as StorageService;

  const mockDispatcher: DocumentJobDispatcher = {
    enqueueProcessing: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects empty upload arrays', async () => {
    const service = new DocumentsService(mockRepository, mockStorage, mockDispatcher);
    await expect(service.registerUploads([])).rejects.toThrow(BadRequestException);
  });

  it('accepts valid files, detects duplicate sha256 warnings, and rejects unsupported files', async () => {
    (mockStorage.inspectFile as jest.Mock).mockResolvedValue({
      sha256Hash: 'abc123hash',
      sizeBytes: 512,
    });
    (mockRepository.findBySha256 as jest.Mock).mockResolvedValue({ id: 'existing-doc-id' });
    (mockRepository.createPendingDocument as jest.Mock).mockResolvedValue({
      id: 'new-doc-id',
      originalFilename: 'invoice.pdf',
      storagePath: '/tmp/uploads/1.pdf',
      mimeType: 'application/pdf',
      fileExtension: '.pdf',
      documentType: DocumentType.PDF,
      fileSizeBytes: BigInt(512),
      sha256Hash: 'abc123hash',
      status: DocumentStatus.PENDING,
      progressPercent: 0,
      pageCount: null,
      processedPages: 0,
      extractionMethod: null,
      ocrConfidence: null,
      processingTimeMs: null,
      lastError: null,
      warnings: ["Duplicate file content matches document 'existing-doc-id'."],
      createdAt: new Date('2026-11-27T00:00:00Z'),
      updatedAt: new Date('2026-11-27T00:00:00Z'),
      processedAt: null,
    });

    const validFile = {
      originalname: 'invoice.pdf',
      mimetype: 'application/pdf',
      size: 512,
      path: '/tmp/uploads/1.pdf',
    } as Express.Multer.File;

    const invalidFile = {
      originalname: 'malware.exe',
      mimetype: 'application/octet-stream',
      size: 120,
      path: '/tmp/uploads/2.exe',
    } as Express.Multer.File;

    const service = new DocumentsService(mockRepository, mockStorage, mockDispatcher);
    const result = await service.registerUploads([validFile, invalidFile]);

    expect(result.acceptedCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.documents[0].fileSizeBytes).toBe(512);
    expect(result.rejected[0].filename).toBe('malware.exe');
    expect(mockStorage.removeFile).toHaveBeenCalledWith('/tmp/uploads/2.exe');
    expect(mockDispatcher.enqueueProcessing).toHaveBeenCalledWith('new-doc-id');
  });

  it('throws NotFoundException when document id does not exist', async () => {
    (mockRepository.findById as jest.Mock).mockResolvedValue(null);
    const service = new DocumentsService(mockRepository, mockStorage);
    await expect(service.getDocumentById('missing-id')).rejects.toThrow(NotFoundException);
  });
});
