import { ConfigService } from '@nestjs/config';
import { DocProcessorClient } from './doc-processor.client';

describe('DocProcessorClient', () => {
  const mockConfig = {
    getOrThrow: jest.fn().mockReturnValue({
      docProcessorUrl: 'http://localhost:8000',
    }),
  } as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends page range params and returns parsed processor payload', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'success',
        filename: 'large.pdf',
        file_type: '.pdf',
        file_size_bytes: 100,
        file_hash: 'hash',
        processing_time_ms: 42,
        error: null,
        total_pages: 100,
        start_page: 1,
        end_page: 25,
        raw_text: 'Invoice text',
      }),
    } as Response);

    const client = new DocProcessorClient(mockConfig);
    const result = await client.processDocument({
      buffer: Buffer.from('%PDF-1.4'),
      filename: 'large.pdf',
      mimeType: 'application/pdf',
      startPage: 1,
      endPage: 25,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://localhost:8000/process?start_page=1&end_page=25');
    expect(result.raw_text).toBe('Invoice text');
  });

  it('throws error when processor marks document as failed', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'failed',
        error: 'Invalid PDF signature',
      }),
    } as Response);

    const client = new DocProcessorClient(mockConfig);
    await expect(
      client.processDocument({
        buffer: Buffer.from('bad'),
        filename: 'bad.pdf',
      }),
    ).rejects.toThrow('Invalid PDF signature');
  });
});
