import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiPostProcessor } from '../ai/ai-post-processor';
import { DocProcessorModule } from '../doc-processor/doc-processor.module';
import { DocumentsModule } from '../documents/documents.module';
import { StorageModule } from '../storage/storage.module';
import { DOCUMENT_POST_PROCESSORS } from './document-pipeline.types';
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
    AiModule,
  ],
  providers: [
    DocumentProcessingProcessor,
    {
      provide: DOCUMENT_POST_PROCESSORS,
      inject: [AiPostProcessor],
      useFactory: (aiPostProcessor: AiPostProcessor) => [aiPostProcessor],
    },
  ],
})
export class QueueWorkerModule {}
