import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../prisma.js";
import { newId } from "../../utils/ids.js";
import { HttpError } from "../../utils/http.js";
import { CreateReviewSchema } from "./reviews.validators.js";

export function reviewsRoutes() {
  const r = Router();

  r.post("/", authMiddleware, requireRole("CONSUMER"), async (req: any, res, next) => {
    try {
      const input = CreateReviewSchema.parse(req.body);

      const request = await prisma.request.findUnique({ where: { id: input.requestId } });
      if (!request) throw new HttpError(404, "Request not found");
      if (request.consumerId !== req.user.id) throw new HttpError(403, "Not your request");
      if (!request.acceptedVendorId) throw new HttpError(400, "No accepted vendor yet");

      const vendorUser = await prisma.user.findUnique({ where: { id: input.vendorUserId } });
      if (!vendorUser || vendorUser.role !== "VENDOR") throw new HttpError(400, "Invalid vendor");

      const review = await prisma.review.create({
        data: {
          id: newId("rev"),
          requestId: request.id,
          consumerId: req.user.id,
          vendorId: vendorUser.id,
          rating: input.rating,
          comment: input.comment ?? null
        }
      });

      res.json({ ok: true, review });
    } catch (e) { next(e); }
  });

  return r;
}
