import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, loadAppConfig } from './config/app.config';
import { DatabaseModule } from './database/database.module';
import { DocProcessorModule } from './doc-processor/doc-processor.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { QueueWorkerModule } from './queue/queue-worker.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      load: [loadAppConfig],
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.getOrThrow<AppConfig>('app');
        return {
          connection: {
            host: appConfig.redis.host,
            port: appConfig.redis.port,
          },
        };
      },
    }),
    DatabaseModule,
    StorageModule,
    DocProcessorModule,
    DocumentsModule,
    QueueWorkerModule,
    HealthModule,
  ],
})
export class AppModule {}
