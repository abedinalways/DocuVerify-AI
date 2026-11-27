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
    },
    storageDir: process.env.UPLOAD_STORAGE_DIR || './uploads',
  },
});
