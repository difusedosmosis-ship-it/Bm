import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";

export function walletRoutes() {
  const r = Router();

  r.get("/me/ledger", authMiddleware, async (req: any, res) => {
    const rows = await prisma.walletLedger.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    const balance = rows.reduce((a, b) => a + b.amount, 0);
    res.json({ ok: true, balance, rows });
  });

  return r;
}
