import { Injectable } from '@nestjs/common';
import {
  Document,
  DocumentContent,
  DocumentStatus,
  DocumentType,
  ExtractionMethod,
  Prisma,
  ProcessingStage,
  StageStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DocumentWithRelations } from './documents.mapper';
import { QueryDocumentsDto } from './dto/query-documents.dto';

export interface CreateDocumentRecordInput {
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  fileExtension: string;
  documentType: DocumentType;
  fileSizeBytes: number;
  sha256Hash: string;
  warnings?: string[];
}

export interface SaveParsedContentInput {
  rawText: string;
  pagesJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
  sheetsJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
}

@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPendingDocument(input: CreateDocumentRecordInput): Promise<Document> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          originalFilename: input.originalFilename,
          storagePath: input.storagePath,
          mimeType: input.mimeType,
          fileExtension: input.fileExtension,
          documentType: input.documentType,
          fileSizeBytes: BigInt(input.fileSizeBytes),
          sha256Hash: input.sha256Hash,
          status: DocumentStatus.PENDING,
          warnings: input.warnings ?? [],
        },
      });

      await tx.processingLog.create({
        data: {
          documentId: created.id,
          stage: ProcessingStage.UPLOAD,
          status: StageStatus.SUCCEEDED,
          message: `Uploaded ${input.originalFilename} (${input.fileSizeBytes} bytes).`,
        },
      });

      return created;
    });
  }

  async findBySha256(sha256Hash: string, excludeId?: string): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: {
        sha256Hash,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMany(
    query: QueryDocumentsDto,
  ): Promise<{ items: DocumentWithRelations[]; total: number }> {
    const where: Prisma.DocumentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.documentType ? { documentType: query.documentType } : {}),
      ...(query.search?.trim()
        ? {
            originalFilename: {
              contains: query.search.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
        include: {
          _count: {
            select: {
              extractedInvoices: true,
              validationIssues: true,
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string): Promise<DocumentWithRelations | null> {
    return this.prisma.document.findUnique({
      where: { id },
      include: {
        content: {
          select: { id: true },
        },
        extractedInvoices: {
          orderBy: { createdAt: 'asc' },
        },
        validationIssues: {
          orderBy: { createdAt: 'desc' },
        },
        processingLogs: {
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });
  }

  async findContentByDocumentId(documentId: string): Promise<DocumentContent | null> {
    return this.prisma.documentContent.findUnique({
      where: { documentId },
    });
  }

  async updateProcessingState(
    id: string,
    data: {
      status?: DocumentStatus;
      progressPercent?: number;
      pageCount?: number;
      processedPages?: number;
      extractionMethod?: ExtractionMethod;
      ocrConfidence?: number;
      processingTimeMs?: number;
      lastError?: string | null;
      warnings?: Prisma.InputJsonValue;
      processedAt?: Date | null;
    },
  ): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data,
    });
  }

  async saveParsedContent(documentId: string, content: SaveParsedContentInput): Promise<void> {
    await this.prisma.documentContent.upsert({
      where: { documentId },
      create: {
        documentId,
        rawText: content.rawText,
        pagesJson: content.pagesJson,
        sheetsJson: content.sheetsJson,
      },
      update: {
        rawText: content.rawText,
        pagesJson: content.pagesJson,
        sheetsJson: content.sheetsJson,
      },
    });
  }

  async appendLog(input: {
    documentId: string;
    stage: ProcessingStage;
    status: StageStatus;
    attempt?: number;
    durationMs?: number;
    message?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.processingLog.create({
      data: {
        documentId: input.documentId,
        stage: input.stage,
        status: input.status,
        attempt: input.attempt ?? 1,
        durationMs: input.durationMs,
        message: input.message,
        metadata: input.metadata,
      },
    });
  }
}
