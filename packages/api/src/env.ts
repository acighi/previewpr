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
 * Normalize a PEM private key from any env var format:
 * - Literal \n escape sequences → real newlines
 * - Spaces between base64 blocks → real newlines
 * - Already has real newlines → pass through
 */
function normalizePem(raw: string): string {
  let key = raw.replace(/\\n/g, "\n");
  if (!key.includes("\n")) {
    key = key
      .replace(
        "-----BEGIN RSA PRIVATE KEY----- ",
        "-----BEGIN RSA PRIVATE KEY-----\n",
      )
      .replace(
        " -----END RSA PRIVATE KEY-----",
        "\n-----END RSA PRIVATE KEY-----",
      )
      .replace(/ /g, "\n");
  }
  return key;
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
