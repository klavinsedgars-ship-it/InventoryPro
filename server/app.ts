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
