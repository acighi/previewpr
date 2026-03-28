import { execFileSync } from "node:child_process";
import { createServer } from "node:net";

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

export function buildInstallArgs(codePath: string, name: string): string[] {
  return [
    "run",
    "--rm",
    "--name",
    name,
    "--memory=512m",
    "--cpus=1",
    "--pids-limit=256",
    "-v",
    `${codePath}:/app`,
    "-w",
    "/app",
    "node:20-alpine",
    "sh",
    "-c",
    "npm install --prefer-offline 2>&1",
  ];
}

export function buildRunArgs(
  codePath: string,
  name: string,
  hostPort: number,
): string[] {
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
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,size=100m",
    "--security-opt=no-new-privileges",
    "-v",
    `${codePath}:/app:ro`,
    "-v",
    `${codePath}/node_modules:/app/node_modules:ro`,
    "--tmpfs",
    "/app/.next:rw,size=200m",
    "-p",
    `${hostPort}:3000`,
    "-e",
    "PORT=3000",
    "node:20-alpine",
    "sh",
    "-c",
    "cd /app && npm run dev",
  ];
}

export function runInstall(codePath: string, name: string): void {
  execFileSync("docker", buildInstallArgs(codePath, name), {
    timeout: 60_000,
    stdio: "pipe",
  });
}

export function startContainer(
  codePath: string,
  name: string,
  hostPort: number,
): string {
  const result = execFileSync(
    "docker",
    buildRunArgs(codePath, name, hostPort),
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
