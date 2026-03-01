import { prisma } from "../../prisma.js";
import { HttpError } from "../../utils/http.js";
import { env } from "../../env.js";
import type { BookingKind, BookingProvider } from "@prisma/client";

function toDate(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "Invalid datetime");
  return d;
}

function daysBetween(startAt: Date, endAt: Date) {
  const ms = endAt.getTime() - startAt.getTime();
  if (ms <= 0) throw new HttpError(400, "endAt must be after startAt");
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// overlap rule: (aStart < bEnd) && (bStart < aEnd)
async function isListingAvailable(listingId: string, startAt: Date, endAt: Date) {
  const overlap = await prisma.bookingOrder.findFirst({
    where: {
      listingId,
      status: { in: ["CONFIRMED", "PENDING_PAYMENT"] },
      AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }],
    },
    select: { id: true },
  });
  return !overlap;
}

export type ProviderSearchInput = {
  kind: BookingKind;
  city?: string;
  startAt: string;
  endAt: string;
  limit: number;
};

export type ProviderQuoteInput = {
  userId: string;
  kind: BookingKind;
  startAt: string;
  endAt: string;
  quantity: number;

  listingId?: string; // LOCAL
  notes?: string;

  providerPayload?: Record<string, any>; // external providers later
};

export type ProviderCheckoutInput = {
  userId: string;
  quoteId: string;
  paymentMethod: "WALLET" | "CARD";
};

export interface BookingProviderImpl {
  name: BookingProvider;

  search(input: ProviderSearchInput): Promise<any[]>;
  quote(input: ProviderQuoteInput): Promise<any>;
  checkout(input: ProviderCheckoutInput): Promise<any>;
}

export const LocalProvider: BookingProviderImpl = {
  name: "LOCAL",

  async search(input) {
    const startAt = toDate(input.startAt);
    const endAt = toDate(input.endAt);

    const listings = await prisma.bookingListing.findMany({
      where: {
        provider: "LOCAL",
        kind: input.kind,
        isActive: true,
        ...(input.city ? { city: input.city } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
    });

    const available = [];
    for (const l of listings) {
      const ok = await isListingAvailable(l.id, startAt, endAt);
      if (ok) available.push(l);
    }
    return available;
  },

  async quote(args) {
    const startAt = toDate(args.startAt);
    const endAt = toDate(args.endAt);

    if (!args.listingId) throw new HttpError(400, "listingId is required for LOCAL quote");

    const listing = await prisma.bookingListing.findUnique({ where: { id: args.listingId } });
    if (!listing || !listing.isActive) throw new HttpError(404, "Listing not found");
    if (listing.provider !== "LOCAL") throw new HttpError(400, "Not a LOCAL listing");

    const ok = await isListingAvailable(listing.id, startAt, endAt);
    if (!ok) throw new HttpError(409, "Listing not available for those dates");

    const days = daysBetween(startAt, endAt);
    const qty = Math.max(1, args.quantity);
    const amount = listing.pricePerDay * days * qty;

    const expiresMinutes = Number(env.BOOKING_QUOTE_EXPIRES_MINUTES ?? 10);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    const quote = await prisma.bookingQuote.create({
      data: {
        kind: args.kind,
        provider: "LOCAL",
        listingId: listing.id,
        userId: args.userId,
        startAt,
        endAt,
        currency: listing.currency,
        amount,
        status: "ACTIVE",
        expiresAt,
        payload: {
          notes: args.notes ?? null,
          pricePerDay: listing.pricePerDay,
          days,
          quantity: qty,
        },
      },
    });

    return quote;
  },

  async checkout(args) {
    const quote = await prisma.bookingQuote.findUnique({ where: { id: args.quoteId } });
    if (!quote) throw new HttpError(404, "Quote not found");
    if (quote.userId && quote.userId !== args.userId) throw new HttpError(403, "Not your quote");
    if (quote.status !== "ACTIVE") throw new HttpError(400, "Quote not active");

    if (quote.expiresAt <= new Date()) {
      await prisma.bookingQuote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
      throw new HttpError(400, "Quote expired");
    }

    if (quote.provider !== "LOCAL") throw new HttpError(400, "Provider checkout not implemented yet");

    if (quote.listingId) {
      const ok = await isListingAvailable(quote.listingId, quote.startAt, quote.endAt);
      if (!ok) throw new HttpError(409, "Listing no longer available");
    }

    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.bookingOrder.create({
        data: {
          kind: quote.kind,
          provider: quote.provider,
          userId: args.userId,
          listingId: quote.listingId,
          quoteId: quote.id,
          startAt: quote.startAt,
          endAt: quote.endAt,
          currency: quote.currency,
          amount: quote.amount,
          status: args.paymentMethod === "WALLET" ? "CONFIRMED" : "PENDING_PAYMENT",
          details: (quote.payload ?? undefined) as any,
        },
      });

      await tx.bookingQuote.update({ where: { id: quote.id }, data: { status: "USED" } });

      if (args.paymentMethod === "WALLET") {
        await tx.walletLedger.create({
          data: {
            userId: args.userId,
            amount: -quote.amount,
            currency: quote.currency,
            reason: `Booking payment (${order.kind})`,
            refType: "booking",
            refId: order.id,
          },
        });

        await tx.transaction.create({
          data: {
            userId: args.userId,
            amount: quote.amount,
            currency: quote.currency,
            status: "PAID",
            provider: "wallet",
            providerRef: order.id,
          },
        });
      }

      return order;
    });

    return order;
  },
};

