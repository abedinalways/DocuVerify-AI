import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { MAX_FILE_SIZE_BYTES } from './documents.constants';
import { DocumentsController } from './documents.controller';
import { DocumentsRepository } from './documents.repository';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    StorageModule,
    MulterModule.registerAsync({
      imports: [StorageModule],
      inject: [StorageService],
      useFactory: (storageService: StorageService) => ({
        storage: diskStorage({
          destination: async (_req, _file, cb) => {
            try {
              await storageService.ensureDirectory();
              cb(null, storageService.getStorageRoot());
            } catch (error) {
              cb(error as Error, '');
            }
          },
          filename: (_req, file, cb) => {
            cb(null, storageService.buildSafeFilename(file.originalname));
          },
        }),
        limits: {
          fileSize: MAX_FILE_SIZE_BYTES,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsRepository, DocumentsService],
  exports: [DocumentsRepository, DocumentsService],
})
export class DocumentsModule {}
