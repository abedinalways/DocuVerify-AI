import { Injectable } from '@nestjs/common';
import {
  ExtractedInvoiceCandidate,
  ExtractionInput,
  ExtractionProviderResult,
  LlmExtractorProvider,
} from '../ai.types';
import {
  buildExtractionSystemInstruction,
  buildExtractionUserPrompt,
  splitTextIntoExtractionChunks,
} from '../prompts/invoice-extraction.prompt';
import { INVOICE_EXTRACTION_JSON_SCHEMA } from '../prompts/invoice-extraction.schema';
import { GeminiClient } from './gemini.client';

interface RawSchemaResponse {
  invoices?: ExtractedInvoiceCandidate[];
}

const RETRIABLE_STATUS_CODES = new Set([404, 429, 500, 503, 504]);

@Injectable()
export class GeminiLlmProvider implements LlmExtractorProvider {
  constructor(private readonly geminiClient: GeminiClient) {}

  async extractInvoices(input: ExtractionInput): Promise<ExtractionProviderResult> {
    const chunks = splitTextIntoExtractionChunks(input.rawText, input.pages);
    if (chunks.length === 0) {
      return { invoices: [], rawResponses: [] };
    }

    const modelCandidates = this.geminiClient.getExtractionModelCandidates();
    const systemInstruction = buildExtractionSystemInstruction();

    const invoices: ExtractedInvoiceCandidate[] = [];
    const rawResponses: unknown[] = [];

    for (const chunk of chunks) {
      const responseText = await this.generateWithFallback(
        modelCandidates,
        systemInstruction,
        buildExtractionUserPrompt(input.filename, chunk),
      );

      const parsed = this.parseJsonPayload(responseText);
      rawResponses.push(parsed);

      const chunkInvoices = Array.isArray(parsed.invoices) ? parsed.invoices : [];
      for (const candidate of chunkInvoices) {
        invoices.push({
          ...candidate,
          sourcePageStart: chunk.pageStart ?? candidate.sourcePageStart ?? null,
          sourcePageEnd: chunk.pageEnd ?? candidate.sourcePageEnd ?? null,
        });
      }
    }

    return {
      invoices: this.deduplicateChunkInvoices(invoices),
      rawResponses,
    };
  }

  private async generateWithFallback(
    models: string[],
    systemInstruction: string,
    prompt: string,
  ): Promise<string | undefined> {
    const sdk = this.geminiClient.getSdk();
    let lastError: unknown;

    for (const model of models) {
      try {
        const response = await sdk.models.generateContent({
          model,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0,
            responseMimeType: 'application/json',
            responseJsonSchema: INVOICE_EXTRACTION_JSON_SCHEMA,
          },
        });
        return response.text;
      } catch (error) {
        lastError = error;
        if (!this.isRetriableModelError(error)) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('All Gemini models failed.');
  }

  private isRetriableModelError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const status = (error as { status?: number }).status;
    const name = (error as { name?: string }).name;
    return (typeof status === 'number' && RETRIABLE_STATUS_CODES.has(status)) || name === 'AbortError';
  }

  private parseJsonPayload(rawText?: string): RawSchemaResponse {
    if (!rawText || !rawText.trim()) {
      throw new Error('Gemini returned an empty extraction response.');
    }

    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    return JSON.parse(cleaned) as RawSchemaResponse;
  }

  private deduplicateChunkInvoices(
    items: ExtractedInvoiceCandidate[],
  ): ExtractedInvoiceCandidate[] {
    const seenKeys = new Set<string>();
    const unique: ExtractedInvoiceCandidate[] = [];

    for (const item of items) {
      if (!item.invoiceNumber) {
        unique.push(item);
        continue;
      }
      const key = `${item.invoiceNumber.trim().toLowerCase()}::${item.total ?? 'null'}::${item.sourcePageStart ?? ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        unique.push(item);
      }
    }

    return unique;
  }
}
