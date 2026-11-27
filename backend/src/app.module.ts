import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadAppConfig } from './config/app.config';
import { DatabaseModule } from './database/database.module';
import { DocProcessorModule } from './doc-processor/doc-processor.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      load: [loadAppConfig],
    }),
    DatabaseModule,
    StorageModule,
    DocProcessorModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class AppModule {}
