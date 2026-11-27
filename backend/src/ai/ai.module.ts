import { Module } from '@nestjs/common';
import { AiExtractionRepository } from './ai-extraction.repository';
import { AiExtractionService } from './ai-extraction.service';
import { AiPostProcessor } from './ai-post-processor';
import { EMBEDDING_PROVIDER, LLM_EXTRACTOR_PROVIDER } from './ai.types';
import { GeminiClient } from './providers/gemini.client';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import { GeminiLlmProvider } from './providers/gemini-llm.provider';
import { InvoiceGroundingSanitizer } from './sanitizers/invoice-grounding.sanitizer';

@Module({
  providers: [
    GeminiClient,
    GeminiLlmProvider,
    GeminiEmbeddingProvider,
    {
      provide: LLM_EXTRACTOR_PROVIDER,
      useExisting: GeminiLlmProvider,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useExisting: GeminiEmbeddingProvider,
    },
    InvoiceGroundingSanitizer,
    AiExtractionRepository,
    AiExtractionService,
    AiPostProcessor,
  ],
  exports: [
    LLM_EXTRACTOR_PROVIDER,
    EMBEDDING_PROVIDER,
    AiExtractionService,
    AiPostProcessor,
  ],
})
export class AiModule {}
