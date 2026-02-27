import { z } from "zod";

export const CreateReviewSchema = z.object({
  requestId: z.string().min(3),
  vendorUserId: z.string().min(3),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional()
});
