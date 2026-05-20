import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "./app";

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
  // Vercel's dynamic `[...path].js` catch-all only reliably matches
  // single-segment paths on Hobby — `/api/auth/login` etc. edge-404
  // before reaching the function. As a workaround, vercel.json rewrites
  // every /api/* request to a fixed-name function (this one) and packs
  // the original path into the `_origPath` query parameter. Reconstruct
  // req.url here so Express routes against the path the client actually
  // requested.
  if (req.url) {
    const parsed = new URL(req.url, "http://localhost");
    const origPath = parsed.searchParams.get("_origPath");
    if (origPath) {
      parsed.searchParams.delete("_origPath");
      const remainingSearch = parsed.search; // includes leading '?' if any params remain
      req.url = `/api/${origPath}${remainingSearch}`;
    }
  }

  const app = await getApp();
  return app(req, res);
}
