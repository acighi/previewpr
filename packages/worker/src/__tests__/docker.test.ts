import { describe, it, expect } from "vitest";
import { buildInstallArgs, buildRunArgs, getFreePorts } from "../docker.js";

describe("buildInstallArgs", () => {
  it("includes correct security flags and npm install command", () => {
    const args = buildInstallArgs("/tmp/code", "job-install-123");

    expect(args).toContain("--memory=512m");
    expect(args).toContain("--cpus=1");
    expect(args).toContain("--pids-limit=256");
    expect(args.join(" ")).toContain("npm install --prefer-offline");
  });

  it("does NOT include --network=none (install needs network)", () => {
    const args = buildInstallArgs("/tmp/code", "job-install-123");

    expect(args).not.toContain("--network=none");
  });
});

describe("buildRunArgs", () => {
  it("includes --network=none for runtime isolation", () => {
    const args = buildRunArgs("/tmp/code", "job-run-123", 4567);

    expect(args).toContain("--network=none");
  });

  it("mounts code volume as read-only for filesystem protection", () => {
    const args = buildRunArgs("/tmp/code", "job-run-123", 4567);

    expect(args.join(" ")).toContain("/app:ro");
  });

  it("includes --security-opt=no-new-privileges", () => {
    const args = buildRunArgs("/tmp/code", "job-run-123", 4567);

    expect(args).toContain("--security-opt=no-new-privileges");
  });

  it("includes --pids-limit=256", () => {
    const args = buildRunArgs("/tmp/code", "job-run-123", 4567);

    expect(args).toContain("--pids-limit=256");
  });

  it("uses hostPort for -p flag, not hardcoded", () => {
    const args = buildRunArgs("/tmp/code", "job-run-123", 9999);
    const portFlag = args.find((a) => a.startsWith("9999:"));

    expect(portFlag).toBe("9999:3000");
  });
});

describe("getFreePorts", () => {
  it("returns requested number of unique ports", async () => {
    const ports = await getFreePorts(2);

    expect(ports).toHaveLength(2);
    expect(ports[0]).not.toBe(ports[1]);
    expect(ports[0]).toBeGreaterThan(0);
    expect(ports[1]).toBeGreaterThan(0);
  });
});
