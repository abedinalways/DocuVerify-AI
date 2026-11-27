export interface AppConfig {
  port: number;
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
  };
  docProcessorUrl: string;
  llm: {
    provider: string;
    geminiApiKey: string;
    geminiExtractionModel: string;
    geminiFallbackModels: string[];
    geminiEmbeddingModel: string;
  };
  storageDir: string;
}

export const loadAppConfig = (): { app: AppConfig } => ({
  app: {
    port: Number(process.env.BACKEND_PORT) || 4000,
    databaseUrl: process.env.DATABASE_URL ?? '',
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    },
    docProcessorUrl: (process.env.DOC_PROCESSOR_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    llm: {
      provider: process.env.LLM_PROVIDER || 'gemini',
      geminiApiKey: process.env.GEMINI_API_KEY ?? '',
      geminiExtractionModel: process.env.GEMINI_EXTRACTION_MODEL || 'gemini-3.5-flash-lite',
      geminiFallbackModels: (
        process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.1-flash-lite,gemini-3.8-flash,gemini-3.5-flash'
      )
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    },
    storageDir: process.env.UPLOAD_STORAGE_DIR || './uploads',
  },
});
