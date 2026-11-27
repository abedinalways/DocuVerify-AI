CREATE EXTENSION IF NOT EXISTS vector;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PDF', 'IMAGE', 'SPREADSHEET');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('DIGITAL_TEXT', 'OCR', 'HYBRID', 'SPREADSHEET_PARSER');

-- CreateEnum
CREATE TYPE "ValidationSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "CrossVerifyType" AS ENUM ('PDF_TO_PDF', 'PDF_TO_EXCEL');

-- CreateEnum
CREATE TYPE "CrossVerifyStatus" AS ENUM ('MATCHED', 'PARTIAL_MATCH', 'MISMATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('UPLOAD', 'DOCUMENT_PARSING', 'AI_EXTRACTION', 'EMBEDDING', 'VALIDATION', 'CROSS_VERIFICATION', 'MANUAL_CORRECTION', 'REPROCESS');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "original_filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "sha256_hash" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER,
    "processed_pages" INTEGER NOT NULL DEFAULT 0,
    "extraction_method" "ExtractionMethod",
    "ocr_confidence" DOUBLE PRECISION,
    "processing_time_ms" INTEGER,
    "last_error" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_contents" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "raw_text" TEXT NOT NULL DEFAULT '',
    "pages_json" JSONB,
    "sheets_json" JSONB,
    "embedding" vector(768),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_invoices" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "invoice_number" TEXT,
    "invoice_date" DATE,
    "raw_invoice_date" TEXT,
    "supplier_name" TEXT,
    "customer_name" TEXT,
    "currency" TEXT,
    "subtotal" DECIMAL(14,2),
    "tax" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "confidence_map" JSONB NOT NULL DEFAULT '{}',
    "raw_ai_response" JSONB,
    "is_manually_corrected" BOOLEAN NOT NULL DEFAULT false,
    "corrected_by" TEXT,
    "corrected_at" TIMESTAMP(3),
    "source_page_start" INTEGER,
    "source_page_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_corrections" (
    "id" UUID NOT NULL,
    "extracted_invoice_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "corrected_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_issues" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "extracted_invoice_id" UUID,
    "rule_code" TEXT NOT NULL,
    "field_name" TEXT,
    "severity" "ValidationSeverity" NOT NULL DEFAULT 'ERROR',
    "status" "ValidationStatus" NOT NULL DEFAULT 'OPEN',
    "expected_value" TEXT,
    "actual_value" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "validation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_verifications" (
    "id" UUID NOT NULL,
    "source_document_id" UUID NOT NULL,
    "target_document_id" UUID NOT NULL,
    "verification_type" "CrossVerifyType" NOT NULL,
    "status" "CrossVerifyStatus" NOT NULL,
    "match_score" DOUBLE PRECISION,
    "summary" TEXT,
    "discrepancies" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_logs" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "stage" "ProcessingStage" NOT NULL,
    "status" "StageStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER,
    "message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_sha256_hash_idx" ON "documents"("sha256_hash");

-- CreateIndex
CREATE INDEX "documents_document_type_idx" ON "documents"("document_type");

-- CreateIndex
CREATE INDEX "documents_created_at_idx" ON "documents"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_contents_document_id_key" ON "document_contents"("document_id");

-- CreateIndex
CREATE INDEX "extracted_invoices_document_id_idx" ON "extracted_invoices"("document_id");

-- CreateIndex
CREATE INDEX "extracted_invoices_invoice_number_idx" ON "extracted_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "extracted_invoices_supplier_name_idx" ON "extracted_invoices"("supplier_name");

-- CreateIndex
CREATE INDEX "extracted_invoices_invoice_date_idx" ON "extracted_invoices"("invoice_date");

-- CreateIndex
CREATE INDEX "extracted_invoices_total_idx" ON "extracted_invoices"("total");

-- CreateIndex
CREATE INDEX "invoice_corrections_extracted_invoice_id_idx" ON "invoice_corrections"("extracted_invoice_id");

-- CreateIndex
CREATE INDEX "validation_issues_document_id_idx" ON "validation_issues"("document_id");

-- CreateIndex
CREATE INDEX "validation_issues_status_idx" ON "validation_issues"("status");

-- CreateIndex
CREATE INDEX "validation_issues_rule_code_idx" ON "validation_issues"("rule_code");

-- CreateIndex
CREATE INDEX "cross_verifications_source_document_id_idx" ON "cross_verifications"("source_document_id");

-- CreateIndex
CREATE INDEX "cross_verifications_target_document_id_idx" ON "cross_verifications"("target_document_id");

-- CreateIndex
CREATE INDEX "cross_verifications_verification_type_idx" ON "cross_verifications"("verification_type");

-- CreateIndex
CREATE INDEX "processing_logs_document_id_idx" ON "processing_logs"("document_id");

-- CreateIndex
CREATE INDEX "processing_logs_stage_status_idx" ON "processing_logs"("stage", "status");

-- AddForeignKey
ALTER TABLE "document_contents" ADD CONSTRAINT "document_contents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_invoices" ADD CONSTRAINT "extracted_invoices_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_corrections" ADD CONSTRAINT "invoice_corrections_extracted_invoice_id_fkey" FOREIGN KEY ("extracted_invoice_id") REFERENCES "extracted_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_issues" ADD CONSTRAINT "validation_issues_extracted_invoice_id_fkey" FOREIGN KEY ("extracted_invoice_id") REFERENCES "extracted_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_verifications" ADD CONSTRAINT "cross_verifications_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_verifications" ADD CONSTRAINT "cross_verifications_target_document_id_fkey" FOREIGN KEY ("target_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE INDEX IF NOT EXISTS "idx_document_contents_embedding_hnsw"
  ON "document_contents" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "idx_document_contents_raw_text_gin"
  ON "document_contents" USING GIN (to_tsvector('english', "raw_text"));
