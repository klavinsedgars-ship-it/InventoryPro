import type { Response, NextFunction } from "express";
import { storage } from "../storage";

/**
 * Session-based auth guard, lifted out of registerRoutes so route modules can
 * import it (the first step of splitting the routes monolith into per-domain
 * routers). Behaviour is identical to the previous inline closure.
 *
 * NOTE: BYPASS_AUTH short-circuits every request to the seeded admin — a
 * staging convenience that must never be set in production (flagged in the
 * security review).
 */
export const requireAuth = async (req: any, res: Response, next: NextFunction) => {
  if (process.env.BYPASS_AUTH === "true") {
    if (!req.session?.userId) {
      try {
        const admin = await storage.getUserByUsername("admin");
        if (admin) {
          req.session.userId = admin.id;
        }
      } catch (err) {
        console.error("BYPASS_AUTH admin lookup failed:", err);
      }
    }
    return next();
  }

  if (!req.session?.userId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};
