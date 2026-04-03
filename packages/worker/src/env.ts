export interface WorkerEnv {
  REDIS_URL: string;
  DATABASE_PATH: string;
  ANTHROPIC_API_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  JOBS_DIR: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Normalize a PEM private key from any env var format:
 * - Literal \n escape sequences → real newlines
 * - Spaces between base64 blocks → real newlines
 * - Already has real newlines → pass through
 */
function normalizePem(raw: string): string {
  // First handle \n escape sequences
  let key = raw.replace(/\\n/g, "\n");
  // If it still looks like a single line (no newlines between BEGIN and END),
  // split on spaces between base64 chunks
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

export function loadEnv(): WorkerEnv {
  return {
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/1",
    DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/previewpr.db",
    ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
    GITHUB_APP_ID: required("GITHUB_APP_ID"),
    GITHUB_PRIVATE_KEY: normalizePem(required("GITHUB_PRIVATE_KEY")),
    CF_API_TOKEN: required("CF_API_TOKEN"),
    CF_ACCOUNT_ID: required("CF_ACCOUNT_ID"),
    JOBS_DIR: process.env.JOBS_DIR ?? "/tmp/previewpr-jobs",
  };
}
