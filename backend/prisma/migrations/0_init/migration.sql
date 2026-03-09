-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearStart" INTEGER NOT NULL,
    "syrup1Flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syrup2Flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syrup3Flow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fltFlow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "washFlow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fermenter1Level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fermenter2Level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fermenter3Level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fermenter4Level" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "beerWellLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pfLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainOpeningStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainUnloadedToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainDistilled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainClosingStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainInFermenters" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "steamTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "steamAvgTph" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "steamPerTon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "distillationEfficiency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveryPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TankDip" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearStart" INTEGER NOT NULL,
    "rsLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hfoLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lfoLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "production" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TankDip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "grainPercent" DOUBLE PRECISION NOT NULL DEFAULT 31,
    "fermenter1Cap" DOUBLE PRECISION NOT NULL DEFAULT 2300,
    "fermenter2Cap" DOUBLE PRECISION NOT NULL DEFAULT 2300,
    "fermenter3Cap" DOUBLE PRECISION NOT NULL DEFAULT 2300,
    "fermenter4Cap" DOUBLE PRECISION NOT NULL DEFAULT 2300,
    "beerWellCap" DOUBLE PRECISION NOT NULL DEFAULT 430,
    "pfCap" DOUBLE PRECISION NOT NULL DEFAULT 430,
    "pfGrainPercent" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "rsCap" DOUBLE PRECISION NOT NULL DEFAULT 15000,
    "hfoCap" DOUBLE PRECISION NOT NULL DEFAULT 15000,
    "lfoCap" DOUBLE PRECISION NOT NULL DEFAULT 15000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrainEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearStart" INTEGER NOT NULL,
    "grainUnloaded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "washConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fermentationVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grainInProcess" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "siloOpeningStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "siloClosingStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalGrainAtPlant" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cumulativeUnloaded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cumulativeConsumed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moisture" DOUBLE PRECISION,
    "starchPercent" DOUBLE PRECISION,
    "damagedPercent" DOUBLE PRECISION,
    "foreignMatter" DOUBLE PRECISION,
    "trucks" INTEGER,
    "avgTruckWeight" DOUBLE PRECISION,
    "supplier" TEXT,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GrainEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MillingEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearStart" INTEGER NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "sieve_1mm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sieve_850" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sieve_600" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sieve_300" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFine" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millA_rpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millA_load" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millB_rpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millB_load" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millC_rpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "millC_load" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MillingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMaterialEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vehicleCode" TEXT NOT NULL DEFAULT '',
    "vehicleNo" TEXT NOT NULL DEFAULT '',
    "moisture" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "starch" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fungus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "immature" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damaged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterDamaged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tfm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remark" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RawMaterialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquefactionEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "jetCookerTemp" DOUBLE PRECISION,
    "jetCookerFlow" DOUBLE PRECISION,
    "iltTemp" DOUBLE PRECISION,
    "iltSpGravity" DOUBLE PRECISION,
    "iltPh" DOUBLE PRECISION,
    "iltRs" DOUBLE PRECISION,
    "fltTemp" DOUBLE PRECISION,
    "fltSpGravity" DOUBLE PRECISION,
    "fltPh" DOUBLE PRECISION,
    "fltRs" DOUBLE PRECISION,
    "fltRst" DOUBLE PRECISION,
    "iltDs" DOUBLE PRECISION,
    "iltTs" DOUBLE PRECISION,
    "fltDs" DOUBLE PRECISION,
    "fltTs" DOUBLE PRECISION,
    "iltBrix" DOUBLE PRECISION,
    "fltBrix" DOUBLE PRECISION,
    "iltViscosity" DOUBLE PRECISION,
    "fltViscosity" DOUBLE PRECISION,
    "iltAcidity" DOUBLE PRECISION,
    "fltAcidity" DOUBLE PRECISION,
    "slurryFlow" DOUBLE PRECISION,
    "steamFlow" DOUBLE PRECISION,
    "remark" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiquefactionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PFChemical" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PFChemical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PFBatch" (
    "id" TEXT NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "fermenterNo" INTEGER NOT NULL DEFAULT 1,
    "phase" TEXT NOT NULL DEFAULT 'SETUP',
    "setupTime" TIMESTAMP(3),
    "dosingEndTime" TIMESTAMP(3),
    "slurryVolume" DOUBLE PRECISION,
    "slurryGravity" DOUBLE PRECISION,
    "slurryTemp" DOUBLE PRECISION,
    "transferTime" TIMESTAMP(3),
    "transferVolume" DOUBLE PRECISION,
    "cipStartTime" TIMESTAMP(3),
    "cipEndTime" TIMESTAMP(3),
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PFBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PFDosing" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "chemicalName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "rate" DOUBLE PRECISION,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PFDosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PFLabReading" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "spGravity" DOUBLE PRECISION,
    "ph" DOUBLE PRECISION,
    "rs" DOUBLE PRECISION,
    "rst" DOUBLE PRECISION,
    "alcohol" DOUBLE PRECISION,
    "ds" DOUBLE PRECISION,
    "vfaPpa" DOUBLE PRECISION,
    "temp" DOUBLE PRECISION,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PFLabReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreFermentationEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "batchNo" INTEGER NOT NULL DEFAULT 0,
    "fermenterNo" INTEGER NOT NULL DEFAULT 1,
    "spGravity" DOUBLE PRECISION,
    "ph" DOUBLE PRECISION,
    "rs" DOUBLE PRECISION,
    "rst" DOUBLE PRECISION,
    "alcohol" DOUBLE PRECISION,
    "ds" DOUBLE PRECISION,
    "vfaPpa" DOUBLE PRECISION,
    "temp" DOUBLE PRECISION,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PreFermentationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FermentationEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "batchNo" INTEGER NOT NULL DEFAULT 0,
    "fermenterNo" INTEGER NOT NULL DEFAULT 1,
    "level" DOUBLE PRECISION,
    "spGravity" DOUBLE PRECISION,
    "ph" DOUBLE PRECISION,
    "rs" DOUBLE PRECISION,
    "rst" DOUBLE PRECISION,
    "alcohol" DOUBLE PRECISION,
    "ds" DOUBLE PRECISION,
    "vfaPpa" DOUBLE PRECISION,
    "temp" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'U/F',
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FermentationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FermentationBatch" (
    "id" TEXT NOT NULL,
    "batchNo" INTEGER NOT NULL,
    "fermenterNo" INTEGER NOT NULL DEFAULT 1,
    "phase" TEXT NOT NULL DEFAULT 'FILLING',
    "fillingStartTime" TIMESTAMP(3),
    "fillingEndTime" TIMESTAMP(3),
    "setupEndTime" TIMESTAMP(3),
    "reactionStartTime" TIMESTAMP(3),
    "retentionStartTime" TIMESTAMP(3),
    "transferTime" TIMESTAMP(3),
    "cipStartTime" TIMESTAMP(3),
    "cipEndTime" TIMESTAMP(3),
    "setupTime" TEXT,
    "setupDate" TIMESTAMP(3),
    "setupGravity" DOUBLE PRECISION,
    "setupRs" DOUBLE PRECISION,
    "setupRst" DOUBLE PRECISION,
    "fermLevel" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "transferVolume" DOUBLE PRECISION,
    "beerWellNo" INTEGER,
    "finalDate" TIMESTAMP(3),
    "finalRsGravity" DOUBLE PRECISION,
    "totalHours" DOUBLE PRECISION,
    "yeast" TEXT,
    "enzyme" TEXT,
    "formolin" TEXT,
    "booster" TEXT,
    "urea" TEXT,
    "finalAlcohol" DOUBLE PRECISION,
    "remarks" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FermentationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FermChemical" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FermChemical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FermDosing" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "chemicalName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "level" DOUBLE PRECISION,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FermDosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistillationEntry" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "analysisTime" TEXT NOT NULL DEFAULT '',
    "batchNo" INTEGER,
    "spentWashLoss" DOUBLE PRECISION,
    "rcLessLoss" DOUBLE PRECISION,
    "ethanolStrength" DOUBLE PRECISION,
    "rcReflexStrength" DOUBLE PRECISION,
    "regenerationStrength" DOUBLE PRECISION,
    "evaporationSpgr" DOUBLE PRECISION,
    "remark" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DistillationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DailyEntry_date_yearStart_key" ON "DailyEntry"("date", "yearStart");

-- CreateIndex
CREATE UNIQUE INDEX "TankDip_date_yearStart_key" ON "TankDip"("date", "yearStart");

-- CreateIndex
CREATE UNIQUE INDEX "PFChemical_name_key" ON "PFChemical"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FermentationBatch_batchNo_fermenterNo_key" ON "FermentationBatch"("batchNo", "fermenterNo");

-- CreateIndex
CREATE UNIQUE INDEX "FermChemical_name_key" ON "FermChemical"("name");

-- AddForeignKey
ALTER TABLE "GrainEntry" ADD CONSTRAINT "GrainEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PFDosing" ADD CONSTRAINT "PFDosing_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PFBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PFLabReading" ADD CONSTRAINT "PFLabReading_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PFBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FermDosing" ADD CONSTRAINT "FermDosing_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FermentationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
