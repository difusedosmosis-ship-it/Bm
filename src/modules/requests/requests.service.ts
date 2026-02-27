import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { newId } from "../../utils/ids.js";

export async function dispatchOneByOne(requestId: string) {
  // For MVP: pick eligible vendors: KYC approved + online + same city
  // Later: sort by distance + rating + paid tier, etc.
  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "DISPATCHING" }
  });

  const vendors = await prisma.vendorProfile.findMany({
    where: {
      kycStatus: "APPROVED",
      isOnline: true,
      city: req.city
    },
    take: 10,
    orderBy: { updatedAt: "desc" }
  });

  if (!vendors.length) {
    await prisma.request.update({ where: { id: requestId }, data: { status: "EXPIRED" } });
    return;
  }

  // Create first offer (one-by-one)
  const first = vendors[0];
  const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

  await prisma.dispatchOffer.create({
    data: {
      id: newId("off"),
      requestId,
      vendorId: first.id,
      status: "PENDING",
      expiresAt
    }
  });

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "OFFERED" }
  });

  // NOTE:
  // Cascading is handled by endpoint /requests/:id/expire-offer (called by cron/websocket later)
}
