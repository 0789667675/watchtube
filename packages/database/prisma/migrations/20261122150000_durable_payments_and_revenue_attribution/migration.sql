-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('MTN_MOMO', 'AIRTEL_MONEY');

-- CreateEnum
CREATE TYPE "PaymentTransactionKind" AS ENUM ('PAYMENT', 'PAYOUT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AdRevenueAttributionStatus" AS ENUM ('VERIFIED_CREDITED', 'VERIFIED_ESCROW_HELD', 'VERIFIED_ZERO_NET', 'REJECTED_DUPLICATE', 'REJECTED_UNMATCHED_TELEMETRY', 'REJECTED_UNELIGIBLE');

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" UUID NOT NULL,
    "transactionId" TEXT NOT NULL,
    "kind" "PaymentTransactionKind" NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "ownerScope" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "channelId" UUID,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "msisdnHash" TEXT NOT NULL,
    "maskedPhone" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerReference" TEXT,
    "providerTransactionId" TEXT,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "parentTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "webhookEventId" TEXT NOT NULL,
    "providerReference" TEXT,
    "paymentTransactionId" UUID,
    "payloadSha256" TEXT NOT NULL,
    "reportedStatus" "PaymentTransactionStatus",
    "signatureVerified" BOOLEAN NOT NULL DEFAULT true,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdRevenueAttributionLine" (
    "id" UUID NOT NULL,
    "reconciliationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "externalReportId" TEXT NOT NULL,
    "videoId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "sessionId" TEXT,
    "isShort" BOOLEAN NOT NULL,
    "reportedGrossRevenueCents" BIGINT NOT NULL,
    "providerFeeCents" BIGINT NOT NULL DEFAULT 0,
    "invalidTrafficDeductionCents" BIGINT NOT NULL DEFAULT 0,
    "verifiedNetRevenueCents" BIGINT NOT NULL,
    "appliedCreatorShareBps" INTEGER NOT NULL,
    "appliedShortsRateBps" INTEGER,
    "standardCreatorShareCents" BIGINT NOT NULL,
    "creatorAttributableCents" BIGINT NOT NULL,
    "platformAttributableCents" BIGINT NOT NULL,
    "escrowWithheldCents" BIGINT NOT NULL DEFAULT 0,
    "ledgerReferenceId" TEXT,
    "status" "AdRevenueAttributionStatus" NOT NULL,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdRevenueAttributionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_transactionId_key" ON "PaymentTransaction"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_provider_providerTransactionId_idx" ON "PaymentTransaction"("provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_userId_createdAt_idx" ON "PaymentTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_channelId_createdAt_idx" ON "PaymentTransaction"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_reconciliationRequired_idx" ON "PaymentTransaction"("status", "reconciliationRequired");

-- CreateIndex
CREATE INDEX "PaymentTransaction_parentTransactionId_idx" ON "PaymentTransaction"("parentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_kind_ownerScope_idempotencyKey_key" ON "PaymentTransaction"("kind", "ownerScope", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerReference_key" ON "PaymentTransaction"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_providerReference_idx" ON "PaymentWebhookEvent"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_paymentTransactionId_idx" ON "PaymentWebhookEvent"("paymentTransactionId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_processedAt_idx" ON "PaymentWebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_webhookEventId_key" ON "PaymentWebhookEvent"("provider", "webhookEventId");

-- CreateIndex
CREATE UNIQUE INDEX "AdRevenueAttributionLine_ledgerReferenceId_key" ON "AdRevenueAttributionLine"("ledgerReferenceId");

-- CreateIndex
CREATE INDEX "AdRevenueAttributionLine_reconciliationId_idx" ON "AdRevenueAttributionLine"("reconciliationId");

-- CreateIndex
CREATE INDEX "AdRevenueAttributionLine_channelId_periodMonth_idx" ON "AdRevenueAttributionLine"("channelId", "periodMonth");

-- CreateIndex
CREATE INDEX "AdRevenueAttributionLine_videoId_periodMonth_idx" ON "AdRevenueAttributionLine"("videoId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "AdRevenueAttributionLine_provider_periodMonth_externalRepor_key" ON "AdRevenueAttributionLine"("provider", "periodMonth", "externalReportId");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_parentTransactionId_fkey" FOREIGN KEY ("parentTransactionId") REFERENCES "PaymentTransaction"("transactionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenueAttributionLine" ADD CONSTRAINT "AdRevenueAttributionLine_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "RevenueReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenueAttributionLine" ADD CONSTRAINT "AdRevenueAttributionLine_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenueAttributionLine" ADD CONSTRAINT "AdRevenueAttributionLine_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdRevenueAttributionLine" ADD CONSTRAINT "AdRevenueAttributionLine_ledgerReferenceId_fkey" FOREIGN KEY ("ledgerReferenceId") REFERENCES "WalletTransaction"("referenceId") ON DELETE RESTRICT ON UPDATE CASCADE;
