import type { ChangeUnit, ReviewDecision } from "../types";
import { TokenExpiredError } from "../types";

export function validateOAuthCode(code: string): boolean {
  if (!code || code.length > 40) return false;
  return /^[a-f0-9]+$/.test(code);
}

export function initiateOAuthLogin(_redirectUri: string): void {
  const oauthState = crypto.randomUUID().replace(/-/g, "");
  sessionStorage.setItem("oauth_state", oauthState);
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
  const workerUrl = import.meta.env.VITE_OAUTH_WORKER_URL;
  // Encode return URL in state so the Worker can redirect back to this deploy
  const returnUrl = window.location.origin + window.location.pathname;
  const state = `${oauthState}|${returnUrl}`;
  const callbackUrl = `${workerUrl}/oauth/callback`;
  const url =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=repo` +
    `&state=${encodeURIComponent(state)}`;
  window.location.href = url;
}

// Called after Worker redirects back with token in URL fragment
export function extractTokenFromFragment(): {
  token: string;
  state: string;
} | null {
  const hash = window.location.hash.substring(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const state = params.get("state");
  if (!token || !state) return null;
  return { token, state };
}

export function validateOAuthState(state: string): boolean {
  const storedState = sessionStorage.getItem("oauth_state");
  if (!storedState || storedState !== state) return false;
  sessionStorage.removeItem("oauth_state");
  return true;
}

export function getStoredToken(): string | null {
  return sessionStorage.getItem("github_token");
}

export function storeToken(token: string): void {
  sessionStorage.setItem("github_token", token);
}

export function clearToken(): void {
  sessionStorage.removeItem("github_token");
}

export async function githubApiFetch(
  url: string,
  token: string,
  options?: RequestInit,
): Promise<Response> {
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github.v3+json");
  const resp = await fetch(url, { ...options, headers });
  if (resp.status === 401) {
    clearToken();
    throw new TokenExpiredError();
  }
  return resp;
}

export function formatReviewComment(
  decisions: ReviewDecision[],
  changes: ChangeUnit[],
  reviewerLogin: string,
): string {
  const approved = decisions.filter((d) => d.status === "approved");
  const rejected = decisions.filter((d) => d.status === "rejected");
  let md = `## Visual Review by @${reviewerLogin}\n\n`;
  md += `**${approved.length}** approved, **${rejected.length}** rejected\n\n`;
  for (const d of decisions) {
    const change = changes.find((c) => c.id === d.changeId);
    const icon = d.status === "approved" ? "✅" : "❌";
    md += `${icon} **${change?.title ?? d.changeId}** — ${d.status}`;
    if (d.reason) md += ` — ${d.reason}`;
    md += "\n";
  }
  return md;
}

export async function submitReview(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  decisions: ReviewDecision[],
  changes: ChangeUnit[],
): Promise<void> {
  const userResp = await githubApiFetch("https://api.github.com/user", token);
  const user = await userResp.json();
  const body = formatReviewComment(decisions, changes, user.login);
  await githubApiFetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  const hasRejections = decisions.some((d) => d.status === "rejected");
  if (hasRejections) {
    const decisionsPayload = JSON.stringify(
      decisions.map((d) => {
        const change = changes.find((c) => c.id === d.changeId);
        return {
          change_id: d.changeId,
          status: d.status,
          reason: d.reason,
          title: change?.title,
          files: change?.files ?? [],
        };
      }),
    );
    await githubApiFetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/review-submit.yml/dispatches`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: "main",
          inputs: {
            pr_number: String(prNumber),
            decisions: decisionsPayload,
          },
        }),
      },
    );
  }
}
