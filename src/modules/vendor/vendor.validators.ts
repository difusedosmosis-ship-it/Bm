import { z } from "zod";

/**
 * Coerces "12" -> 12 and still returns a ZodNumber (NOT ZodEffects),
 * so we can chain .int().min().max() without TS errors.
 */
const zCoerceNumber = () => z.coerce.number().finite();

export const UpdateVendorProfileSchema = z
  .object({
    businessName: z.string().min(2).optional(),
    city: z.string().min(2).optional(),
    coverageKm: zCoerceNumber().int().min(1).max(100).optional(),
    isOnline: z.boolean().optional(),

    // ✅ vendor geo
    lat: zCoerceNumber().min(-90).max(90).optional(),
    lng: zCoerceNumber().min(-180).max(180).optional(),
  })
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
  priceFrom: zCoerceNumber().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
