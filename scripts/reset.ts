import "dotenv/config";

import { prisma } from "../src/prisma.ts";

async function main() {
  const startTime = performance.now();

  await prisma.instrument.deleteMany();
  await prisma.bar.deleteMany();
  await prisma.ingestion.deleteMany();

  const endTime = performance.now();
  const time = Math.round(endTime - startTime);

  console.log(`Reset took ${time}ms`);
}

main()
  .catch((error) => {
    console.error("Reset failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  })
