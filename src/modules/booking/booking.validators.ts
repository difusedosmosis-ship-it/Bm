import { z } from "zod";

export const BookingKindSchema = z.enum(["HALL", "CAR", "HOTEL", "FLIGHT"]);

export const SearchBookingSchema = z.object({
  kind: BookingKindSchema,
  city: z.string().min(2).optional(),        // LOCAL search uses city
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

export const CreateQuoteSchema = z.object({
  kind: BookingKindSchema,
  listingId: z.string().min(8).optional(),   // required for LOCAL
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

export const CheckoutBookingSchema = z.object({
  quoteId: z.string().min(8),
  paymentMethod: z.enum(["WALLET", "CARD"]).default("WALLET"),
});
