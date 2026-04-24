import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const rows: any[] = await p.$queryRawUnsafe(`
    SELECT "whatsappEnabled", "whatsappWorkerUrl", "whatsappGroupJid",
           "whatsappGroup2Jid", "whatsappPrivatePhones", "whatsappModuleRouting"
    FROM "Settings"
  `);
  console.log(JSON.stringify(rows, null, 2));
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
