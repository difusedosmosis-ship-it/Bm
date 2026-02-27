import { z } from "zod";

export const UpdateVendorProfileSchema = z.object({
  businessName: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  coverageKm: z.number().int().min(1).max(100).optional(),
  isOnline: z.boolean().optional()
});

export const SubmitKycSchema = z.object({
  idDocUrl: z.string().url().optional(),
  selfieUrl: z.string().url().optional(),
  businessDocUrl: z.string().url().optional(),
  skillProofUrl: z.string().url().optional()
});

export const CreateServiceSchema = z.object({
  categoryId: z.string().min(3),
  title: z.string().min(2),
  pricingType: z.enum(["fixed", "from", "quote"]).default("from"),
  priceFrom: z.number().int().min(0).optional(),
  isActive: z.boolean().optional()
});