export function getProvider(name: BookingProvider): BookingProviderImpl {
  if (name === "LOCAL") return LocalProvider;
  throw new HttpError(501, `${name} provider integration coming next`);
}};

export type ProviderQuoteInput = {
  userId: string;
  kind: BookingKind;
  startAt: string;
  endAt: string;
  quantity: number;

  listingId?: string; // LOCAL
  notes?: string;

  providerPayload?: Record<string, any>; // external providers later
};

export type ProviderCheckoutInput = {
  userId: string;
  quoteId: string;
  paymentMethod: "WALLET" | "CARD";
};

export interface BookingProviderImpl {
  name: BookingProvider;

  search(input: ProviderSearchInput): Promise<any[]>;
  quote(input: ProviderQuoteInput): Promise<any>;
  checkout(input: ProviderCheckoutInput): Promise<any>;
}

export const LocalProvider: BookingProviderImpl = {
  name: "LOCAL",

  async search(input) {
    const startAt = toDate(input.startAt);
    const endAt = toDate(input.endAt);

    const listings = await prisma.bookingListing.findMany({
      where: {
        provider: "LOCAL",
        kind: input.kind,
        isActive: true,
        ...(input.city ? { city: input.city } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
    });

    const available = [];
    for (const l of listings) {
      const ok = await isListingAvailable(l.id, startAt, endAt);
      if (ok) available.push(l);
    }
    return available;
  },

  async quote(args) {
    const startAt = toDate(args.startAt);
    const endAt = toDate(args.endAt);

    if (!args.listingId) throw new HttpError(400, "listingId is required for LOCAL quote");

    const listing = await prisma.bookingListing.findUnique({ where: { id: args.listingId } });
    if (!listing || !listing.isActive) throw new HttpError(404, "Listing not found");
    if (listing.provider !== "LOCAL") throw new HttpError(400, "Not a LOCAL listing");

    const ok = await isListingAvailable(listing.id, startAt, endAt);
    if (!ok) throw new HttpError(409, "Listing not available for those dates");

    const days = daysBetween(startAt, endAt);
    const qty = Math.max(1, args.quantity);
    const amount = listing.pricePerDay * days * qty;

    const expiresMinutes = Number(env.BOOKING_QUOTE_EXPIRES_MINUTES ?? 10);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    const quote = await prisma.bookingQuote.create({
      data: {
        kind: args.kind,
        provider: "LOCAL",
        listingId: listing.id,
        userId: args.userId,
        startAt,
        endAt,
        currency: listing.currency,
        amount,
        status: "ACTIVE",
        expiresAt,
        payload: {
          notes: args.notes ?? null,
          pricePerDay: listing.pricePerDay,
          days,
          quantity: qty,
        },
      },
    });

    return quote;
  },

  async checkout(args) {
    const quote = await prisma.bookingQuote.findUnique({ where: { id: args.quoteId } });
    if (!quote) throw new HttpError(404, "Quote not found");
    if (quote.userId && quote.userId !== args.userId) throw new HttpError(403, "Not your quote");
    if (quote.status !== "ACTIVE") throw new HttpError(400, "Quote not active");

    if (quote.expiresAt <= new Date()) {
      await prisma.bookingQuote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
      throw new HttpError(400, "Quote expired");
    }

    if (quote.provider !== "LOCAL") throw new HttpError(400, "Provider checkout not implemented yet");

    if (quote.listingId) {
      const ok = await isListingAvailable(quote.listingId, quote.startAt, quote.endAt);
      if (!ok) throw new HttpError(409, "Listing no longer available");
    }

    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.bookingOrder.create({
        data: {
          kind: quote.kind,
          provider: quote.provider,
          userId: args.userId,
          listingId: quote.listingId,
          quoteId: quote.id,
          startAt: quote.startAt,
          endAt: quote.endAt,
          currency: quote.currency,
          amount: quote.amount,
          status: args.paymentMethod === "WALLET" ? "CONFIRMED" : "PENDING_PAYMENT",
          details: (quote.payload ?? undefined) as any,
        },
      });

      await tx.bookingQuote.update({ where: { id: quote.id }, data: { status: "USED" } });

      if (args.paymentMethod === "WALLET") {
        await tx.walletLedger.create({
          data: {
            userId: args.userId,
            amount: -quote.amount,
            currency: quote.currency,
            reason: `Booking payment (${order.kind})`,
            refType: "booking",
            refId: order.id,
          },
        });

        await tx.transaction.create({
          data: {
            userId: args.userId,
            amount: quote.amount,
            currency: quote.currency,
            status: "PAID",
            provider: "wallet",
            providerRef: order.id,
          },
        });
      }

      return order;
    });

    return order;
  },
};

