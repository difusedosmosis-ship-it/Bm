import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../prisma.js";
import { newId } from "../../utils/ids.js";
import { HttpError } from "../../utils/http.js";
import { CreateRequestSchema } from "./requests.validators.js";
import { dispatchOneByOne } from "./requests.service.js";
import { env } from "../../env.js";

export function requestsRoutes() {
  const r = Router();

  // -----------------------------
  // Consumer creates request
  // -----------------------------
  r.post("/", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = CreateRequestSchema.parse(req.body);

      const request = await prisma.request.create({
        data: {
          id: newId("req"),
          consumerId: req.user.id,
          mode: input.mode,
          city: input.city,
          category: input.category,
          description: input.description,
          urgency: input.urgency,
          lat: input.lat,
          lng: input.lng,
          chosenVendorId: input.mode === "CHOOSE" ? (input.vendorId ?? null) : null,
          status: input.mode === "CHOOSE" ? "OFFERED" : "DISPATCHING",
        },
      });

      if (input.mode === "CHOOSE") {
        if (!input.vendorId) throw new HttpError(400, "vendorId required for CHOOSE mode");

        const vendor = await prisma.vendorProfile.findUnique({ where: { id: input.vendorId } });
        if (!vendor || vendor.kycStatus !== "APPROVED") throw new HttpError(400, "Vendor not eligible");

        const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

        await prisma.dispatchOffer.create({
          data: {
            id: newId("off"),
            requestId: request.id,
            vendorId: vendor.id,
            status: "PENDING",
            expiresAt,
          },
        });

        await prisma.request.update({
          where: { id: request.id },
          data: { status: "OFFERED" },
        });
      } else {
        // MATCHED dispatch
        await dispatchOneByOne(request.id);
      }

      res.json({ ok: true, id: request.id });
    } catch (e) {
      next(e);
    }
  });

  // =========================================================
  // IMPORTANT: put vendor routes BEFORE "/:id" route
  // because "/:id" will match "/vendor/..." if placed above.
  // =========================================================

  // -----------------------------
  // Vendor checks their latest pending offer
  // -----------------------------
  r.get("/vendor/my-offer/latest", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const offer = await prisma.dispatchOffer.findFirst({
        where: {
          vendorId: vendor.id,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        include: { request: true },
      });

      res.json({ ok: true, offer });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Vendor accepts offer (transaction + lock-safe)
  // -----------------------------
  r.post("/offers/:offerId/accept", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const offerId = req.params.offerId;

      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const offer = await prisma.dispatchOffer.findUnique({ where: { id: offerId } });
      if (!offer) throw new HttpError(404, "Offer not found");
      if (offer.vendorId !== vendor.id) throw new HttpError(403, "Not your offer");
      if (offer.status !== "PENDING") throw new HttpError(400, "Offer not pending");
      if (offer.expiresAt <= new Date()) {
        // Mark expired and stop
        await prisma.dispatchOffer.update({ where: { id: offerId }, data: { status: "EXPIRED" } });
        throw new HttpError(400, "Offer expired");
      }

      await prisma.$transaction(async (tx) => {
        const reqRow = await tx.request.findUnique({ where: { id: offer.requestId } });
        if (!reqRow) throw new HttpError(404, "Request not found");
        if (reqRow.acceptedVendorId) throw new HttpError(409, "Request already accepted");

        await tx.dispatchOffer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });

        await tx.request.update({
          where: { id: offer.requestId },
          data: {
            status: "ACCEPTED",
            acceptedVendorId: vendor.id,
            acceptedAt: new Date(),
          },
        });

        // Mark all other pending offers for same request as expired
        await tx.dispatchOffer.updateMany({
          where: { requestId: offer.requestId, id: { not: offerId }, status: "PENDING" },
          data: { status: "EXPIRED" },
        });
      });

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Vendor declines offer (then dispatch next vendor)
  // -----------------------------
  r.post("/offers/:offerId/decline", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const offerId = req.params.offerId;

      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const offer = await prisma.dispatchOffer.findUnique({ where: { id: offerId } });
      if (!offer) throw new HttpError(404, "Offer not found");
      if (offer.vendorId !== vendor.id) throw new HttpError(403, "Not your offer");
      if (offer.status !== "PENDING") throw new HttpError(400, "Offer not pending");

      await prisma.dispatchOffer.update({ where: { id: offerId }, data: { status: "DECLINED" } });

      // Continue dispatch to next vendor (MATCHED flow)
      // If request already accepted/canceled, service should no-op safely.
      await dispatchOneByOne(offer.requestId);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Consumer or Vendor fetch request details
  // -----------------------------
  r.get("/:id", authMiddleware, async (req: any, res, next) => {
    try {
      const id = req.params.id;

      const row = await prisma.request.findUnique({
        where: { id },
        include: {
          offers: {
            include: { vendor: { include: { user: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!row) throw new HttpError(404, "Not found");
      res.json({ ok: true, request: row });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
