import { z } from "zod";
import { BookingKind, BookingProvider } from "@prisma/client";

export const BookingKindSchema = z.nativeEnum(BookingKind);
export const BookingProviderSchema = z.nativeEnum(BookingProvider);

const IsoDateTimeString = z
  .string()
  .min(6)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid datetime");

const zInt = () => z.coerce.number().int();

export const CreateListingSchema = z.object({
  kind: BookingKindSchema,
  title: z.string().min(2),
  description: z.string().min(2).optional(),
  city: z.string().min(2).optional(),

  provider: BookingProviderSchema.default(BookingProvider.LOCAL),
  providerRef: z.string().min(2).optional(),

  // Use integer consistently (e.g. NGN amount or kobo)
  pricePerDay: zInt().min(0),
  currency: z.string().min(3).default("NGN"),

  capacity: zInt().min(1).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const UpdateListingSchema = CreateListingSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "No fields to update" }
);

export const SearchBookingSchema = z
  .object({
    kind: BookingKindSchema,
    city: z.string().min(2).optional(),
    startAt: IsoDateTimeString,
    endAt: IsoDateTimeString,
    limit: zInt().min(1).max(50).default(20),
  })
  .refine((v) => new Date(v.endAt).getTime() > new Date(v.startAt).getTime(), {
    message: "endAt must be after startAt",
  });

export const CreateQuoteSchema = z
  .object({
    kind: BookingKindSchema,
    provider: BookingProviderSchema.default(BookingProvider.LOCAL),

    // LOCAL uses listingId. External providers can use providerPayload later.
    listingId: z.string().min(5).optional(),

    startAt: IsoDateTimeString,
    endAt: IsoDateTimeString,

    quantity: zInt().min(1).default(1),
    notes: z.string().max(1000).optional(),

    // for Duffel/Amadeus/Hotels later
    providerPayload: z.record(z.any()).optional(),
  })
  .refine((v) => new Date(v.endAt).getTime() > new Date(v.startAt).getTime(), {
    message: "endAt must be after startAt",
  });

export const CheckoutBookingSchema = z.object({
  quoteId: z.string().min(5),
  paymentMethod: z.enum(["WALLET", "CARD"]).default("CARD"),
});
