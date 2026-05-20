import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server/app";

let appPromise: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null;

function getApp() {
  if (!appPromise) {
    appPromise = createApp().catch((err) => {
      appPromise = null;
      throw err;
    }) as Promise<any>;
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return app(req, res);
}

export const config = {
  runtime: "nodejs20.x",
  maxDuration: 60,
};
