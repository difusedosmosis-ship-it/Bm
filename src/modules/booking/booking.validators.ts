import { z } from "zod";

export const BookingKindSchema = z.enum(["HOTEL", "FLIGHT", "CAR", "HALL"]);

export const CreateListingSchema = z.object({
  kind: BookingKindSchema,
  title: z.string().min(2),
  description: z.string().min(2).optional(),
  city: z.string().min(2).optional(),

  // price is stored in minor unit (kobo) or normal int — you choose your convention
  // keep consistent across system
  basePrice: z.number().int().min(0),
  currency: z.string().min(3).default("NGN"),

  // inventory / capacity
  capacity: z.number().int().min(1).optional(),

  // optional metadata for provider integrations later
  provider: z.string().min(2).optional(), // "LOCAL" | "DUFFEL" | "AMADEUS" | ...
  providerRef: z.string().min(2).optional(),

  isActive: z.boolean().optional(),
});

export const UpdateListingSchema = CreateListingSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "No fields to update" }
);

export const SearchListingsSchema = z.object({
  kind: BookingKindSchema.optional(),
  city: z.string().min(2).optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const CreateQuoteSchema = z.object({
  listingId: z.string().min(5),

  // generic booking window. For flights this will later map to flight segments; for halls/hotels it’s dates.
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),

  // optional quantity (rooms, cars, seats, etc)
  quantity: z.number().int().min(1).default(1),
}).refine((v) => v.endAt > v.startAt, { message: "endAt must be after startAt" });

export const ConfirmOrderSchema = z.object({
  quoteId: z.string().min(5),

  // payment mode placeholder (wallet, paystack, etc)
  payMode: z.enum(["WALLET", "CARD"]).default("CARD"),
});
