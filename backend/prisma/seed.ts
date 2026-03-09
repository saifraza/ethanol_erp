import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash('admin123', 10);
  const operatorPassword = await bcrypt.hash('operator123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@distillery.com' },
    update: {},
    create: {
      email: 'admin@distillery.com',
      password: adminPassword,
      name: 'Admin User',
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'operator@distillery.com' },
    update: {},
    create: {
      email: 'operator@distillery.com',
      password: operatorPassword,
      name: 'Operator User',
      role: 'OPERATOR',
    },
  });

  console.log('Seed completed');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
