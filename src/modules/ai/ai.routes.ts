import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { AiIntakeSchema } from "./ai.validators.js";
import { analyzeIntake } from "./ai.service.js";

export function aiRoutes() {
  const r = Router();

  // Keep it protected for now (you can open later)
  r.post("/intake", authMiddleware, async (req: any, res, next) => {
    try {
      const input = AiIntakeSchema.parse(req.body);
      const result = await analyzeIntake(input);
      res.json({ ok: true, result });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
