import crypto from "node:crypto";

// --- Secret scrubbing ---

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // GitHub token in clone URLs
  [/x-access-token:[a-zA-Z0-9_-]+@/g, "x-access-token:***@"],
  // Generic bearer tokens
  [/Bearer\s+[a-zA-Z0-9._-]{20,}/g, "Bearer ***"],
  // Known API key prefixes
  [/sk-ant-[a-zA-Z0-9_-]+/g, "sk-ant-***"],
  [/ghp_[a-zA-Z0-9]{36}/g, "ghp_***"],
  [/AKIA[A-Z0-9]{16}/g, "AKIA***"],
  // Generic long hex/base64 secrets in key=value patterns
  [
    /(api_key|api_secret|secret_key|private_key|password|token|credential)\s*[=:]\s*\S{16,}/gi,
    "$1=***",
  ],
  // File system paths (reduce internal info leakage)
  [/\/tmp\/previewpr-jobs\/[a-f0-9-]+/g, "/tmp/previewpr-jobs/***"],
  [/\/app\/[^\s"']+/g, "/app/***"],
];

export function scrubSecrets(message: string): string {
  let scrubbed = message;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

// --- Branch name validation ---

const BRANCH_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.\-]{0,255}$/;
const BRANCH_BLOCKLIST = ["--", ".."];

export function validateBranchName(name: string): void {
  if (!BRANCH_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid branch name: must match ${BRANCH_NAME_PATTERN.source}`,
    );
  }
  for (const blocked of BRANCH_BLOCKLIST) {
    if (name.includes(blocked)) {
      throw new Error(`Invalid branch name: must not contain "${blocked}"`);
    }
  }
}

// --- Route validation (for review-guide.config.json) ---

const ROUTE_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;
const MAX_ROUTES = 20;

export function validateRoutes(routes: unknown): string[] {
  if (!Array.isArray(routes)) return ["/"];

  const validated: string[] = [];
  for (const route of routes.slice(0, MAX_ROUTES)) {
    if (typeof route !== "string") continue;
    if (!ROUTE_PATTERN.test(route)) continue;
    if (route.includes("..")) continue;
    validated.push(route);
  }

  return validated.length > 0 ? validated : ["/"];
}

// --- HMAC job token ---

export function createJobToken(jobId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(jobId).digest("hex");
}

export function verifyJobToken(
  jobId: string,
  token: string,
  secret: string,
): boolean {
  const expected = createJobToken(jobId, secret);
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
