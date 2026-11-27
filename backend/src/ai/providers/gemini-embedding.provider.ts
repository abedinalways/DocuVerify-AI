import { Injectable } from '@nestjs/common';
import { EmbeddingProvider } from '../ai.types';
import { GeminiClient } from './gemini.client';

const EMBEDDING_DIMENSION = 768;
const MAX_EMBEDDING_CHARS = 12_000;

@Injectable()
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly geminiClient: GeminiClient) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const normalized = text.trim();
    if (!normalized) {
      return [];
    }

    const sdk = this.geminiClient.getSdk();
    const response = await sdk.models.embedContent({
      model: this.geminiClient.getEmbeddingModel(),
      contents: normalized.slice(0, MAX_EMBEDDING_CHARS),
      config: {
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Unexpected embedding dimension: expected ${EMBEDDING_DIMENSION}, got ${values?.length ?? 0}.`,
      );
    }

    return values;
  }
}
