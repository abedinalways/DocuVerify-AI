import { Module } from '@nestjs/common';
import { DocProcessorClient } from './doc-processor.client';

@Module({
  providers: [DocProcessorClient],
  exports: [DocProcessorClient],
})
export class DocProcessorModule {}
