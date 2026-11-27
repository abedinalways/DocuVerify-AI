import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DocProcessorModule } from '../doc-processor/doc-processor.module';
import { DocumentsModule } from '../documents/documents.module';
import { StorageModule } from '../storage/storage.module';
import { DocumentProcessingProcessor } from './document-processing.processor';
import { DOCUMENT_PROCESSING_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DOCUMENT_PROCESSING_QUEUE,
    }),
    DocumentsModule,
    StorageModule,
    DocProcessorModule,
  ],
  providers: [DocumentProcessingProcessor],
})
export class QueueWorkerModule {}
