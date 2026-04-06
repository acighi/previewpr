export interface WorkerEnv {
  REDIS_URL: string;
  DATABASE_PATH: string;
  ANTHROPIC_API_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  GITHUB_CLIENT_ID: string;
  API_BASE_URL: string;
  JOBS_DIR: string;
  HEALTH_PORT: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Normalize a PEM private key from any env var format.
 * Extracts the raw base64 content and rebuilds proper PEM structure
 * regardless of how the env var was formatted (spaces, \n, real newlines).
 */
function normalizePem(raw: string): string {
  // Strip the PEM header/footer and all whitespace to get pure base64
  const base64 = raw
    .replace(/\\n/g, " ")
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");

  // Detect key type from original string
  const typeMatch = raw.match(/-----BEGIN ([A-Z ]+)-----/);
  const type = typeMatch ? typeMatch[1] : "RSA PRIVATE KEY";

  // Rebuild with 64-char lines (PEM standard)
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.substring(i, i + 64));
  }

  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

export function loadEnv(): WorkerEnv {
  return {
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/1",
    DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/previewpr.db",
    ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
    GITHUB_APP_ID: required("GITHUB_APP_ID"),
    GITHUB_PRIVATE_KEY: normalizePem(required("GITHUB_PRIVATE_KEY")),
    CF_API_TOKEN: required("CF_API_TOKEN"),
    CF_ACCOUNT_ID: required("CF_ACCOUNT_ID"),
    GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID"),
    API_BASE_URL: process.env.API_BASE_URL ?? "https://api.previewpr.com",
    JOBS_DIR: process.env.JOBS_DIR ?? "/tmp/previewpr-jobs",
    HEALTH_PORT: Number(process.env.HEALTH_PORT || "3001"),
  };
}
