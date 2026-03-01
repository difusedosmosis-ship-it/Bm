import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { HttpError } from "../../utils/http.js";

import {
  CreateListingSchema,
  UpdateListingSchema,
  SearchBookingSchema,
  CreateQuoteSchema,
  ConfirmOrderSchema,
} from "./booking.validators.js";

import {
  createListing,
  updateListing,
  getListingById,
  listListings,
  searchListings,
  createQuote,
  confirmOrder,
  myOrders,
  orderById,
} from "./booking.service.js";

export function bookingRoutes() {
  const r = Router();

  /**
   * LISTINGS (create/update/publish)
   * For MVP: ADMIN manages inventory. Later: Vendors can manage their own listings too.
   */

  // Create listing (ADMIN for now)
  r.post("/listings", authMiddleware, requireRole("ADMIN"), async (req: any, res, next) => {
    try {
      const input = CreateListingSchema.parse(req.body);

      const row = await createListing({
        kind: input.kind,
        title: input.title,
        description: input.description,
        city: input.city,
        provider: input.provider,
        providerRef: input.providerRef,
        pricePerDay: input.pricePerDay,
        currency: input.currency,
        capacity: input.capacity,
        isActive: input.isActive ?? false,
      });

      res.json({ ok: true, listing: row });
    } catch (e) {
      next(e);
    }
  });

  // Update listing (ADMIN for now)
  r.patch("/listings/:id", authMiddleware, requireRole("ADMIN"), async (req: any, res, next) => {
    try {
      const id = req.params.id;
      const patch = UpdateListingSchema.parse(req.body);

      const row = await updateListing(id, patch);
      res.json({ ok: true, listing: row });
    } catch (e) {
      next(e);
    }
  });

  // Publish / Unpublish listing (ADMIN for now)
  r.post("/listings/:id/publish", authMiddleware, requireRole("ADMIN"), async (req: any, res, next) => {
    try {
      const id = req.params.id;
      const row = await updateListing(id, { isActive: true });
      res.json({ ok: true, listing: row });
    } catch (e) {
      next(e);
    }
  });

  r.post("/listings/:id/unpublish", authMiddleware, requireRole("ADMIN"), async (req: any, res, next) => {
    try {
      const id = req.params.id;
      const row = await updateListing(id, { isActive: false });
      res.json({ ok: true, listing: row });
    } catch (e) {
      next(e);
    }
  });

  // List listings (ADMIN can see all, consumers see only active)
  r.get("/listings", authMiddleware, async (req: any, res, next) => {
    try {
      const isAdmin = req.user?.role === "ADMIN";
      const limit = Math.min(Number(req.query.limit ?? 50), 50);

      const rows = await listListings({
        kind: req.query.kind,
        provider: req.query.provider,
        city: req.query.city,
        isActive: isAdmin ? (req.query.isActive === undefined ? undefined : req.query.isActive === "true") : true,
        limit,
      } as any);

      res.json({ ok: true, listings: rows });
    } catch (e) {
      next(e);
    }
  });

  // Listing by id (consumers can only access active; admin can access all)
  r.get("/listings/:id", authMiddleware, async (req: any, res, next) => {
    try {
      const row = await getListingById(req.params.id);
      const isAdmin = req.user?.role === "ADMIN";
      if (!isAdmin && !row.isActive) throw new HttpError(404, "Listing not found");
      res.json({ ok: true, listing: row });
    } catch (e) {
      next(e);
    }
  });

  /**
   * SEARCH
   * Goes through provider hooks. MVP: LOCAL only.
   */
  r.post("/search", authMiddleware, async (req: any, res, next) => {
    try {
      const input = SearchBookingSchema.parse(req.body);

      // MVP: force provider LOCAL for now
      const provider = "LOCAL";

      // If you want: block hotels/flights until external provider is implemented
      if (input.kind === "FLIGHT" || input.kind === "HOTEL") {
        throw new HttpError(501, "Flights/Hotels provider integration coming next");
      }

      const listings = await searchListings({
        provider,
        kind: input.kind,
        city: input.city,
        startAt: input.startAt,
        endAt: input.endAt,
        limit: input.limit,
      });

      res.json({ ok: true, provider, listings });
    } catch (e) {
      next(e);
    }
  });

  /**
   * QUOTE (time-bound price lock)
   */
  r.post("/quote", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = CreateQuoteSchema.parse(req.body);

      // MVP: LOCAL only
      const provider = input.provider ?? "LOCAL";

      if (provider === "LOCAL" && !input.listingId) {
        throw new HttpError(400, "listingId is required for LOCAL quote");
      }

      const quote = await createQuote({
        userId: req.user.id,
        provider,
        kind: input.kind,
        listingId: input.listingId,
        startAt: input.startAt,
        endAt: input.endAt,
        quantity: input.quantity,
        notes: input.notes,
        providerPayload: input.providerPayload,
      });

      res.json({ ok: true, quote });
    } catch (e) {
      next(e);
    }
  });

  /**
   * ORDER (confirm booking)
   */
  r.post("/order/confirm", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = ConfirmOrderSchema.parse(req.body);

      const order = await confirmOrder({
        userId: req.user.id,
        quoteId: input.quoteId,
        paymentMethod: input.paymentMethod,
      });

      res.json({ ok: true, order });
    } catch (e) {
      next(e);
    }
  });

  /**
   * MY ORDERS (consumer)
   */
  r.get("/orders/me", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const orders = await myOrders(req.user.id);
      res.json({ ok: true, orders });
    } catch (e) {
      next(e);
    }
  });

  r.get("/orders/:id", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const order = await orderById(req.user.id, req.params.id);
      res.json({ ok: true, order });
    } catch (e) {
      next(e);
    }
  });

  /**
   * PROVIDER HOOKS (for Duffel/Amadeus/Hotels later)
   * - Webhooks: external providers can notify booking status, ticketing, cancellations, etc.
   * Keep endpoint now; implement later.
   */
  r.post("/providers/:provider/webhook", async (req: any, res) => {
    // For now: acknowledge to avoid provider retries while you build.
    // Later: validate signature, update BookingOrder/BookingQuote status, etc.
    res.json({ ok: true });
  });

  return r;
}
