import { Router } from "express";
import { prisma } from "../../prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { newId } from "../../utils/ids.js";
import { CreateCategorySchema } from "./categories.validators.js";

export function categoriesRoutes() {
  const r = Router();

  r.get("/", async (_req, res) => {
    const cats = await prisma.category.findMany({ orderBy: { name: "asc" } });
    res.json({ ok: true, categories: cats });
  });

  r.post("/", authMiddleware, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const input = CreateCategorySchema.parse(req.body);
      const cat = await prisma.category.create({
        data: {
          id: newId("cat"),
          name: input.name,
          kind: input.kind ?? "PHYSICAL"
        }
      });
      res.json({ ok: true, category: cat });
    } catch (e) { next(e); }
  });

  return r;
}
