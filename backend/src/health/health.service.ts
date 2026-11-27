import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/app.config';
import { PrismaService } from '../database/prisma.service';

export type DependencyState = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  services: {
    postgres: DependencyState;
    redis: DependencyState;
    docProcessor: DependencyState;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async check(): Promise<HealthReport> {
    const [postgres, redis, docProcessor] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkDocProcessor(),
    ]);

    const allHealthy = postgres === 'up' && redis === 'up' && docProcessor === 'up';
    return {
      status: allHealthy ? 'ok' : 'degraded',
      services: {
        postgres,
        redis,
        docProcessor,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<DependencyState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyState> {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    const client = new Redis({
      host: appConfig.redis.host,
      port: appConfig.redis.port,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    } finally {
      client.disconnect();
    }
  }

  private async checkDocProcessor(): Promise<DependencyState> {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    try {
      const response = await fetch(`${appConfig.docProcessorUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
