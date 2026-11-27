import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_FILES } from './documents.constants';
import { DocumentsService } from './documents.service';
import { QueryDocumentsDto } from './dto/query-documents.dto';

interface UploadedFileFields {
  files?: Express.Multer.File[];
  file?: Express.Multer.File[];
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'files', maxCount: MAX_UPLOAD_FILES },
      { name: 'file', maxCount: 1 },
    ]),
  )
  uploadDocuments(@UploadedFiles() uploaded: UploadedFileFields) {
    const allFiles = [...(uploaded?.files ?? []), ...(uploaded?.file ?? [])];
    return this.documentsService.registerUploads(allFiles);
  }

  @Get()
  listDocuments(@Query() query: QueryDocumentsDto) {
    return this.documentsService.listDocuments(query);
  }

  @Get(':id')
  getDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getDocumentById(id);
  }

  @Get(':id/content')
  getDocumentContent(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getDocumentContent(id);
  }

  @Get(':id/invoices')
  getDocumentInvoices(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.getDocumentInvoices(id);
  }

  @Post(':id/reprocess')
  reprocessDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentsService.reprocessDocument(id);
  }
}
