import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DOCUMENT_JOB_DISPATCHER } from '../documents/documents.types';
import { DocumentQueueDispatcher } from './document-queue.dispatcher';
import { DOCUMENT_PROCESSING_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: DOCUMENT_PROCESSING_QUEUE,
    }),
  ],
  providers: [
    DocumentQueueDispatcher,
    {
      provide: DOCUMENT_JOB_DISPATCHER,
      useExisting: DocumentQueueDispatcher,
    },
  ],
  exports: [DOCUMENT_JOB_DISPATCHER, DocumentQueueDispatcher],
})
export class QueueDispatcherModule {}
