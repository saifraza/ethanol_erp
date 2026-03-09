-- Add new fields to DistillationEntry
ALTER TABLE "DistillationEntry" ADD COLUMN IF NOT EXISTS "rcStrength" DOUBLE PRECISION;
ALTER TABLE "DistillationEntry" ADD COLUMN IF NOT EXISTS "actStrength" DOUBLE PRECISION;
ALTER TABLE "DistillationEntry" ADD COLUMN IF NOT EXISTS "spentLossLevel" TEXT;

-- Create EvaporationEntry table
CREATE TABLE IF NOT EXISTS "EvaporationEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "ff1SpGravity" DOUBLE PRECISION,
    "ff1Temp" DOUBLE PRECISION,
    "ff2SpGravity" DOUBLE PRECISION,
    "ff2Temp" DOUBLE PRECISION,
    "ff3SpGravity" DOUBLE PRECISION,
    "ff3Temp" DOUBLE PRECISION,
    "ff4SpGravity" DOUBLE PRECISION,
    "ff4Temp" DOUBLE PRECISION,
    "ff5SpGravity" DOUBLE PRECISION,
    "ff5Temp" DOUBLE PRECISION,
    "fc1SpGravity" DOUBLE PRECISION,
    "fc1Temp" DOUBLE PRECISION,
    "fc2SpGravity" DOUBLE PRECISION,
    "fc2Temp" DOUBLE PRECISION,
    "ff1Concentration" DOUBLE PRECISION,
    "ff2Concentration" DOUBLE PRECISION,
    "ff3Concentration" DOUBLE PRECISION,
    "ff4Concentration" DOUBLE PRECISION,
    "ff5Concentration" DOUBLE PRECISION,
    "vacuum" DOUBLE PRECISION,
    "thinSlopFlowRate" DOUBLE PRECISION,
    "lastSyrupGravity" DOUBLE PRECISION,
    "remark" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvaporationEntry_pkey" PRIMARY KEY ("id")
);
