import { prisma } from "../../prisma.js";
import { env } from "../../env.js";

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

type DispatchCandidate = {
  id: string;
  coverageKm: number;
  lat: number;
  lng: number;
};

export async function dispatchOneByOne(requestId: string) {
  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "DISPATCHING" },
  });

  // Pull eligible vendors (MVP)
  const raw = await prisma.vendorProfile.findMany({
    where: {
      kycStatus: "APPROVED",
      isOnline: true,
      city: req.city,
      lat: { not: null },
      lng: { not: null },
    },
    select: { id: true, coverageKm: true, lat: true, lng: true, updatedAt: true },
    take: 50,
    orderBy: { updatedAt: "desc" },
  });

  const candidates: DispatchCandidate[] = raw
    .filter((v) => typeof v.lat === "number" && typeof v.lng === "number")
    .map((v) => ({
      id: v.id,
      coverageKm: v.coverageKm,
      lat: v.lat as number,
      lng: v.lng as number,
    }))
    // within vendor radius
    .filter((v) => haversineKm(req.lat, req.lng, v.lat, v.lng) <= v.coverageKm)
    // sort nearest first
    .sort(
      (a, b) =>
        haversineKm(req.lat, req.lng, a.lat, a.lng) -
        haversineKm(req.lat, req.lng, b.lat, b.lng)
    );

  if (!candidates.length) {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "EXPIRED" },
    });
    return;
  }

  // Offer to first vendor only (one-by-one)
  const first = candidates[0];
  const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

  await prisma.dispatchOffer.create({
    data: {
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
