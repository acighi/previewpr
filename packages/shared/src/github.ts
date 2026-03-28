import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";

let appInstance: App | null = null;

export function initGitHubApp(appId: string, privateKey: string): App {
  appInstance = new App({
    appId,
    privateKey,
  });
  return appInstance;
}

export function getGitHubApp(): App {
  if (!appInstance) {
    throw new Error("GitHub App not initialized. Call initGitHubApp() first.");
  }
  return appInstance;
}

export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  const app = getGitHubApp();
  return app.getInstallationOctokit(installationId);
}

export async function postPrComment(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId);
  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    { owner, repo, issue_number: prNumber, body },
  );
}

export async function getCloneToken(installationId: number): Promise<string> {
  const app = getGitHubApp();
  const octokit = await app.getInstallationOctokit(installationId);
  const { data } = await octokit.request(
    "POST /app/installations/{installation_id}/access_tokens",
    { installation_id: installationId },
  );
  return data.token;
}

export async function isCollaborator(
  installationId: number,
  owner: string,
  repo: string,
  username: string,
): Promise<boolean> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    await octokit.request(
      "GET /repos/{owner}/{repo}/collaborators/{username}",
      { owner, repo, username },
    );
    return true;
  } catch {
    return false;
  }
}
