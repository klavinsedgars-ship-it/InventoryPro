import { createServer } from "http";
import { createApp } from "./app";
import { setupVite, serveStatic, log } from "./vite";

if (process.env.NODE_ENV === "production" && process.env.BYPASS_AUTH === "true") {
  throw new Error("Refusing to start: BYPASS_AUTH=true is not allowed in production");
}

(async () => {
  const app = await createApp();
  const server = createServer(app);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || 5000);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, async () => {
    log(`serving on port ${port}`);

    const { syncQueueWorker } = await import("./sync-queue-worker");
    const { startDailySyncScheduler } = await import("./cron-jobs");
    const { autoMessageScheduler } = await import("./auto-message-scheduler");

    syncQueueWorker.start();
    log(`🚀 Sync Queue Worker started`);

    startDailySyncScheduler().catch((err) =>
      console.error("Scheduler error:", err),
    );
    log(`⏰ Daily Sync Scheduler started (runs at 2:00 AM)`);

    autoMessageScheduler.startAutoMessageScheduler();
    log(`📧 Auto-Message Scheduler started (checks hourly)`);
  });
})();
