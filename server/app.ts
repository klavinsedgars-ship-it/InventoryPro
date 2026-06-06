import express, { type Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes";

const PgSession = connectPgSimple(session);

export async function createApp(): Promise<Express> {
  const app = express();

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));

  // Vercel and most production hosts sit behind a proxy
  app.set("trust proxy", 1);

  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    console.warn("⚠️  SESSION_SECRET not set; using insecure dev default");
  }

  // Crons are protected by `Authorization: Bearer $CRON_SECRET`. Without it,
  // the cron endpoints fall back to session auth, which means anyone with a
  // valid session can trigger them — and if BYPASS_AUTH is on, anyone at all.
  if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET) {
    console.error(
      "⚠️  CRON_SECRET is not set in production. Cron endpoints (daily-sync, list-ramp) " +
        "have no Vercel-cron Bearer auth — they will only be protected by session auth.",
    );
  }
  // BYPASS_AUTH turns every request into the admin user. Useful for staging
  // demos, catastrophic in production. server/index.ts already refuses to
  // boot in that combination locally; this catches Vercel deploys (which run
  // server/app.ts, not server/index.ts).
  if (process.env.NODE_ENV === "production" && process.env.BYPASS_AUTH === "true") {
    throw new Error("BYPASS_AUTH=true is not permitted when NODE_ENV=production");
  }

  app.use(
    session({
      store: new PgSession({
        pool: pool as any,
        tableName: "user_sessions",
        createTableIfMissing: true,
        pruneSessionInterval: false,
      }),
      secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        console.log(
          `${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`,
        );
      }
    });
    next();
  });

  await registerRoutes(app);

  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status || err.statusCode || 500;
    console.error("[express-error]", err);
    res.status(status).json({ message: err.message || "Internal Server Error" });
  });

  return app;
}
