import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { prisma } from "../../prisma.js";
import { HttpError } from "../../utils/http.js";
import { newId } from "../../utils/ids.js";
import { UpdateVendorProfileSchema, SubmitKycSchema, CreateServiceSchema } from "./vendor.validators.js";

export function vendorRoutes() {
  const r = Router();
  r.use(authMiddleware, requireRole("VENDOR"));

  r.get("/me", async (req: any, res) => {
    const vendor = await prisma.vendorProfile.findUnique({
      where: { userId: req.user.id },
      include: { services: { include: { category: true } }, user: true }
    });
    res.json({ ok: true, vendor });
  });

  r.patch("/me", async (req: any, res, next) => {
    try {
      const input = UpdateVendorProfileSchema.parse(req.body);
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const updated = await prisma.vendorProfile.update({
        where: { id: vendor.id },
        data: input
      });
      res.json({ ok: true, vendor: updated });
    } catch (e) { next(e); }
  });

  r.post("/kyc/submit", async (req: any, res, next) => {
    try {
      const input = SubmitKycSchema.parse(req.body);
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");

      const submission = await prisma.kycSubmission.create({
        data: {
          id: newId("kyc"),
          vendorId: vendor.id,
          status: "SUBMITTED",
          idDocUrl: input.idDocUrl ?? null,
          selfieUrl: input.selfieUrl ?? null,
          businessDocUrl: input.businessDocUrl ?? null,
          skillProofUrl: input.skillProofUrl ?? null
        }
      });

      await prisma.vendorProfile.update({
        where: { id: vendor.id },
        data: { kycStatus: "UNDER_REVIEW" }
      });

      res.json({ ok: true, submission });
    } catch (e) { next(e); }
  });

  r.post("/services", async (req: any, res, next) => {
    try {
      const input = CreateServiceSchema.parse(req.body);
      const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
      if (!vendor) throw new HttpError(404, "Vendor not found");
      if (vendor.kycStatus !== "APPROVED") throw new HttpError(403, "KYC not approved yet");

      const service = await prisma.vendorService.create({
        data: {
          id: newId("svc"),
          vendorId: vendor.id,
          categoryId: input.categoryId,
          title: input.title,
          pricingType: input.pricingType,
          priceFrom: input.priceFrom ?? null,
          isActive: input.isActive ?? true
        }
      });

      res.json({ ok: true, service });
    } catch (e) { next(e); }
  });

  r.get("/services", async (req: any, res) => {
    const vendor = await prisma.vendorProfile.findUnique({ where: { userId: req.user.id } });
    if (!vendor) return res.status(404).json({ ok: false, message: "Vendor not found" });

    const services = await prisma.vendorService.findMany({
      where: { vendorId: vendor.id },
      include: { category: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ ok: true, services });
  });

  return r;
}
