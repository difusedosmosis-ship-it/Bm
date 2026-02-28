import { z } from "zod";

export const UpdateVendorProfileSchema = z
  .object({
    businessName: z.string().min(2).optional(),
    city: z.string().min(2).optional(),
    coverageKm: z.number().int().min(1).max(100).optional(),
    isOnline: z.boolean().optional(),

    // ✅ vendor location (for nearest-vendor dispatch)
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  // ✅ if one is provided, require the other too
  .refine(
    (v) => (v.lat == null && v.lng == null) || (v.lat != null && v.lng != null),
    { message: "lat and lng must be provided together" }
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
  priceFrom: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
