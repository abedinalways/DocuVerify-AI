import { Injectable } from '@nestjs/common';
import { DocumentStatus } from '@prisma/client';
import { DocumentPostProcessor, ParsedDocumentSummary } from '../queue/document-pipeline.types';
import { AiExtractionService } from './ai-extraction.service';

@Injectable()
export class AiPostProcessor implements DocumentPostProcessor {
  constructor(private readonly aiExtractionService: AiExtractionService) {}

  async run(parsed: ParsedDocumentSummary): Promise<DocumentStatus | void> {
    const outcome = await this.aiExtractionService.processDocumentAi({
      documentId: parsed.documentId,
      filename: parsed.filename,
      rawText: parsed.rawText,
      pages: parsed.pages,
    });

    if (outcome.hasUncertainExtraction) {
      return DocumentStatus.NEEDS_REVIEW;
    }
  }
}
