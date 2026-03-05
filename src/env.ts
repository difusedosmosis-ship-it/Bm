import dotenv from "dotenv";
dotenv.config();

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? "8080"),

  DATABASE_URL: must("DATABASE_URL"),
  DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL,

  JWT_SECRET: must("JWT_SECRET"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",

  OFFER_EXPIRES_SECONDS: Number(process.env.OFFER_EXPIRES_SECONDS ?? "30"),

  // ✅ Booking
  BOOKING_QUOTE_EXPIRES_MINUTES: Number(process.env.BOOKING_QUOTE_EXPIRES_MINUTES ?? "10"),
  BOOKING_DEFAULT_CURRENCY: process.env.BOOKING_DEFAULT_CURRENCY ?? "NGN",

  // ✅ AI
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};
