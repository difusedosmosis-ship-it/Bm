import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Categories
  const categories = [
    "Plumbing",
    "Electrical",
    "Generator Repair",
    "AC Repair",
    "Cleaning",
    "Vulcanizer",
    "Logistics",
    "Gadget Repair"
  ];

  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  // Consumer
  const consumer = await prisma.user.upsert({
    where: { email: "consumer@test.com" },
    update: {},
    create: {
      role: Role.CONSUMER,
      email: "consumer@test.com",
      fullName: "Test Consumer"
    }
  });

  // Vendor
  const vendorUser = await prisma.user.upsert({
    where: { email: "vendor@test.com" },
    update: {},
    create: {
      role: Role.VENDOR,
      email: "vendor@test.com",
      fullName: "Chidi Okafor"
    }
  });

  const vendorProfile = await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    update: {},
    create: {
      userId: vendorUser.id,
      businessName: "ChidiTech Electricals",
      city: "Lagos",
      isOnline: true
    }
  });

  const electricalCategory = await prisma.category.findFirst({
    where: { name: "Electrical" }
  });

  if (electricalCategory) {
    await prisma.vendorService.create({
      data: {
        vendorId: vendorProfile.id,
        categoryId: electricalCategory.id,
        title: "Home Electrical Wiring",
        priceFrom: 15000
      }
    });
  }

  console.log("✅ Seeding completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
