import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { HttpError } from "../../utils/http.js";
import { SearchBookingSchema, CreateQuoteSchema, CheckoutBookingSchema } from "./booking.validators.js";
import { searchLocalListings, createLocalQuote, checkoutQuote } from "./booking.service.js";

export function bookingRoutes() {
  const r = Router();

  // SEARCH (local inventory for MVP)
  r.post("/search", authMiddleware, async (req: any, res, next) => {
    try {
      const input = SearchBookingSchema.parse(req.body);

      // MVP: LOCAL inventory only for HALL & CAR
      if (input.kind === "FLIGHT" || input.kind === "HOTEL") {
        throw new HttpError(501, "Flights/Hotels provider integration coming next");
      }

      const listings = await searchLocalListings({
        kind: input.kind,
        city: input.city,
        startAt: input.startAt,
        endAt: input.endAt,
      });

      res.json({ ok: true, listings });
    } catch (e) {
      next(e);
    }
  });

  // QUOTE (price lock)
  r.post("/quote", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = CreateQuoteSchema.parse(req.body);

      if (!input.listingId) throw new HttpError(400, "listingId is required for LOCAL booking quote");

      const quote = await createLocalQuote({
        userId: req.user.id,
        kind: input.kind,
        listingId: input.listingId,
        startAt: input.startAt,
        endAt: input.endAt,
        notes: input.notes,
      });

      res.json({ ok: true, quote });
    } catch (e) {
      next(e);
    }
  });

  // CHECKOUT
  r.post("/checkout", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = CheckoutBookingSchema.parse(req.body);

      const order = await checkoutQuote({
        userId: req.user.id,
        quoteId: input.quoteId,
        paymentMethod: input.paymentMethod,
      });

      res.json({ ok: true, order });
    } catch (e) {
      next(e);
    }
  });

  // MY ORDERS
  r.get("/orders/me", authMiddleware, async (req: any, res, next) => {
    try {
      const rows = await req.prisma.bookingOrder.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { listing: true },
      });

      res.json({ ok: true, orders: rows });
    } catch (e) {
      next(e);
    }
  });

  // ORDER BY ID
  r.get("/orders/:id", authMiddleware, async (req: any, res, next) => {
    try {
      const id = req.params.id;

      const order = await req.prisma.bookingOrder.findUnique({
        where: { id },
        include: { listing: true, quote: true },
      });

      if (!order) throw new HttpError(404, "Order not found");
      if (order.userId !== req.user.id) throw new HttpError(403, "Forbidden");

      res.json({ ok: true, order });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
