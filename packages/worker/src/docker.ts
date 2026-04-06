import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { createLogger } from "@previewpr/shared";

export type ProjectType = "node" | "static";

// Detect the Docker host address from inside a container.
// Uses the default gateway IP, which routes to the Docker host where
// port-mapped sandbox containers are reachable.
let cachedHostAddress: string | null = null;
export function getDockerHostAddress(): string {
  if (cachedHostAddress) return cachedHostAddress;
  try {
    const result = execFileSync("ip", ["route", "show", "default"], {
      timeout: 5_000,
      encoding: "utf-8",
    });
    const match = result.match(/via\s+(\S+)/);
    if (match) {
      cachedHostAddress = match[1];
      return cachedHostAddress;
    }
  } catch {
    // not in a container or ip command unavailable
  }
  cachedHostAddress = "localhost";
  return cachedHostAddress;
}

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
      ? "echo static project, skipping install"
      : "npm install --prefer-offline --ignore-scripts 2>&1";

  return [...baseArgs, installCmd];
}

// Minimal Node.js static file server — base64-encoded to avoid shell quoting issues.
// Decoded at container startup into /tmp and run with node.
const STATIC_SERVER_SCRIPT = `
const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".webp": "image/webp",
};
http.createServer((req, res) => {
  let p = url.parse(req.url).pathname;
  if (p === "/") p = "/index.html";
  const fp = path.join("/app", p);
  if (!fp.startsWith("/app/")) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); }
    else {
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    }
  });
}).listen(3000, "0.0.0.0", () => console.log("Static server on port 3000"));
`;
const STATIC_SERVER_B64 = Buffer.from(STATIC_SERVER_SCRIPT).toString("base64");

export function buildRunArgs(
  codePath: string,
  name: string,
  hostPort: number,
  projectType: ProjectType = "node",
): string[] {
  // For static: pipe the server script directly into node via stdin
  const serveCmd =
    projectType === "static"
      ? `echo ${STATIC_SERVER_B64} | base64 -d | node`
      : "cd /app && npm run dev";

  const volumes: string[] = ["-v", `${codePath}:/app:ro`];
  if (projectType === "node") {
    volumes.push("-v", `${codePath}/node_modules:/app/node_modules:ro`);
  }

  const args = [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--memory=512m",
    "--cpus=1",
    "--pids-limit=256",
    "--security-opt=no-new-privileges",
  ];

  // All containers get network isolation to prevent SSRF
  args.push("--network=none");
  if (projectType === "node") {
    args.push("--tmpfs", "/tmp:rw,noexec,size=100m");
  }

  args.push(
    ...volumes,
    "-p",
    `${hostPort}:3000`,
    "-e",
    "PORT=3000",
    "node:20-alpine",
    "sh",
    "-c",
    serveCmd,
  );

  return args;
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    createLogger().warn(`Failed to stop container ${name}`, { error: msg });
  }
  try {
    execFileSync("docker", ["rm", "-f", name], {
      timeout: 10_000,
      stdio: "pipe",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    createLogger().warn(`Failed to remove container ${name}`, { error: msg });
  }
}

export function getContainerLogs(name: string): string {
  try {
    return execFileSync("docker", ["logs", "--tail", "50", name], {
      timeout: 5_000,
      encoding: "utf-8",
    });
  } catch {
    return "(no logs available)";
  }
}

export function isContainerRunning(name: string): boolean {
  try {
    const result = execFileSync(
      "docker",
      ["inspect", "-f", "{{.State.Running}}", name],
      { timeout: 5_000, encoding: "utf-8" },
    );
    return result.trim() === "true";
  } catch {
    return false;
  }
}

export async function waitForReady(
  port: number,
  containerName: string,
  timeoutMs: number = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const host = getDockerHostAddress();
      const response = await fetch(`http://${host}:${port}/`);
      if (response.ok || response.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Capture diagnostics before throwing
  const running = isContainerRunning(containerName);
  const logs = getContainerLogs(containerName);
  throw new Error(
    `Container ${containerName} on port ${port} not ready after ${timeoutMs}ms. ` +
      `Running: ${running}. Logs:\n${logs}`,
  );
}
