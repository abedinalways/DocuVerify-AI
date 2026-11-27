import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfig } from '../config/app.config';

export interface StoredFileMeta {
  storagePath: string;
  sha256Hash: string;
  sizeBytes: number;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly storageRoot: string;

  constructor(private readonly configService: ConfigService) {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    this.storageRoot = path.resolve(appConfig.storageDir);
  }

  async onModuleInit(): Promise<void> {
    await this.ensureDirectory();
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
  }

  getStorageRoot(): string {
    return this.storageRoot;
  }

  buildSafeFilename(originalFilename: string): string {
    const ext = path.extname(originalFilename).toLowerCase();
    return `${randomUUID()}${ext}`;
  }

  async saveBuffer(buffer: Buffer, originalFilename: string): Promise<StoredFileMeta> {
    await mkdir(this.storageRoot, { recursive: true });
    const targetPath = path.join(this.storageRoot, this.buildSafeFilename(originalFilename));
    await writeFile(targetPath, buffer);
    const sha256Hash = createHash('sha256').update(buffer).digest('hex');

    return {
      storagePath: targetPath,
      sha256Hash,
      sizeBytes: buffer.length,
    };
  }

  async inspectFile(filePath: string): Promise<{ sha256Hash: string; sizeBytes: number }> {
    const [fileStats, sha256Hash] = await Promise.all([
      stat(filePath),
      this.computeSha256(filePath),
    ]);

    return {
      sha256Hash,
      sizeBytes: fileStats.size,
    };
  }

  async computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async readBuffer(filePath: string): Promise<Buffer> {
    return readFile(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
