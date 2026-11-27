import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import {
  extractNormalizedExtension,
  isSupportedExtension,
  resolveDocumentType,
} from './documents.constants';
import { toDocumentDetailDto, toDocumentSummaryDto } from './documents.mapper';
import { DocumentsRepository } from './documents.repository';
import { DOCUMENT_JOB_DISPATCHER, DocumentJobDispatcher } from './documents.types';
import { QueryDocumentsDto } from './dto/query-documents.dto';

export interface RejectedUploadItem {
  filename: string;
  reason: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly repository: DocumentsRepository,
    private readonly storageService: StorageService,
    @Optional()
    @Inject(DOCUMENT_JOB_DISPATCHER)
    private readonly jobDispatcher?: DocumentJobDispatcher,
  ) {}

  async registerUploads(files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one document file is required.');
    }

    const accepted = [];
    const rejected: RejectedUploadItem[] = [];

    for (const file of files) {
      const result = await this.registerSingleFile(file);
      if (result.error) {
        rejected.push({ filename: file.originalname, reason: result.error });
      } else if (result.document) {
        accepted.push(result.document);
      }
    }

    if (accepted.length === 0) {
      throw new BadRequestException({
        message: 'All uploaded files failed validation.',
        rejected,
      });
    }

    return {
      totalReceived: files.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      documents: accepted,
      rejected,
    };
  }

  async listDocuments(query: QueryDocumentsDto) {
    const { items, total } = await this.repository.findMany(query);
    return {
      items: items.map(toDocumentSummaryDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async getDocumentById(id: string) {
    const doc = await this.repository.findById(id);
    if (!doc) {
      throw new NotFoundException(`Document '${id}' was not found.`);
    }
    return toDocumentDetailDto(doc);
  }

  async getDocumentContent(id: string) {
    const doc = await this.repository.findById(id);
    if (!doc) {
      throw new NotFoundException(`Document '${id}' was not found.`);
    }

    const content = await this.repository.findContentByDocumentId(id);
    return {
      documentId: id,
      status: doc.status,
      rawText: content?.rawText ?? '',
      pages: content?.pagesJson ?? null,
      sheets: content?.sheetsJson ?? null,
    };
  }

  private async registerSingleFile(file: Express.Multer.File) {
    const ext = extractNormalizedExtension(file.originalname);
    if (!isSupportedExtension(ext)) {
      await this.storageService.removeFile(file.path);
      return { error: `Unsupported file extension '${ext || 'none'}'.` };
    }

    if (file.size === 0) {
      await this.storageService.removeFile(file.path);
      return { error: 'Uploaded file is empty (0 bytes).' };
    }

    const { sha256Hash, sizeBytes } = await this.storageService.inspectFile(file.path);
    const existingDuplicate = await this.repository.findBySha256(sha256Hash);
    const warnings = existingDuplicate
      ? [`Duplicate file content matches document '${existingDuplicate.id}'.`]
      : [];

    const created = await this.repository.createPendingDocument({
      originalFilename: file.originalname,
      storagePath: file.path,
      mimeType: file.mimetype || 'application/octet-stream',
      fileExtension: ext,
      documentType: resolveDocumentType(ext),
      fileSizeBytes: sizeBytes,
      sha256Hash,
      warnings,
    });

    if (this.jobDispatcher) {
      await this.jobDispatcher.enqueueProcessing(created.id);
    }

    return { document: toDocumentSummaryDto(created) };
  }
}
