// src/modules/requests/requests.service.ts
import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { newId } from "../../utils/ids.js";

type DispatchCandidate = {
  id: string;
  coverageKm: number;
  lat: number;
  lng: number;
};

function toRad(x: number) {
  return (x * Math.PI) / 180;
}

// Haversine distance in KM
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371; // Earth radius km
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);

  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);

  const aa =
    s1 * s1 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;

  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

export async function dispatchOneByOne(
  requestId: string,
  attemptedVendorIds: string[] = []
) {
  const req = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      city: true,
      lat: true,
      lng: true,
      status: true,
    },
  });

  if (!req) return;

  // If already accepted/completed etc, don't dispatch again
  if (["ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELED"].includes(req.status)) {
    return;
  }

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "DISPATCHING" },
  });

  // Pull eligible vendors (basic filters) from DB
  const raw = await prisma.vendorProfile.findMany({
    where: {
      kycStatus: "APPROVED",
      isOnline: true,
      city: req.city,
      lat: { not: null },
      lng: { not: null },
      ...(attemptedVendorIds.length
        ? { id: { notIn: attemptedVendorIds } }
        : {}),
    },
    select: { id: true, coverageKm: true, lat: true, lng: true },
    take: 80,
    orderBy: { updatedAt: "desc" },
  });

  // Prisma returns lat/lng as number | null due to schema optional -> filter + cast safely
  const candidates: DispatchCandidate[] = raw
    .filter((v) => typeof v.lat === "number" && typeof v.lng === "number")
    .map((v) => ({
      id: v.id,
      coverageKm: v.coverageKm,
      lat: v.lat as number,
      lng: v.lng as number,
    }));

  if (!candidates.length) {
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "EXPIRED" },
    });
    return;
  }

  // Compute distances, and keep only vendors within their coverage radius
  const ranked = candidates
    .map((v) => {
      const km = distanceKm(req.lat, req.lng, v.lat, v.lng);
      return { ...v, km };
    })
    .filter((v) => v.km <= v.coverageKm)
    .sort((a, b) => a.km - b.km);

  if (!ranked.length) {
    // Nobody covers the user's location
    await prisma.request.update({
      where: { id: requestId },
      data: { status: "EXPIRED" },
    });
    return;
  }

  // Pick closest
  const first = ranked[0];
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
