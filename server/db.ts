import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

const connectionString =
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL (or NEON_DATABASE_URL / POSTGRES_URL) must be set. " +
      "Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool, schema });
