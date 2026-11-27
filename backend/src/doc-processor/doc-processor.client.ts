import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/app.config';
import { DocProcessorResponse, ProcessFileRequest } from './doc-processor.types';

const PROCESSOR_TIMEOUT_MS = 180_000;

@Injectable()
export class DocProcessorClient {
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    this.baseUrl = appConfig.docProcessorUrl;
  }

  async processDocument(request: ProcessFileRequest): Promise<DocProcessorResponse> {
    const endpoint = this.buildProcessUrl(request.startPage, request.endPage);
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(request.buffer)], {
      type: request.mimeType || 'application/octet-stream',
    });
    formData.append('file', blob, request.filename);

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(PROCESSOR_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Document processor returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as DocProcessorResponse;
    if (payload.status === 'failed') {
      throw new Error(payload.error || 'Document processing failed');
    }

    return payload;
  }

  private buildProcessUrl(startPage?: number, endPage?: number): string {
    const url = new URL(`${this.baseUrl}/process`);
    if (startPage !== undefined) {
      url.searchParams.set('start_page', String(startPage));
    }
    if (endPage !== undefined) {
      url.searchParams.set('end_page', String(endPage));
    }
    return url.toString();
  }
}
