import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { ChangeUnit } from "@previewpr/shared";
import { createLogger } from "@previewpr/shared";
import { getDockerHostAddress } from "../docker.js";

// --- Types ---

export interface CaptureOptions {
  changes: ChangeUnit[];
  routes: string[];
  beforePort: number;
  afterPort: number;
  outputDir: string;
}

export interface CaptureEntry {
  route: string;
  before?: string;
  after?: string;
  diff?: string; // filled in later by generate-diffs
}

export interface ScreenshotEntry {
  affected_routes: string[];
  captures: CaptureEntry[];
}

export interface CaptureResult {
  screenshots: Record<string, ScreenshotEntry>;
}

// --- Route detection (ported from prototype) ---

const GLOBAL_PATTERNS = /Layout|Nav|Header|Footer|App/;

export function detectAffectedRoutes(
  files: string[],
  allRoutes: string[],
): string[] {
  const affected = new Set<string>();

  for (const file of files) {
    const name = basename(file).replace(/\.[^.]+$/, "");
    if (GLOBAL_PATTERNS.test(name)) {
      return [...allRoutes];
    }
    const matchedRoute = matchFileToRoute(name, allRoutes);
    if (matchedRoute) {
      affected.add(matchedRoute);
    } else {
      affected.add("/");
    }
  }

  return [...affected];
}

export function matchFileToRoute(
  name: string,
  routes: string[],
): string | null {
  const lower = name.toLowerCase();
  if (lower === "home" || lower === "index") return "/";
  for (const route of routes) {
    const routeName = route === "/" ? "" : route.replace(/^\//, "");
    if (routeName && lower === routeName.toLowerCase()) {
      return route;
    }
  }
  return null;
}

export function routeToFilename(route: string): string {
  if (route === "/") return "index";
  return route.replace(/^\//, "").replace(/\//g, "-");
}

// --- Screenshot capture ---

const log = createLogger();
const PAGE_TIMEOUT = 30_000;

export async function captureScreenshots(
  options: CaptureOptions,
): Promise<CaptureResult> {
  const { changes, routes, beforePort, afterPort, outputDir } = options;
  const dockerHost = getDockerHostAddress();

  const frontendChanges = changes.filter(
    (c) => c.category === "frontend" || c.category === "shared",
  );

  if (frontendChanges.length === 0) {
    return { screenshots: {} };
  }

  const screenshots: Record<string, ScreenshotEntry> = {};

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  try {
    for (const change of frontendChanges) {
      const affectedRoutes = detectAffectedRoutes(change.files, routes);
      const captures: CaptureEntry[] = [];
      const screenshotDir = join(outputDir, "screenshots", change.id);
      mkdirSync(screenshotDir, { recursive: true });

      for (const route of affectedRoutes) {
        const routeName = routeToFilename(route);
        const entry: CaptureEntry = { route };

        // Capture before screenshot
        try {
          const beforeFile = `${routeName}-before.png`;
          const beforePath = join(screenshotDir, beforeFile);
          await page.goto(`http://${dockerHost}:${beforePort}${route}`, {
            waitUntil: "networkidle",
            timeout: PAGE_TIMEOUT,
          });
          await page.screenshot({ path: beforePath, fullPage: true });
          entry.before = `screenshots/${change.id}/${beforeFile}`;
        } catch (err) {
          log.error(
            `Failed to capture before for ${route}: ${(err as Error).message}`,
          );
        }

        // Capture after screenshot
        try {
          const afterFile = `${routeName}-after.png`;
          const afterPath = join(screenshotDir, afterFile);
          await page.goto(`http://${dockerHost}:${afterPort}${route}`, {
            waitUntil: "networkidle",
            timeout: PAGE_TIMEOUT,
          });
          await page.screenshot({ path: afterPath, fullPage: true });
          entry.after = `screenshots/${change.id}/${afterFile}`;
        } catch (err) {
          log.error(
            `Failed to capture after for ${route}: ${(err as Error).message}`,
          );
        }

        captures.push(entry);
      }

      screenshots[change.id] = {
        affected_routes: affectedRoutes,
        captures,
      };
    }
  } finally {
    await browser.close();
  }

  const screenshotsPath = join(outputDir, "screenshots.json");
  writeFileSync(screenshotsPath, JSON.stringify(screenshots, null, 2));

  return { screenshots };
}
