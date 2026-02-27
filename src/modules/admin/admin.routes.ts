import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../prisma.js";
import { HttpError } from "../../utils/http.js";

export function adminRoutes() {
  const r = Router();
  r.use(authMiddleware, requireRole("ADMIN"));

  r.get("/kyc/submissions", async (_req, res) => {
    const rows = await prisma.kycSubmission.findMany({
      orderBy: { createdAt: "desc" },
      include: { vendor: { include: { user: true } } }
    });
    res.json({ ok: true, submissions: rows });
  });

  r.post("/kyc/:submissionId/approve", async (req, res, next) => {
    try {
      const id = req.params.submissionId;
      const sub = await prisma.kycSubmission.findUnique({ where: { id } });
      if (!sub) throw new HttpError(404, "Submission not found");

      await prisma.kycSubmission.update({ where: { id }, data: { status: "APPROVED", reviewerNote: req.body?.note ?? null } });
      await prisma.vendorProfile.update({ where: { id: sub.vendorId }, data: { kycStatus: "APPROVED", kycNote: req.body?.note ?? null } });

      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.post("/kyc/:submissionId/reject", async (req, res, next) => {
    try {
      const id = req.params.submissionId;
      const note = String(req.body?.note ?? "Rejected");
      const sub = await prisma.kycSubmission.findUnique({ where: { id } });
      if (!sub) throw new HttpError(404, "Submission not found");

      await prisma.kycSubmission.update({ where: { id }, data: { status: "REJECTED", reviewerNote: note } });
      await prisma.vendorProfile.update({ where: { id: sub.vendorId }, data: { kycStatus: "REJECTED", kycNote: note } });

      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
}
