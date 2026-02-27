import type { Response, NextFunction } from "express";
import type { AuthedRequest } from "./auth.js";

export function requireRole(...roles: Array<"CONSUMER" | "VENDOR" | "ADMIN">) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ ok: false, message: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, message: "Forbidden" });
    next();
  };
}
