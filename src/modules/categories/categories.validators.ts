import { z } from "zod";

export const CreateCategorySchema = z.object({
  name: z.string().min(2),
  kind: z.string().optional()
});