export function getProvider(name: BookingProvider): BookingProviderImpl {
  if (name === "LOCAL") return LocalProvider;
  throw new HttpError(501, `${name} provider integration coming next`);
}};

export type ProviderQuoteInput = {
  userId: string;
  kind: BookingKind;
  startAt: string;
  endAt: string;
  quantity: number;

  listingId?: string; // LOCAL
  notes?: string;

  providerPayload?: Record<string, any>; // external providers later
};

export type ProviderCheckoutInput = {
  userId: string;
  quoteId: string;
  paymentMethod: "WALLET" | "CARD";
};

export interface BookingProviderImpl {
  name: BookingProvider;

  search(input: ProviderSearchInput): Promise<any[]>;
  quote(input: ProviderQuoteInput): Promise<any>;
  checkout(input: ProviderCheckoutInput): Promise<any>;
}

export const LocalProvider: BookingProviderImpl = {
  name: "LOCAL",

  async search(input) {
    const startAt = toDate(input.startAt);
    const endAt = toDate(input.endAt);

    const listings = await prisma.bookingListing.findMany({
      where: {
        provider: "LOCAL",
        kind: input.kind,
        isActive: true,
        ...(input.city ? { city: input.city } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: input.limit,
    });

    const available = [];
    for (const l of listings) {
      const ok = await isListingAvailable(l.id, startAt, endAt);
      if (ok) available.push(l);
    }
    return available;
  },

  async quote(args) {
    const startAt = toDate(args.startAt);
    const endAt = toDate(args.endAt);

    if (!args.listingId) throw new HttpError(400, "listingId is required for LOCAL quote");

    const listing = await prisma.bookingListing.findUnique({ where: { id: args.listingId } });
    if (!listing || !listing.isActive) throw new HttpError(404, "Listing not found");
    if (listing.provider !== "LOCAL") throw new HttpError(400, "Not a LOCAL listing");

    const ok = await isListingAvailable(listing.id, startAt, endAt);
    if (!ok) throw new HttpError(409, "Listing not available for those dates");

    const days = daysBetween(startAt, endAt);
    const qty = Math.max(1, args.quantity);
    const amount = listing.pricePerDay * days * qty;

    const expiresMinutes = Number(env.BOOKING_QUOTE_EXPIRES_MINUTES ?? 10);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    const quote = await prisma.bookingQuote.create({
      data: {
        kind: args.kind,
        provider: "LOCAL",
        listingId: listing.id,
        userId: args.userId,
        startAt,
        endAt,
        currency: listing.currency,
        amount,
        status: "ACTIVE",
        expiresAt,
        payload: {
          notes: args.notes ?? null,
          pricePerDay: listing.pricePerDay,
          days,
          quantity: qty,
        },
      },
    });

    return quote;
  },

  async checkout(args) {
    const quote = await prisma.bookingQuote.findUnique({ where: { id: args.quoteId } });
    if (!quote) throw new HttpError(404, "Quote not found");
    if (quote.userId && quote.userId !== args.userId) throw new HttpError(403, "Not your quote");
    if (quote.status !== "ACTIVE") throw new HttpError(400, "Quote not active");

    if (quote.expiresAt <= new Date()) {
      await prisma.bookingQuote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
      throw new HttpError(400, "Quote expired");
    }

    if (quote.provider !== "LOCAL") throw new HttpError(400, "Provider checkout not implemented yet");

    if (quote.listingId) {
      const ok = await isListingAvailable(quote.listingId, quote.startAt, quote.endAt);
      if (!ok) throw new HttpError(409, "Listing no longer available");
    }

    const order = await prisma.$transaction(async (tx) => {
      const order = await tx.bookingOrder.create({
        data: {
          kind: quote.kind,
          provider: quote.provider,
          userId: args.userId,
          listingId: quote.listingId,
          quoteId: quote.id,
          startAt: quote.startAt,
          endAt: quote.endAt,
          currency: quote.currency,
          amount: quote.amount,
          status: args.paymentMethod === "WALLET" ? "CONFIRMED" : "PENDING_PAYMENT",
          details: (quote.payload ?? undefined) as any,
        },
      });

      await tx.bookingQuote.update({ where: { id: quote.id }, data: { status: "USED" } });

      if (args.paymentMethod === "WALLET") {
        await tx.walletLedger.create({
          data: {
            userId: args.userId,
            amount: -quote.amount,
            currency: quote.currency,
            reason: `Booking payment (${order.kind})`,
            refType: "booking",
            refId: order.id,
          },
        });

        await tx.transaction.create({
          data: {
            userId: args.userId,
            amount: quote.amount,
            currency: quote.currency,
            status: "PAID",
            provider: "wallet",
            providerRef: order.id,
          },
        });
      }

      return order;
    });

    return order;
  },
};

export function getProvider(name: BookingProvider): BookingProviderImpl {
  if (name === "LOCAL") return LocalProvider;
  throw new HttpError(501, `${name} provider integration coming next`);
}
