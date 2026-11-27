import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  Document,
  DocumentStatus,
  DocumentType,
  ExtractionMethod,
  Prisma,
  ProcessingStage,
  StageStatus,
} from '@prisma/client';
import { Job } from 'bullmq';
import { DocProcessorClient } from '../doc-processor/doc-processor.client';
import { DocProcessorPage, DocProcessorResponse } from '../doc-processor/doc-processor.types';
import { DocumentsRepository } from '../documents/documents.repository';
import { StorageService } from '../storage/storage.service';
import {
  DOCUMENT_POST_PROCESSORS,
  DocumentJobPayload,
  DocumentPostProcessor,
  ParsedDocumentSummary,
} from './document-pipeline.types';
import { DOCUMENT_PROCESSING_QUEUE, PDF_CHUNK_SIZE } from './queue.constants';

interface AggregatedParseResult {
  pageCount: number;
  processedPages: number;
  extractionMethod: ExtractionMethod;
  ocrConfidence: number;
  rawText: string;
  pages: DocProcessorPage[] | null;
  sheets: DocProcessorResponse['sheets'];
  warnings: string[];
}

@Injectable()
@Processor(DOCUMENT_PROCESSING_QUEUE, { concurrency: 3 })
export class DocumentProcessingProcessor extends WorkerHost {
  constructor(
    private readonly documentsRepository: DocumentsRepository,
    private readonly storageService: StorageService,
    private readonly docProcessorClient: DocProcessorClient,
    @Optional()
    @Inject(DOCUMENT_POST_PROCESSORS)
    private readonly postProcessors: DocumentPostProcessor[] = [],
  ) {
    super();
  }

