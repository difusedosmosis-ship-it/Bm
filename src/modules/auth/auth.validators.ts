import { z } from "zod";

export const RegisterSchema = z.object({
  role: z.enum(["CONSUMER", "VENDOR"]),
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
  password: z.string().min(6),
  fullName: z.string().min(2).optional()
}).refine((v) => v.email || v.phone, { message: "Provide email or phone" });

export const LoginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
  password: z.string().min(6)
}).refine((v) => v.email || v.phone, { message: "Provide email or phone" });
