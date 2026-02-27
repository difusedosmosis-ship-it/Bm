import { Router } from "express";
import { prisma } from "../../prisma.js";
import { newId } from "../../utils/ids.js";
import { HttpError } from "../../utils/http.js";
import { RegisterSchema, LoginSchema } from "./auth.validators.js";
import { hashPassword, verifyPassword, signToken } from "./auth.service.js";

export function authRoutes() {
  const r = Router();

  r.post("/register", async (req, res, next) => {
    try {
      const input = RegisterSchema.parse(req.body);

      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            input.email ? { email: input.email } : undefined,
            input.phone ? { phone: input.phone } : undefined
          ].filter(Boolean) as any
        }
      });
      if (existing) throw new HttpError(409, "User already exists");

      const user = await prisma.user.create({
        data: {
          id: newId("usr"),
          role: input.role,
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(input.password),
          fullName: input.fullName ?? null
        }
      });

      // If vendor, auto create vendorProfile
      if (input.role === "VENDOR") {
        await prisma.vendorProfile.create({
          data: {
            id: newId("ven"),
            userId: user.id,
            city: "Lagos",
            coverageKm: 10,
            isOnline: false,
            kycStatus: "DRAFT"
          }
        });
      }

      const token = signToken({ id: user.id, role: user.role });
      res.json({ ok: true, token, user: { id: user.id, role: user.role, email: user.email, phone: user.phone } });
    } catch (e) { next(e); }
  });

  r.post("/login", async (req, res, next) => {
    try {
      const input = LoginSchema.parse(req.body);

      const user = await prisma.user.findFirst({
        where: input.email ? { email: input.email } : { phone: input.phone! }
      });
      if (!user?.passwordHash) throw new HttpError(401, "Invalid credentials");

      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) throw new HttpError(401, "Invalid credentials");

      const token = signToken({ id: user.id, role: user.role });
      res.json({ ok: true, token, user: { id: user.id, role: user.role, email: user.email, phone: user.phone } });
    } catch (e) { next(e); }
  });

  return r;
}
