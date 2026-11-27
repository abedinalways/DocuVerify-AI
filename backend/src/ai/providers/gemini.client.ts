import { GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/app.config';

const REQUEST_TIMEOUT_MS = 25_000;

@Injectable()
export class GeminiClient {
  private client: GoogleGenAI | null = null;
  private readonly apiKey: string;
  private readonly extractionModel: string;
  private readonly fallbackModels: string[];
  private readonly embeddingModel: string;

  constructor(private readonly configService: ConfigService) {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    this.apiKey = appConfig.llm.geminiApiKey;
    this.extractionModel = appConfig.llm.geminiExtractionModel;
    this.fallbackModels = appConfig.llm.geminiFallbackModels;
    this.embeddingModel = appConfig.llm.geminiEmbeddingModel;
  }

  getSdk(): GoogleGenAI {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      });
    }
    return this.client;
  }

  getExtractionModelCandidates(): string[] {
    return Array.from(new Set([this.extractionModel, ...this.fallbackModels]));
  }

  getEmbeddingModel(): string {
    return this.embeddingModel;
  }
}
