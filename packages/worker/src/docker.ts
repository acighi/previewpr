import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

export type ProjectType = "node" | "static";

export function detectProjectType(codePath: string): ProjectType {
  return existsSync(path.join(codePath, "package.json")) ? "node" : "static";
}

export async function getFreePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.listen(0, () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          server.close();
          reject(new Error("Failed to get port"));
          return;
        }
        const port = addr.port;
        server.close(() => resolve(port));
      });
      server.on("error", reject);
    });
    ports.push(port);
  }
  return ports;
}

export function buildInstallArgs(
  codePath: string,
  name: string,
  projectType: ProjectType = "node",
): string[] {
  const baseArgs = [
    "run",
    "--rm",
    "--name",
    name,
    "--memory=512m",
    "--cpus=1",
    "--pids-limit=256",
    "--security-opt=no-new-privileges",
    "-v",
    `${codePath}:/app`,
    "-w",
    "/app",
    "node:20-alpine",
    "sh",
    "-c",
  ];

  const installCmd =
    projectType === "static"
      ? "npm init -y && npm install serve 2>&1"
      : "npm install --prefer-offline --ignore-scripts 2>&1";

  return [...baseArgs, installCmd];
}

export function buildRunArgs(
  codePath: string,
  name: string,
  hostPort: number,
  projectType: ProjectType = "node",
): string[] {
  const serveCmd =
    projectType === "static"
      ? "cd /app && ./node_modules/.bin/serve -s . -l 3000"
      : "cd /app && npm run dev";

  return [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--network=none",
    "--memory=512m",
    "--cpus=1",
    "--pids-limit=256",
    "--tmpfs",
    "/tmp:rw,noexec,size=100m",
    "--security-opt=no-new-privileges",
    "-v",
    `${codePath}:/app:ro`,
    "-v",
    `${codePath}/node_modules:/app/node_modules:ro`,
    "-p",
    `${hostPort}:3000`,
    "-e",
    "PORT=3000",
    "node:20-alpine",
    "sh",
    "-c",
    serveCmd,
  ];
}

export function runInstall(
  codePath: string,
  name: string,
  projectType: ProjectType = "node",
): void {
  execFileSync("docker", buildInstallArgs(codePath, name, projectType), {
    timeout: 60_000,
    stdio: "pipe",
  });
}

export function startContainer(
  codePath: string,
  name: string,
  hostPort: number,
  projectType: ProjectType = "node",
): string {
  const result = execFileSync(
    "docker",
    buildRunArgs(codePath, name, hostPort, projectType),
    {
      timeout: 10_000,
      encoding: "utf-8",
    },
  );
  return result.trim();
}

export function stopContainer(name: string): void {
  try {
    execFileSync("docker", ["stop", name], { timeout: 15_000, stdio: "pipe" });
  } catch {
    // ignore
  }
  try {
    execFileSync("docker", ["rm", "-f", name], {
      timeout: 10_000,
      stdio: "pipe",
    });
  } catch {
    // ignore
  }
}

export async function waitForReady(
  port: number,
  timeoutMs: number = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/`);
      if (response.ok || response.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Container on port ${port} not ready after ${timeoutMs}ms`);
}
