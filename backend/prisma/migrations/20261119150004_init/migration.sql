-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('STK_PUSH', 'C2B', 'B2C', 'B2B', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "checkoutRequestId" TEXT,
    "merchantRequestId" TEXT,
    "receiptNumber" TEXT,
    "conversationId" TEXT,
    "originatorId" TEXT,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "phoneNumber" TEXT,
    "accountReference" TEXT,
    "transactionDesc" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "externalInvoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerNumber" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "billReference" TEXT,
    "reconciliation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBalanceLog" (
    "id" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "workingBalance" DECIMAL(18,2),
    "utilityAccountAvailableFunds" DECIMAL(18,2),
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "rawResponse" JSONB,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountBalanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processingError" TEXT,
    "transactionId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_checkoutRequestId_key" ON "Transaction"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_receiptNumber_key" ON "Transaction"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_conversationId_key" ON "Transaction"("conversationId");

-- CreateIndex
CREATE INDEX "Transaction_status_createdAt_idx" ON "Transaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_type_createdAt_idx" ON "Transaction"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_externalInvoiceId_key" ON "Invoice"("externalInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_status_dueDate_idx" ON "Invoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "AccountBalanceLog_queriedAt_idx" ON "AccountBalanceLog"("queriedAt");

-- CreateIndex
CREATE INDEX "WebhookLog_source_receivedAt_idx" ON "WebhookLog"("source", "receivedAt");

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
