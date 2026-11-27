import { Injectable } from '@nestjs/common';
import {
  ExtractedInvoice,
  Prisma,
  ProcessingStage,
  StageStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ExtractedInvoiceCandidate } from './ai.types';

@Injectable()
export class AiExtractionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replaceAutomatedExtractions(
    documentId: string,
    invoices: ExtractedInvoiceCandidate[],
    rawResponses: unknown[],
  ): Promise<ExtractedInvoice[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.extractedInvoice.deleteMany({
        where: {
          documentId,
          isManuallyCorrected: false,
        },
      });

      const existingManualCount = await tx.extractedInvoice.count({
        where: {
          documentId,
          isManuallyCorrected: true,
        },
      });

      if (existingManualCount > 0) {
        return tx.extractedInvoice.findMany({
          where: { documentId },
          orderBy: { createdAt: 'asc' },
        });
      }

      const created: ExtractedInvoice[] = [];
      for (const item of invoices) {
        const record = await tx.extractedInvoice.create({
          data: {
            documentId,
            invoiceNumber: item.invoiceNumber,
            invoiceDate: item.invoiceDate ? new Date(`${item.invoiceDate}T00:00:00.000Z`) : null,
            rawInvoiceDate: item.rawInvoiceDate,
            supplierName: item.supplierName,
            customerName: item.customerName,
            currency: item.currency,
            subtotal: item.subtotal !== null ? new Prisma.Decimal(item.subtotal) : null,
            tax: item.tax !== null ? new Prisma.Decimal(item.tax) : null,
            total: item.total !== null ? new Prisma.Decimal(item.total) : null,
            lineItems: item.lineItems as unknown as Prisma.InputJsonValue,
            confidenceMap: {
              ...item.confidenceMap,
              uncertainFields: item.uncertainFields,
            } as unknown as Prisma.InputJsonValue,
            rawAiResponse: rawResponses as unknown as Prisma.InputJsonValue,
            sourcePageStart: item.sourcePageStart,
            sourcePageEnd: item.sourcePageEnd,
          },
        });
        created.push(record);
      }

      return created;
    });
  }

  async saveDocumentEmbedding(documentId: string, embedding: number[]): Promise<void> {
    if (embedding.length === 0) {
      return;
    }

    if (!embedding.every((val) => Number.isFinite(val))) {
      throw new Error('Embedding vector contains non-finite numbers.');
    }

    const vectorLiteral = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      UPDATE document_contents
      SET embedding = ${vectorLiteral}::vector,
          updated_at = NOW()
      WHERE document_id = ${documentId}::uuid
    `;
  }

  async appendLog(input: {
    documentId: string;
    stage: ProcessingStage;
    status: StageStatus;
    durationMs?: number;
    message?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.processingLog.create({
      data: {
        documentId: input.documentId,
        stage: input.stage,
        status: input.status,
        durationMs: input.durationMs,
        message: input.message,
        metadata: input.metadata,
      },
    });
  }
}
