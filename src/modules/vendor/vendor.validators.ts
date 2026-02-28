import { z } from "zod";

const toNumber = z.preprocess((v) => {
  // allows "6.5244" from forms, while still accepting number
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return v;
}, z.number());

export const UpdateVendorProfileSchema = z
  .object({
    businessName: z.string().min(2).optional(),
    city: z.string().min(2).optional(),
    coverageKm: toNumber.int().min(1).max(100).optional(),
    isOnline: z.boolean().optional(),

    // ✅ vendor location (for nearest-vendor dispatch)
    lat: toNumber.min(-90).max(90).optional(),
    lng: toNumber.min(-180).max(180).optional(),
  })
  // ✅ if one is provided, require the other too
  .refine(
    (v) => (v.lat == null && v.lng == null) || (v.lat != null && v.lng != null),
    { message: "lat and lng must be provided together" }
  )
  // ✅ reject NaN if frontend sends something weird
  .refine(
    (v) =>
      (v.lat == null || Number.isFinite(v.lat)) &&
      (v.lng == null || Number.isFinite(v.lng)) &&
      (v.coverageKm == null || Number.isFinite(v.coverageKm)),
    { message: "Invalid number provided" }
  );

export const SubmitKycSchema = z.object({
  idDocUrl: z.string().url().optional(),
  selfieUrl: z.string().url().optional(),
  businessDocUrl: z.string().url().optional(),
  skillProofUrl: z.string().url().optional(),
});

export const CreateServiceSchema = z.object({
  categoryId: z.string().min(3),
  title: z.string().min(2),
  pricingType: z.enum(["fixed", "from", "quote"]).default("from"),
  priceFrom: toNumber.int().min(0).optional(),
  isActive: z.boolean().optional(),
});
