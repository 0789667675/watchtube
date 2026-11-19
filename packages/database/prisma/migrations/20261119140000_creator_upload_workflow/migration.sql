ALTER TYPE "VideoStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "VideoStatus" ADD VALUE 'READY_FOR_REVIEW';
ALTER TYPE "VideoStatus" ADD VALUE 'PUBLISHED';
ALTER TYPE "VideoStatus" ADD VALUE 'FAILED';
ALTER TYPE "VideoStatus" ADD VALUE 'BLOCKED';

CREATE TYPE "VideoCategory" AS ENUM (
    'FILM_ANIMATION',
    'AUTOS_VEHICLES',
    'MUSIC',
    'PETS_ANIMALS',
    'SPORTS',
    'TRAVEL_EVENTS',
    'GAMING',
    'PEOPLE_BLOGS',
    'COMEDY',
    'ENTERTAINMENT',
    'NEWS_POLITICS',
    'HOWTO_STYLE',
    'EDUCATION',
    'SCIENCE_TECH',
    'NONPROFITS_ACTIVISM',
    'OTHER'
);

CREATE TYPE "CopyrightReviewStatus" AS ENUM ('NOT_SCANNED', 'BLOCKED');

ALTER TABLE "Video"
    ALTER COLUMN "rawStorageKey" DROP NOT NULL,
    ADD COLUMN "uploadContentType" TEXT,
    ADD COLUMN "uploadFileSize" BIGINT,
    ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "category" "VideoCategory" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "copyrightDeclared" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "copyrightDeclaredAt" TIMESTAMP(3),
    ADD COLUMN "copyrightDeclaredById" UUID,
    ADD COLUMN "copyrightReviewStatus" "CopyrightReviewStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    ADD COLUMN "thumbnailStorageKey" TEXT,
    ADD COLUMN "pendingThumbnailStorageKey" TEXT,
    ADD COLUMN "pendingThumbnailContentType" TEXT,
    ADD COLUMN "pendingThumbnailFileSize" BIGINT;

CREATE INDEX "Video_status_visibility_createdAt_idx"
    ON "Video"("status", "visibility", "createdAt");

ALTER TABLE "Video"
    ADD CONSTRAINT "Video_copyrightDeclaredById_fkey"
    FOREIGN KEY ("copyrightDeclaredById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CopyrightClaim"
    ADD COLUMN "reviewerId" UUID,
    ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "CopyrightClaim"
    ADD CONSTRAINT "CopyrightClaim_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
