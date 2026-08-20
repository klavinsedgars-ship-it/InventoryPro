// Regenerates server/schema-bootstrap-sql.ts from the latest drizzle-kit
// migration output. Run via: npm run db:generate-bootstrap
import fs from "node:fs";
import path from "node:path";

const dir = "migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.error("No .sql files in migrations/ — run drizzle-kit generate first.");
  process.exit(1);
}
// Concatenate all migration files in order (fresh repo has one baseline file).
const all = files
  .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
  .join("\n--> statement-breakpoint\n");
const stmts = all.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

const out = `// AUTO-GENERATED from migrations/*.sql (drizzle-kit generate).
// The complete current schema as individual DDL statements, embedded as a
// module so the esbuild-bundled Vercel function can apply it at runtime —
// the CLI cannot run there and a loose .sql file would not be bundled.
// Regenerate with: npm run db:generate-bootstrap
export const SCHEMA_STATEMENTS: string[] = ${JSON.stringify(stmts, null, 2)};
`;
fs.writeFileSync("server/schema-bootstrap-sql.ts", out);
console.log(`Embedded ${stmts.length} statements from ${files.length} file(s) into server/schema-bootstrap-sql.ts`);
