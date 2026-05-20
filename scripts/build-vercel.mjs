#!/usr/bin/env node
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

// 1. Frontend
run("vite build");

// 2. Vercel serverless function (bundle handler so it's self-contained)
run(
  "esbuild server/vercel-handler.ts --bundle --platform=node --target=node20 --format=esm --packages=external --outfile=api/_proxy.js",
);

// 3. Stamp the build so /__build.json identifies which commit is live
mkdirSync("dist/public", { recursive: true });
const stamp = {
  commit: process.env.VERCEL_GIT_COMMIT_SHA || "local",
  ref: process.env.VERCEL_GIT_COMMIT_REF || "local",
  builtAt: new Date().toISOString(),
};
writeFileSync("dist/public/__build.json", JSON.stringify(stamp, null, 2));
console.log("\n__build.json:", stamp);
