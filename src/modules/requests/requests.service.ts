import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { newId } from "../../utils/ids.js";

type DispatchCandidate = {
  id: string;
  coverageKm: number;
  lat: number | null;
  lng: number | null;
};

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

export async function dispatchOneByOne(requestId: string, attemptedVendorIds: string[] = []) {
  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "DISPATCHING" },
  });

  // 1) pull eligible vendors from DB (filter out attempted in Prisma)
  const candidates = (await prisma.vendorProfile.findMany({
    where: {
      kycStatus: "APPROVED",
      isOnline: true,
      city: req.city,
      id: attemptedVendorIds.length ? { notIn: attemptedVendorIds } : undefined,
      // if you added geo fields:
      lat: { not: null },
      lng: { not: null },
    },
    select: { id: true, coverageKm: true, lat: true, lng: true },
    take: 50,
    orderBy: { updatedAt: "desc" },
  })) as DispatchCandidate[];

  // 2) distance filter + sort by nearest
  const eligible = candidates
    .map((v) => {
      if (v.lat == null || v.lng == null) return null;
      const d = haversineKm(req.lat, req.lng, v.lat, v.lng);
      return { ...v, distanceKm: d };
    })
    .filter((x): x is DispatchCandidate & { distanceKm: number } => !!x)
    .filter((v) => v.distanceKm <= (v.coverageKm ?? 10))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  if (!eligible.length) {
    await prisma.request.update({ where: { id: requestId }, data: { status: "EXPIRED" } });
    return;
  }

  const first = eligible[0];
  const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

  await prisma.dispatchOffer.create({
    data: {
      id: newId("off"),
      requestId,
      vendorId: first.id,
      status: "PENDING",
      expiresAt,
    },
  });

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "OFFERED" },
  });
}
