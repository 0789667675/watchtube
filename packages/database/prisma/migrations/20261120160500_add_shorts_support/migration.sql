ALTER TABLE "Video"
    ADD COLUMN "isShort" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Video_isShort_status_visibility_createdAt_idx"
    ON "Video"("isShort", "status", "visibility", "createdAt");
