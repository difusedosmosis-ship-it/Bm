import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

export type AuthedRequest = Request & {
  user?: { id: string; role: "CONSUMER" | "VENDOR" | "ADMIN" };
};

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ ok: false, message: "Missing token" });

  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Invalid token" });
  }
}
