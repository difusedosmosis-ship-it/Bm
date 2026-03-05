import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../prisma.js";
import { newId } from "../../utils/ids.js";
import { HttpError } from "../../utils/http.js";
import { CreateRequestSchema } from "./requests.validators.js";
import { dispatchOneByOne } from "./requests.service.js";
import { env } from "../../env.js";
import { notifyUser, notifyVendor } from "../../realtime/ws.js";

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

      // Notify consumer immediately (request created)
      notifyUser(request.consumerId, "request_update", { request });

      if (input.mode === "CHOOSE") {
        if (!input.vendorId) throw new HttpError(400, "vendorId required for CHOOSE mode");

        const vendor = await prisma.vendorProfile.findUnique({ where: { id: input.vendorId } });
        if (!vendor || vendor.kycStatus !== "APPROVED") throw new HttpError(400, "Vendor not eligible");

        const expiresAt = new Date(Date.now() + env.OFFER_EXPIRES_SECONDS * 1000);

        const offer = await prisma.dispatchOffer.create({
          data: {
            id: newId("off"),
            requestId: request.id,
            vendorId: vendor.id,
            status: "PENDING",
            expiresAt,
          },
          include: { request: true },
        });

        await prisma.request.update({
          where: { id: request.id },
          data: { status: "OFFERED" },
        });

        // Real-time: send offer to vendor
        notifyVendor(vendor.id, "offer", { offer });
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
  // =========================================================

  // -----------------------------
  // Vendor checks their latest pending offer
  // + MVP auto-expire: if latest offer is expired, mark it expired and dispatch next
  // -----------------------------
  r.get("/vendor/my-offer/latest", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      // Find latest offer (including expired) to allow auto-expire progression
      const latest = await prisma.dispatchOffer.findFirst({
        where: { vendorId: vendor.id },
        orderBy: { createdAt: "desc" },
        include: { request: true },
      });

      // If the latest is pending but expired, expire it and dispatch next vendor
      if (latest && latest.status === "PENDING" && latest.expiresAt <= new Date()) {
        await prisma.dispatchOffer.update({
          where: { id: latest.id },
          data: { status: "EXPIRED" },
        });

        // Continue dispatch (safe no-op if request already accepted/canceled)
        await dispatchOneByOne(latest.requestId);
      }

      // Return a fresh pending offer (not expired)
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
  // + realtime updates to vendor + consumer
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
        await prisma.dispatchOffer.update({ where: { id: offerId }, data: { status: "EXPIRED" } });
        // Continue dispatch to next vendor
        await dispatchOneByOne(offer.requestId);
        throw new HttpError(400, "Offer expired");
      }

      const updatedRequest = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.request.findUnique({ where: { id: offer.requestId } });
        if (!reqRow) throw new HttpError(404, "Request not found");
        if (["CANCELED", "EXPIRED", "COMPLETED"].includes(reqRow.status)) {
          throw new HttpError(400, `Request is ${reqRow.status}`);
        }
        if (reqRow.acceptedVendorId) throw new HttpError(409, "Request already accepted");

        await tx.dispatchOffer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });

        const updated = await tx.request.update({
          where: { id: offer.requestId },
          data: {
            status: "ACCEPTED",
            acceptedVendorId: vendor.id,
            acceptedAt: new Date(),
          },
        });

        await tx.dispatchOffer.updateMany({
          where: { requestId: offer.requestId, id: { not: offerId }, status: "PENDING" },
          data: { status: "EXPIRED" },
        });

        return updated;
      });

      // Real-time status updates
      notifyUser(updatedRequest.consumerId, "request_update", { request: updatedRequest });
      notifyVendor(vendor.id, "request_update", { request: updatedRequest });

      res.json({ ok: true, request: updatedRequest });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Vendor declines offer (then dispatch next vendor)
  // + realtime updates
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

      const reqRow = await prisma.request.findUnique({ where: { id: offer.requestId } });
      if (reqRow) {
        notifyUser(reqRow.consumerId, "request_update", { request: reqRow });
        notifyVendor(vendor.id, "request_update", { request: reqRow });
      }

      await dispatchOneByOne(offer.requestId);

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Vendor starts job
  // -----------------------------
  r.post("/:id/start", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const id = req.params.id;

      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const row = await prisma.request.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, "Request not found");
      if (row.acceptedVendorId !== vendor.id) throw new HttpError(403, "Not your job");
      if (row.status !== "ACCEPTED") throw new HttpError(400, "Request not in ACCEPTED state");

      const updated = await prisma.request.update({
        where: { id },
        data: { status: "IN_PROGRESS" },
      });

      notifyUser(updated.consumerId, "request_update", { request: updated });
      notifyVendor(vendor.id, "request_update", { request: updated });

      res.json({ ok: true, request: updated });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Vendor completes job
  // -----------------------------
  r.post("/:id/complete", authMiddleware, requireRole("VENDOR"), async (req: any, res, next) => {
    try {
      const id = req.params.id;

      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const row = await prisma.request.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, "Request not found");
      if (row.acceptedVendorId !== vendor.id) throw new HttpError(403, "Not your job");
      if (row.status !== "IN_PROGRESS") throw new HttpError(400, "Request not in progress");

      const updated = await prisma.request.update({
        where: { id },
        data: { status: "COMPLETED" },
      });

      notifyUser(updated.consumerId, "request_update", { request: updated });
      notifyVendor(vendor.id, "request_update", { request: updated });

      res.json({ ok: true, request: updated });
    } catch (e) {
      next(e);
    }
  });

  // -----------------------------
  // Consumer cancels request
  // -----------------------------
  r.post("/:id/cancel", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const id = req.params.id;

      const row = await prisma.request.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, "Request not found");
      if (row.consumerId !== req.user.id) throw new HttpError(403, "Not your request");
      if (["COMPLETED", "CANCELED", "EXPIRED"].includes(row.status)) throw new HttpError(400, "Cannot cancel");

      const updated = await prisma.request.update({
        where: { id },
        data: { status: "CANCELED" },
      });

      notifyUser(updated.consumerId, "request_update", { request: updated });
      if (updated.acceptedVendorId) notifyVendor(updated.acceptedVendorId, "request_update", { request: updated });

      res.json({ ok: true, request: updated });
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
}      if (input.mode === "CHOOSE") {
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
