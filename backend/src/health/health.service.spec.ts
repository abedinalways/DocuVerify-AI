import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { HealthService } from './health.service';

const mockPing = jest.fn();
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    ping: mockPing,
    disconnect: mockDisconnect,
  })),
}));

describe('HealthService', () => {
  const mockConfig = {
    getOrThrow: jest.fn().mockReturnValue({
      redis: { host: 'localhost', port: 6379 },
      docProcessorUrl: 'http://localhost:8000',
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockPing.mockResolvedValue('PONG');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports ok when postgres, redis, and doc-processor are up', async () => {
    const mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    const service = new HealthService(mockPrisma, mockConfig);
    const report = await service.check();

    expect(report.status).toBe('ok');
    expect(report.services).toEqual({
      postgres: 'up',
      redis: 'up',
      docProcessor: 'up',
    });
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('reports degraded when postgres query fails', async () => {
    const mockPrisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as PrismaService;
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    const service = new HealthService(mockPrisma, mockConfig);
    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.services.postgres).toBe('down');
    expect(report.services.redis).toBe('up');
    expect(report.services.docProcessor).toBe('up');
  });
});
