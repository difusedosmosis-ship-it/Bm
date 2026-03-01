import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorMiddleware } from "./middleware/error.js";

import { authRoutes } from "./modules/auth/auth.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { vendorRoutes } from "./modules/vendor/vendor.routes.js";
import { requestsRoutes } from "./modules/requests/requests.routes.js";
import { reviewsRoutes } from "./modules/reviews/reviews.routes.js";
import { walletRoutes } from "./modules/wallet/wallet.routes.js";
import { bookingRoutes } from "./modules/booking/booking.routes.js";

export function buildServer() {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(morgan("dev"));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRoutes());
  app.use("/users", usersRoutes());
  app.use("/admin", adminRoutes());
  app.use("/categories", categoriesRoutes());
  app.use("/vendor", vendorRoutes());
  app.use("/requests", requestsRoutes());
  app.use("/reviews", reviewsRoutes());
  app.use("/wallet", walletRoutes());
  app.use("/booking", bookingRoutes());
  
  app.use(errorMiddleware);
  return app;
}
