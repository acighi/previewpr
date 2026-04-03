export interface Env {
  PORT: number;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  REDIS_URL: string;
  DATABASE_PATH: string;
}

/**
 * Normalize a PEM private key from any env var format.
 * Extracts the raw base64 content and rebuilds proper PEM structure
 * regardless of how the env var was formatted (spaces, \n, real newlines).
 */
function normalizePem(raw: string): string {
  const base64 = raw
    .replace(/\\n/g, " ")
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");

  const typeMatch = raw.match(/-----BEGIN ([A-Z ]+)-----/);
  const type = typeMatch ? typeMatch[1] : "RSA PRIVATE KEY";

  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.substring(i, i + 64));
  }

  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

export function loadEnv(): Env {
  const required = [
    "GITHUB_APP_ID",
    "GITHUB_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    PORT: Number(process.env.PORT) || 3000,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID!,
    GITHUB_PRIVATE_KEY: normalizePem(process.env.GITHUB_PRIVATE_KEY!),
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET!,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID!,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET!,
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379/1",
    DATABASE_PATH: process.env.DATABASE_PATH || "./data/previewpr.db",
  };
}
