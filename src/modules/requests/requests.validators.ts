import { z } from "zod";

export const CreateRequestSchema = z.object({
  mode: z.enum(["MATCHED", "CHOOSE"]).default("MATCHED"),
  vendorId: z.string().optional(),
  city: z.string().min(2),
  category: z.string().min(2),
  description: z.string().min(2),
  urgency: z.enum(["normal", "urgent"]).default("normal"),
  lat: z.number(),
  lng: z.number()
});
