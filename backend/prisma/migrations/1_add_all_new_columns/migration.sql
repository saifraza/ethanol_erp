-- Consolidated migration: add all columns added after initial schema
-- Uses IF NOT EXISTS so it's safe to run regardless of current DB state

-- GrainEntry: datetime tracking fields
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "washConsumedAt" TIMESTAMP(3);
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "fermentationVolumeAt" TIMESTAMP(3);

-- GrainEntry: individual fermenter level fields
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "f1Level" DOUBLE PRECISION;
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "f2Level" DOUBLE PRECISION;
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "f3Level" DOUBLE PRECISION;
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "f4Level" DOUBLE PRECISION;
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "pf1Level" DOUBLE PRECISION;
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "pf2Level" DOUBLE PRECISION;

-- GrainEntry: beer well level
ALTER TABLE "GrainEntry" ADD COLUMN IF NOT EXISTS "beerWellLevel" DOUBLE PRECISION;

-- LiquefactionEntry: new monitoring fields
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "iltLevel" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "fltLevel" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "fltFlowRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "flourRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "hotWaterFlowRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN IF NOT EXISTS "thinSlopRecycleFlowRate" DOUBLE PRECISION;
