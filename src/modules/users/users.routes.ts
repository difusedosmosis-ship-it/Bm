import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";

export function usersRoutes() {
  const r = Router();

  r.get("/me", authMiddleware, async (req: any, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { vendorProfile: true }
    });
    res.json({ ok: true, user });
  });

  return r;
}
