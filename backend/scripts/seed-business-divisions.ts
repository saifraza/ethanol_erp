// Seed MSPIL business divisions + their common departments.
// Safe to re-run: uses upsert on BusinessDivision, findFirst + create for Department,
// and only attaches businessDivisionId when the department row has no division yet.
//
// Run:  cd backend && npx tsx scripts/seed-business-divisions.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DIVISIONS: Array<{
  name: string;
  code: string;
  description: string;
  departments: Array<{ name: string; code?: string }>;
}> = [
  {
    name: 'Ethanol',
    code: 'ETH',
    description: '60 KLPD grain-based distillery — fermentation to ethanol dispatch',
    departments: [
      { name: 'Grain Handling', code: 'ETH-GRN' },
      { name: 'Milling', code: 'ETH-MIL' },
      { name: 'Liquefaction', code: 'ETH-LIQ' },
      { name: 'Fermentation', code: 'ETH-FER' },
      { name: 'Distillation', code: 'ETH-DIS' },
      { name: 'Decanter & Dryer (DDGS)', code: 'ETH-DDG' },
      { name: 'Evaporation', code: 'ETH-EVP' },
      { name: 'Ethanol Storage & Dispatch', code: 'ETH-STR' },
      { name: 'Process Lab (QC)', code: 'ETH-QC' },
      { name: 'Utilities', code: 'ETH-UTI' },
    ],
  },
  {
    name: 'Sugar',
    code: 'SUG',
    description: 'Sugar plant — cane handling to sugar dispatch',
    departments: [
      { name: 'Cane Yard', code: 'SUG-CYD' },
      { name: 'Cane Prep (Knives/Shredder)', code: 'SUG-CPR' },
      { name: 'Milling', code: 'SUG-MIL' },
      { name: 'Juice Clarification', code: 'SUG-CLR' },
      { name: 'Evaporation', code: 'SUG-EVP' },
      { name: 'Pan Boiling', code: 'SUG-PAN' },
      { name: 'Centrifugal', code: 'SUG-CEN' },
      { name: 'Sugar Godown & Dispatch', code: 'SUG-GDN' },
      { name: 'Sugar Lab (QC)', code: 'SUG-QC' },
      { name: 'Molasses Storage', code: 'SUG-MOL' },
    ],
  },
  {
    name: 'Power',
    code: 'PWR',
    description: 'Co-gen captive power plant — boiler & turbine',
    departments: [
      { name: 'Bagasse / Fuel Yard', code: 'PWR-FUL' },
      { name: 'Boiler', code: 'PWR-BLR' },
      { name: 'Turbine', code: 'PWR-TBN' },
      { name: 'Water Treatment (DM/RO)', code: 'PWR-WTR' },
      { name: 'Cooling Tower', code: 'PWR-CLT' },
      { name: 'Switchyard / HT', code: 'PWR-SWY' },
      { name: 'Power Lab (QC)', code: 'PWR-QC' },
      { name: 'Ash Handling', code: 'PWR-ASH' },
    ],
  },
];

// Common service departments — not tied to any business division
const COMMON_DEPTS: Array<{ name: string; code?: string }> = [
  { name: 'Mechanical Maintenance', code: 'MECH' },
  { name: 'Electrical Maintenance', code: 'ELEC' },
  { name: 'Instrumentation', code: 'INST' },
  { name: 'Stores', code: 'STR' },
  { name: 'Purchase', code: 'PUR' },
  { name: 'Accounts', code: 'ACC' },
  { name: 'HR & Admin', code: 'HR' },
  { name: 'Safety & Environment', code: 'SHE' },
  { name: 'Weighbridge', code: 'WB' },
  { name: 'IT & Automation', code: 'IT' },
];

async function main() {
  console.log('[seed] Business Divisions + Departments');
  let createdDiv = 0, createdDept = 0, linkedDept = 0;

  for (const d of DIVISIONS) {
    // upsert by (name, companyId=null) — MSPIL default
    let division = await prisma.businessDivision.findFirst({
      where: { name: d.name, companyId: null },
    });
    if (!division) {
      division = await prisma.businessDivision.create({
        data: { name: d.name, code: d.code, description: d.description, companyId: null },
      });
      createdDiv++;
      console.log(`  + Division: ${d.name} (${d.code})`);
    } else {
      // Update code/description if missing
      if (!division.code || !division.description) {
        division = await prisma.businessDivision.update({
          where: { id: division.id },
          data: { code: division.code || d.code, description: division.description || d.description },
        });
      }
    }

    for (const dept of d.departments) {
      const existing = await prisma.department.findFirst({ where: { name: dept.name } });
      if (!existing) {
        await prisma.department.create({
          data: { name: dept.name, code: dept.code ?? null, businessDivisionId: division.id, companyId: null },
        });
        createdDept++;
        console.log(`    + Dept: ${dept.name} → ${d.name}`);
      } else if (!existing.businessDivisionId) {
        await prisma.department.update({
          where: { id: existing.id },
          data: { businessDivisionId: division.id, code: existing.code || dept.code || null },
        });
        linkedDept++;
        console.log(`    ~ Linked existing dept: ${dept.name} → ${d.name}`);
      }
    }
  }

  for (const dept of COMMON_DEPTS) {
    const existing = await prisma.department.findFirst({ where: { name: dept.name } });
    if (!existing) {
      await prisma.department.create({
        data: { name: dept.name, code: dept.code ?? null, companyId: null },
      });
      createdDept++;
      console.log(`  + Common dept: ${dept.name}`);
    }
  }

  console.log(`\n[seed] Done. Divisions created: ${createdDiv}, Depts created: ${createdDept}, Depts linked: ${linkedDept}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
