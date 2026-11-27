import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DocumentJobDispatcher } from '../documents/documents.types';
import { DocumentJobPayload } from './document-pipeline.types';
import { DOCUMENT_PROCESSING_QUEUE, PROCESS_DOCUMENT_JOB } from './queue.constants';

@Injectable()
export class DocumentQueueDispatcher implements DocumentJobDispatcher {
  constructor(
    @InjectQueue(DOCUMENT_PROCESSING_QUEUE)
    private readonly queue: Queue<DocumentJobPayload>,
  ) {}

  async enqueueProcessing(documentId: string): Promise<void> {
    await this.queue.add(
      PROCESS_DOCUMENT_JOB,
      { documentId },
      {
        jobId: `${documentId}-${Date.now()}`,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );
  }
}
