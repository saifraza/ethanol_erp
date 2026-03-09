-- Add Beer Well level to GrainEntry
ALTER TABLE "GrainEntry" ADD COLUMN "beerWellLevel" DOUBLE PRECISION;

-- Add new fields to LiquefactionEntry
ALTER TABLE "LiquefactionEntry" ADD COLUMN "flourRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN "hotWaterFlowRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN "thinSlopRecycleFlowRate" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN "iltLevel" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN "fltLevel" DOUBLE PRECISION;
ALTER TABLE "LiquefactionEntry" ADD COLUMN "fltFlowRate" DOUBLE PRECISION;
