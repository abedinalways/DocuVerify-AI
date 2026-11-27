export const DOCUMENT_JOB_DISPATCHER = Symbol('DOCUMENT_JOB_DISPATCHER');

export interface DocumentJobDispatcher {
  enqueueProcessing(documentId: string): Promise<void>;
}
