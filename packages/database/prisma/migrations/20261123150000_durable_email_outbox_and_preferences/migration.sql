-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE');

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "from" TEXT,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT,
    "templateId" TEXT,
    "metadata" JSONB,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "transportName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emailSecurityAlerts" BOOLEAN NOT NULL DEFAULT true,
    "emailFinancialTransfers" BOOLEAN NOT NULL DEFAULT true,
    "emailWtppUpdates" BOOLEAN NOT NULL DEFAULT true,
    "emailVideoProcessing" BOOLEAN NOT NULL DEFAULT true,
    "emailPlatformAnnouncements" BOOLEAN NOT NULL DEFAULT true,
    "inAppFinancialAlerts" BOOLEAN NOT NULL DEFAULT true,
    "inAppVideoProcessing" BOOLEAN NOT NULL DEFAULT true,
    "inAppPlatformAnnouncements" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_idempotencyKey_key" ON "EmailOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_createdAt_idx" ON "EmailOutbox"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
