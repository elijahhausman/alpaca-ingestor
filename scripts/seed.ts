import "dotenv/config";

import { prisma } from "../src/prisma.ts";

const instruments = [
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    description: "Apple Inc. designs, manufactures, and markets consumer hardware, cloud servies, and software worldwide.",
    exchange: "NASDAQ",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    description: "Microsoft Corporation develops and supports enterprise cloud software (Azure), consumer hardware, games and entertainment, and more.",
    exchange: "NASDAQ",
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    description: "The State Street SPDR S&P 500 ETF (SPY) is an exchange-traded fund that is based on the S&P 500 index.",
    exchange: "ARCA",
  },
];

async function main() {
  const startTime = performance.now();

  await prisma.instrument.deleteMany();
  await prisma.instrument.createMany({
    data: instruments,
  });

  const endTime = performance.now();
  const time = Math.round(endTime - startTime);

  console.log(`Seeding took ${time}ms`);
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  })
