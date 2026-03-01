import type { BookingKind, BookingProvider } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { HttpError } from "../../utils/http.js";
import { getProvider } from "./booking.providers.js";

export async function createListing(args: {
  kind: BookingKind;
  title: string;
  description?: string;
  city?: string;

  provider: BookingProvider;

  pricePerDay: number;
  currency: string;
  capacity?: number;
  isActive?: boolean;
}) {
  const row = await prisma.bookingListing.create({
    data: {
      kind: args.kind,
      title: args.title,
      description: args.description ?? null,
      city: args.city ?? null,

      provider: args.provider, // ✅ Prisma enum

      pricePerDay: args.pricePerDay,
      currency: args.currency,
      capacity: args.capacity ?? null,
      isActive: args.isActive ?? false,
    },
  });

  return row;
}

export async function updateListing(listingId: string, patch: Record<string, any>) {
  const existing = await prisma.bookingListing.findUnique({ where: { id: listingId } });
  if (!existing) throw new HttpError(404, "Listing not found");

  return prisma.bookingListing.update({
    where: { id: listingId },
    data: patch as any,
  });
}

export async function getListingById(listingId: string) {
  const row = await prisma.bookingListing.findUnique({ where: { id: listingId } });
  if (!row) throw new HttpError(404, "Listing not found");
  return row;
}

export async function listListings(args: {
  kind?: BookingKind;
  provider?: BookingProvider;
  city?: string;
  isActive?: boolean;
  limit: number;
}) {
  const rows = await prisma.bookingListing.findMany({
    where: {
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.city ? { city: args.city } : {}),
      ...(typeof args.isActive === "boolean" ? { isActive: args.isActive } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: args.limit,
  });
  return rows;
}

export async function searchListings(input: {
  provider: BookingProvider;
  kind: BookingKind;
  city?: string;
  startAt: string;
  endAt: string;
  limit: number;
}) {
  const provider = getProvider(input.provider);
  return provider.search({
    kind: input.kind,
    city: input.city,
    startAt: input.startAt,
    endAt: input.endAt,
    limit: input.limit,
  });
}

export async function createQuote(input: {
  userId: string;
  provider: BookingProvider;
  kind: BookingKind;
  listingId?: string;
  startAt: string;
  endAt: string;
  quantity: number;
  notes?: string;
  providerPayload?: Record<string, any>;
}) {
  const provider = getProvider(input.provider);
  return provider.quote({
    userId: input.userId,
    providerPayload: input.providerPayload,
    kind: input.kind,
    listingId: input.listingId,
    startAt: input.startAt,
    endAt: input.endAt,
    quantity: input.quantity,
    notes: input.notes,
  });
}

export async function confirmOrder(input: {
  userId: string;
  quoteId: string;
  paymentMethod: "WALLET" | "CARD";
}) {
  const quote = await prisma.bookingQuote.findUnique({ where: { id: input.quoteId } });
  if (!quote) throw new HttpError(404, "Quote not found");

  const provider = getProvider(quote.provider);
  return provider.checkout({
    userId: input.userId,
    quoteId: input.quoteId,
    paymentMethod: input.paymentMethod,
  });
}

export async function myOrders(userId: string) {
  return prisma.bookingOrder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { listing: true, quote: true },
  });
}

export async function orderById(userId: string, id: string) {
  const order = await prisma.bookingOrder.findUnique({
    where: { id },
    include: { listing: true, quote: true },
  });

  if (!order) throw new HttpError(404, "Order not found");
  if (order.userId !== userId) throw new HttpError(403, "Forbidden");
  return order;
}
