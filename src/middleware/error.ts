import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http.js";

export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err?.message ?? "Server error";
  const details = err instanceof HttpError ? err.details : undefined;

  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, message, details });
}
