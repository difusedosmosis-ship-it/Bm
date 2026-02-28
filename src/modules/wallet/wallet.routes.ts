import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { prisma } from "../../prisma.js";

type LedgerRow = { amount: number };

export function walletRoutes() {
  const r = Router();

  r.get("/me/ledger", authMiddleware, async (req: any, res) => {
    const rows = await prisma.walletLedger.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const balance = (rows as LedgerRow[]).reduce(
      (sum: number, row: LedgerRow) => sum + row.amount,
      0
    );

    res.json({ ok: true, balance, rows });
  });

  return r;
}
