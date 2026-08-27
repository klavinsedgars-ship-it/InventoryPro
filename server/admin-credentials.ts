/**
 * Admin credentials, declared by environment rather than baked into the code.
 *
 * seedDefaults() creates admin/admin123 on a fresh database, and there is no UI
 * to change it — so the account either keeps a published default password or
 * someone edits the source. Neither is acceptable for a system that can list
 * and reprice a live eBay account.
 *
 * Environment is the right home: a secret in the repository is permanent (git
 * history keeps it long after the "fix" commit), while an env var can be
 * rotated by changing one value and redeploying.
 *
 * Pure: validation only, no storage or hashing.
 */

export interface AdminCredentials {
  username: string;
  email: string;
  password: string;
}

export type AdminCredentialsResult =
  | { configured: false }
  | { configured: true; ok: true; credentials: AdminCredentials }
  | { configured: true; ok: false; error: string };

/**
 * Read and validate the admin credentials from the environment.
 *
 * `configured: false` is the normal case for a deployment that hasn't opted
 * in — it must leave the existing account untouched rather than fail.
 */
export function adminCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AdminCredentialsResult {
  const password = env.ADMIN_PASSWORD;
  if (!password) return { configured: false };

  const username = (env.ADMIN_USERNAME || env.ADMIN_EMAIL || "").trim();
  const email = (env.ADMIN_EMAIL || env.ADMIN_USERNAME || "").trim();

  if (!username) {
    return { configured: true, ok: false, error: "ADMIN_PASSWORD is set but ADMIN_USERNAME/ADMIN_EMAIL is not" };
  }
  if (password.length < 8) {
    return { configured: true, ok: false, error: "ADMIN_PASSWORD must be at least 8 characters" };
  }
  // Not a policy judgement — this specific value is the seeded default, and
  // promoting it to "configured" would silently keep a published password.
  if (password === "admin123") {
    return { configured: true, ok: false, error: "ADMIN_PASSWORD is the seeded default; choose another" };
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { configured: true, ok: false, error: `ADMIN_EMAIL "${email}" is not a valid address` };
  }

  return {
    configured: true,
    ok: true,
    credentials: { username, email: email || `${username}@local`, password },
  };
}
