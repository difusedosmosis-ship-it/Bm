import { z } from "zod";

export const AiIntakeSchema = z.object({
  text: z.string().min(2),
  city: z.string().min(2).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),

  // optional extra context (future-proof)
  context: z
    .object({
      mode: z.enum(["REQUEST", "BOOKING", "SUPPORT"]).optional(),
      userRole: z.enum(["CONSUMER", "VENDOR", "ADMIN"]).optional(),
      hints: z.record(z.any()).optional(),
    })
    .optional(),
});

export const AiIntakeResultSchema = z.object({
  category: z.string().min(2), // should match Category.name in your DB (for MVP)
  urgency: z.enum(["normal", "urgent"]).default("normal"),
  summary: z.string().min(2),
  tags: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  questions: z.array(z.string().min(2)).default([]),
});

export type AiIntakeInput = z.infer<typeof AiIntakeSchema>;
export type AiIntakeResult = z.infer<typeof AiIntakeResultSchema>;
