CREATE TABLE "ShortsMonetizationSetting" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "rateBasisPoints" INTEGER NOT NULL DEFAULT 3000,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortsMonetizationSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ShortsMonetizationSetting" ("id", "rateBasisPoints", "updatedById", "updatedAt")
VALUES ('global', 3000, NULL, CURRENT_TIMESTAMP);

CREATE TABLE "ShortsMonetizationRateAudit" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "previousRateBasisPoints" INTEGER NOT NULL,
    "newRateBasisPoints" INTEGER NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortsMonetizationRateAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShortsMonetizationRateAudit_changedAt_idx"
    ON "ShortsMonetizationRateAudit"("changedAt");

ALTER TABLE "ShortsMonetizationSetting"
    ADD CONSTRAINT "ShortsMonetizationSetting_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShortsMonetizationRateAudit"
    ADD CONSTRAINT "ShortsMonetizationRateAudit_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
