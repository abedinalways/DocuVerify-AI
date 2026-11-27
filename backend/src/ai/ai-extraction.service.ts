import { Inject, Injectable } from '@nestjs/common';
import { ProcessingStage, StageStatus } from '@prisma/client';
import { DocProcessorPage } from '../doc-processor/doc-processor.types';
import { AiExtractionRepository } from './ai-extraction.repository';
import {
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
  ExtractedInvoiceCandidate,
  LLM_EXTRACTOR_PROVIDER,
  LlmExtractorProvider,
} from './ai.types';
import { InvoiceGroundingSanitizer } from './sanitizers/invoice-grounding.sanitizer';

const LOW_CONFIDENCE_THRESHOLD = 0.6;

export interface ProcessDocumentAiInput {
  documentId: string;
  filename: string;
  rawText: string;
  pages?: DocProcessorPage[] | null;
}

export interface ProcessDocumentAiOutcome {
  extractedCount: number;
  hasUncertainExtraction: boolean;
  embedded: boolean;
}

@Injectable()
export class AiExtractionService {
  constructor(
    @Inject(LLM_EXTRACTOR_PROVIDER)
    private readonly llmExtractor: LlmExtractorProvider,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly sanitizer: InvoiceGroundingSanitizer,
    private readonly repository: AiExtractionRepository,
  ) {}

  async processDocumentAi(input: ProcessDocumentAiInput): Promise<ProcessDocumentAiOutcome> {
    if (!input.rawText.trim()) {
      await this.repository.appendLog({
        documentId: input.documentId,
        stage: ProcessingStage.AI_EXTRACTION,
        status: StageStatus.FAILED,
        message: 'Skipped AI extraction because extracted text is empty.',
      });
      return {
        extractedCount: 0,
        hasUncertainExtraction: true,
        embedded: false,
      };
    }

    const sanitizedInvoices = await this.runExtractionStage(input);
    const embedded = await this.runEmbeddingStage(input, sanitizedInvoices);

    const hasUncertainExtraction =
      sanitizedInvoices.length === 0 ||
      sanitizedInvoices.some(
        (inv) =>
          inv.uncertainFields.length > 0 ||
          inv.confidenceMap.total < LOW_CONFIDENCE_THRESHOLD ||
          inv.confidenceMap.invoiceNumber < LOW_CONFIDENCE_THRESHOLD,
      );

    return {
      extractedCount: sanitizedInvoices.length,
      hasUncertainExtraction,
      embedded,
    };
  }

  async embedQueryText(text: string): Promise<number[]> {
    return this.embeddingProvider.generateEmbedding(text);
  }

  private async runExtractionStage(
    input: ProcessDocumentAiInput,
  ): Promise<ExtractedInvoiceCandidate[]> {
    const startedAt = Date.now();
    await this.repository.appendLog({
      documentId: input.documentId,
      stage: ProcessingStage.AI_EXTRACTION,
      status: StageStatus.STARTED,
      message: `Starting AI extraction for ${input.filename}.`,
    });

    try {
      const result = await this.llmExtractor.extractInvoices({
        filename: input.filename,
        rawText: input.rawText,
        pages: input.pages,
      });

      const sanitized = this.sanitizer.sanitizeBatch(
        result.invoices,
        input.rawText,
        Boolean(input.pages && input.pages.length > 0),
      );

      await this.repository.replaceAutomatedExtractions(
        input.documentId,
        sanitized,
        result.rawResponses,
      );

      await this.repository.appendLog({
        documentId: input.documentId,
        stage: ProcessingStage.AI_EXTRACTION,
        status: StageStatus.SUCCEEDED,
        durationMs: Date.now() - startedAt,
        message: `Extracted ${sanitized.length} invoice record(s).`,
      });

      return sanitized;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI extraction failed.';
      await this.repository.appendLog({
        documentId: input.documentId,
        stage: ProcessingStage.AI_EXTRACTION,
        status: StageStatus.FAILED,
        durationMs: Date.now() - startedAt,
        message: errorMessage,
      });
      throw error;
    }
  }

  private async runEmbeddingStage(
    input: ProcessDocumentAiInput,
    invoices: ExtractedInvoiceCandidate[],
  ): Promise<boolean> {
    const startedAt = Date.now();
    await this.repository.appendLog({
      documentId: input.documentId,
      stage: ProcessingStage.EMBEDDING,
      status: StageStatus.STARTED,
      message: 'Generating semantic search embedding.',
    });

    try {
      const embeddingText = this.buildEmbeddingInput(input.filename, input.rawText, invoices);
      const vector = await this.embeddingProvider.generateEmbedding(embeddingText);
      await this.repository.saveDocumentEmbedding(input.documentId, vector);

      await this.repository.appendLog({
        documentId: input.documentId,
        stage: ProcessingStage.EMBEDDING,
        status: StageStatus.SUCCEEDED,
        durationMs: Date.now() - startedAt,
        message: `Saved ${vector.length}-dimensional vector embedding.`,
      });
      return vector.length > 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Embedding generation failed.';
      await this.repository.appendLog({
        documentId: input.documentId,
        stage: ProcessingStage.EMBEDDING,
        status: StageStatus.FAILED,
        durationMs: Date.now() - startedAt,
        message: errorMessage,
      });
      throw error;
    }
  }

  private buildEmbeddingInput(
    filename: string,
    rawText: string,
    invoices: ExtractedInvoiceCandidate[],
  ): string {
    const summaries = invoices.map((inv) =>
      [
        inv.invoiceNumber ? `Invoice: ${inv.invoiceNumber}` : null,
        inv.supplierName ? `Supplier: ${inv.supplierName}` : null,
        inv.customerName ? `Customer: ${inv.customerName}` : null,
        inv.invoiceDate ? `Date: ${inv.invoiceDate}` : null,
        inv.total !== null ? `Total: ${inv.total} ${inv.currency ?? ''}`.trim() : null,
      ]
        .filter(Boolean)
        .join(' | '),
    );

    return [`File: ${filename}`, ...summaries, rawText].filter(Boolean).join('\n\n');
  }
}
