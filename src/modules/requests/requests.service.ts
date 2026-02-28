import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { newId } from "../../utils/ids.js";

type EligibleVendorRow = { id: string };

/**
 * One-by-one dispatch:
 * - picks nearest eligible vendor within vendor.coverageKm
 * - skips vendors already offered/declined/expired for this request
 * - creates ONE new PENDING offer
 *
 * Safe to call multiple times (decline/expire triggers call again).
 */
export async function dispatchOneByOne(requestId: string) {
  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;

  // If already accepted/canceled/completed, do nothing
  if (
    req.status === "ACCEPTED" ||
    req.status === "IN_PROGRESS" ||
    req.status === "COMPLETED" ||
    req.status === "CANCELED"
  ) {
    return;
  }

  // Mark dispatching (idempotent-ish)
  await prisma.request.update({
    where: { id: requestId },
    data: { status: "DISPATCHING" },
  });

  // Vendors already attempted for this request (any status)
  const attempted = await prisma.dispatchOffer.findMany({
    where: { requestId },
    select: { vendorId: true },
  });
  const attemptedVendorIds = attempted.map((x) => x.vendorId);

  // If request has no location, we can't do geo. Expire.
  if (req.lat == null || req.lng == null) {
    await prisma.request.update({ where: { id: requestId }, data: { status: "EXPIRED" } });
    return;
  }

  /**
   * PostGIS query:
   * - only APPROVED + online + same city
   * - vendor must have lat/lng
   * - within coverage radius (coverageKm)
   * - skip already-attempted vendors
   * - order by nearest first
   *
   * Uses ST_DWithin on geography for meters accuracy.
   */
  const rows = await prisma.$queryRaw<EligibleVendorRow[]>`
    SELECT v.id
    FROM "VendorProfile" v
    WHERE v."kycStatus" = 'APPROVED'
      AND v."isOnline" = true
      AND v."city" = ${req.city}
      AND v."lat" IS NOT NULL
      AND v."lng" IS NOT NULL
      AND (
        ${attemptedVendorIds.length} = 0
        OR v.id NOT IN (${prisma.join(attemptedVendorIds)})
      )
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(v."lng", v."lat"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${req.lng}, ${req.lat}), 4326)::geography,
        (v."coverageKm" * 1000)::double precision
      )
    ORDER BY
      ST_Distance(
        ST_SetSRID(ST_MakePoint(v."lng", v."lat"), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${req.lng}, ${req.lat}), 4326)::geography
      ) ASC
    LIMIT 1
  `;

  if (!rows.length) {
    await prisma.request.update({ where: { id: requestId }, data: { status: "EXPIRED" } });
    return;
  }

  const vendorId = rows[0].id;
  const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

  // Create ONE offer
  await prisma.dispatchOffer.create({
    data: {
      id: newId("off"),
      requestId,
      vendorId,
      status: "PENDING",
      expiresAt,
    },
  });

  await prisma.request.update({
    where: { id: requestId },
    data: { status: "OFFERED" },
  });
}