  async process(job: Job<DocumentJobPayload>): Promise<void> {
    const startedAt = Date.now();
    const { documentId } = job.data;
    const doc = await this.documentsRepository.findById(documentId);

    if (!doc) {
      throw new Error(`Document '${documentId}' does not exist.`);
    }

    const attempt = job.attemptsMade + 1;
    await this.documentsRepository.updateProcessingState(documentId, {
      status: DocumentStatus.PROCESSING,
      progressPercent: 5,
      processedPages: 0,
      lastError: null,
    });
    await this.documentsRepository.appendLog({
      documentId,
      stage: ProcessingStage.DOCUMENT_PARSING,
      status: StageStatus.STARTED,
      attempt,
      message: `Processing started for ${doc.originalFilename}.`,
    });

    try {
      const fileBuffer = await this.storageService.readBuffer(doc.storagePath);
      const parsed = await this.extractDocumentContent(doc, fileBuffer);

      await this.documentsRepository.saveParsedContent(documentId, {
        rawText: parsed.rawText,
        pagesJson: parsed.pages
          ? (parsed.pages as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        sheetsJson: parsed.sheets
          ? (parsed.sheets as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      });

      const mergedWarnings = this.mergeUniqueWarnings(doc.warnings, parsed.warnings);
      const finalStatus = await this.runPostProcessors({
        documentId,
        rawText: parsed.rawText,
        pageCount: parsed.pageCount,
        extractionMethod: parsed.extractionMethod,
        pages: parsed.pages,
        sheets: parsed.sheets ?? null,
        warnings: mergedWarnings,
      });

      const elapsedMs = Date.now() - startedAt;
      await this.documentsRepository.updateProcessingState(documentId, {
        status: finalStatus,
        progressPercent: 100,
        pageCount: parsed.pageCount,
        processedPages: parsed.processedPages,
        extractionMethod: parsed.extractionMethod,
        ocrConfidence: parsed.ocrConfidence,
        processingTimeMs: elapsedMs,
        warnings: mergedWarnings,
        lastError: null,
        processedAt: new Date(),
      });

      await this.documentsRepository.appendLog({
        documentId,
        stage: ProcessingStage.DOCUMENT_PARSING,
        status: StageStatus.SUCCEEDED,
        attempt,
        durationMs: elapsedMs,
        message: `Processed ${parsed.pageCount} page(s)/sheet(s) using ${parsed.extractionMethod}.`,
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const errorMessage = error instanceof Error ? error.message : 'Unexpected processing error.';

      await this.documentsRepository.updateProcessingState(documentId, {
        status: DocumentStatus.FAILED,
        lastError: errorMessage,
        processingTimeMs: elapsedMs,
      });

      await this.documentsRepository.appendLog({
        documentId,
        stage: ProcessingStage.DOCUMENT_PARSING,
        status: StageStatus.FAILED,
        attempt,
        durationMs: elapsedMs,
        message: errorMessage,
      });

      throw error;
    }
  }

  private async extractDocumentContent(
    doc: Document,
    fileBuffer: Buffer,
  ): Promise<AggregatedParseResult> {
    if (doc.documentType === DocumentType.PDF) {
      return this.parsePdfInChunks(doc, fileBuffer);
    }

    const response = await this.docProcessorClient.processDocument({
      buffer: fileBuffer,
      filename: doc.originalFilename,
      mimeType: doc.mimeType,
    });

    const pageCount = response.page_count ?? 1;
    await this.documentsRepository.updateProcessingState(doc.id, {
      pageCount,
      processedPages: pageCount,
      progressPercent: 80,
    });

    return {
      pageCount,
      processedPages: pageCount,
      extractionMethod: this.mapExtractionMethod(response.extraction_method),
      ocrConfidence: response.ocr_confidence ?? 1.0,
      rawText: response.raw_text ?? '',
      pages: response.pages ?? null,
      sheets: response.sheets ?? null,
      warnings: response.warnings ?? [],
    };
  }

  private async parsePdfInChunks(
    doc: Document,
    fileBuffer: Buffer,
  ): Promise<AggregatedParseResult> {
    const firstChunk = await this.docProcessorClient.processDocument({
      buffer: fileBuffer,
      filename: doc.originalFilename,
      mimeType: doc.mimeType,
      startPage: 1,
      endPage: PDF_CHUNK_SIZE,
    });

    const totalPages = firstChunk.total_pages ?? firstChunk.page_count ?? 1;
    const chunks: DocProcessorResponse[] = [firstChunk];
    let processedPages = firstChunk.page_count ?? 0;

    await this.updateChunkProgress(doc.id, processedPages, totalPages);

    for (let nextStart = PDF_CHUNK_SIZE + 1; nextStart <= totalPages; nextStart += PDF_CHUNK_SIZE) {
      const nextEnd = Math.min(nextStart + PDF_CHUNK_SIZE - 1, totalPages);
      const chunk = await this.docProcessorClient.processDocument({
        buffer: fileBuffer,
        filename: doc.originalFilename,
        mimeType: doc.mimeType,
        startPage: nextStart,
        endPage: nextEnd,
      });

      chunks.push(chunk);
      processedPages += chunk.page_count ?? 0;
      await this.updateChunkProgress(doc.id, processedPages, totalPages);
    }

    return this.mergePdfChunks(chunks, totalPages);
  }

  private async updateChunkProgress(
    documentId: string,
    processedPages: number,
    totalPages: number,
  ): Promise<void> {
    const ratio = totalPages > 0 ? processedPages / totalPages : 1;
    const progressPercent = Math.min(85, Math.max(10, Math.round(10 + ratio * 75)));
    await this.documentsRepository.updateProcessingState(documentId, {
      pageCount: totalPages,
      processedPages,
      progressPercent,
    });
  }

  private mergePdfChunks(chunks: DocProcessorResponse[], totalPages: number): AggregatedParseResult {
    const pages: DocProcessorPage[] = [];
    const textBlocks: string[] = [];
    const warnings: string[] = [];
    let digitalPages = 0;
    let ocrPages = 0;

    for (const chunk of chunks) {
      if (chunk.pages) {
        pages.push(...chunk.pages);
      }
      if (chunk.raw_text) {
        textBlocks.push(chunk.raw_text);
      }
      if (chunk.warnings) {
        warnings.push(...chunk.warnings);
      }
      digitalPages += chunk.digital_pages ?? 0;
      ocrPages += chunk.ocr_pages ?? 0;
    }

    const avgConf =
      pages.length > 0
        ? Number((pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length).toFixed(4))
        : 0;

    let extractionMethod: ExtractionMethod = ExtractionMethod.DIGITAL_TEXT;
    if (digitalPages > 0 && ocrPages > 0) {
      extractionMethod = ExtractionMethod.HYBRID;
    } else if (ocrPages > 0) {
      extractionMethod = ExtractionMethod.OCR;
    }

    return {
      pageCount: totalPages,
      processedPages: pages.length,
      extractionMethod,
      ocrConfidence: avgConf,
      rawText: textBlocks.join('\n\n'),
      pages,
      sheets: null,
      warnings,
    };
  }

  private async runPostProcessors(summary: ParsedDocumentSummary): Promise<DocumentStatus> {
    let resolvedStatus: DocumentStatus = DocumentStatus.COMPLETED;
    for (const processor of this.postProcessors) {
      const result = await processor.run(summary);
      if (result === DocumentStatus.NEEDS_REVIEW) {
        resolvedStatus = DocumentStatus.NEEDS_REVIEW;
      }
    }
    return resolvedStatus;
  }

  private mapExtractionMethod(rawMethod?: string): ExtractionMethod {
    switch (rawMethod) {
      case 'digital_text':
        return ExtractionMethod.DIGITAL_TEXT;
      case 'ocr':
        return ExtractionMethod.OCR;
      case 'hybrid':
        return ExtractionMethod.HYBRID;
      case 'spreadsheet_parser':
        return ExtractionMethod.SPREADSHEET_PARSER;
      default:
        return ExtractionMethod.OCR;
    }
  }

  private mergeUniqueWarnings(existing: Prisma.JsonValue, incoming: string[]): string[] {
    const base = Array.isArray(existing)
      ? existing.filter((item): item is string => typeof item === 'string')
      : [];
    return Array.from(new Set([...base, ...incoming]));
  }
}
