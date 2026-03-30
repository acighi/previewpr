import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createLogger } from "@previewpr/shared";

// --- Types ---

interface CaptureEntry {
  route: string;
  before?: string;
  after?: string;
  diff?: string;
}

interface ScreenshotEntry {
  affected_routes: string[];
  captures: CaptureEntry[];
}

type ScreenshotsJson = Record<string, ScreenshotEntry>;

const log = createLogger();

// --- Image helpers ---

export function padImage(
  img: PNG,
  targetWidth: number,
  targetHeight: number,
): PNG {
  if (img.width === targetWidth && img.height === targetHeight) {
    return img;
  }
  const padded = new PNG({
    width: targetWidth,
    height: targetHeight,
    fill: true,
  });
  PNG.bitblt(img, padded, 0, 0, img.width, img.height, 0, 0);
  return padded;
}

function loadPng(filePath: string): PNG {
  const buffer = readFileSync(filePath);
  return PNG.sync.read(buffer);
}

function savePng(filePath: string, img: PNG): void {
  const buffer = PNG.sync.write(img);
  writeFileSync(filePath, buffer);
}

// --- Diff generation ---

function generateDiffForCapture(
  capture: CaptureEntry,
  outputDir: string,
): { diffPath: string; diffPixels: number } | null {
  if (!capture.before || !capture.after) {
    log.info(`Skipping ${capture.route}: missing before or after`);
    return null;
  }

  const beforePath = join(outputDir, capture.before);
  const afterPath = join(outputDir, capture.after);

  if (!existsSync(beforePath) || !existsSync(afterPath)) {
    log.info(`Skipping ${capture.route}: file not found`);
    return null;
  }

  let beforeImg = loadPng(beforePath);
  let afterImg = loadPng(afterPath);

  const maxWidth = Math.max(beforeImg.width, afterImg.width);
  const maxHeight = Math.max(beforeImg.height, afterImg.height);

  beforeImg = padImage(beforeImg, maxWidth, maxHeight);
  afterImg = padImage(afterImg, maxWidth, maxHeight);

  const diffImg = new PNG({ width: maxWidth, height: maxHeight });

  const diffPixels = pixelmatch(
    beforeImg.data,
    afterImg.data,
    diffImg.data,
    maxWidth,
    maxHeight,
    { threshold: 0.1 },
  );

  const routeName =
    capture.route === "/"
      ? "index"
      : capture.route.replace(/^\//, "").replace(/\//g, "-");

  const beforeDir = beforePath.substring(0, beforePath.lastIndexOf("/"));
  const diffFilename = `${routeName}-diff.png`;
  const diffFullPath = join(beforeDir, diffFilename);

  savePng(diffFullPath, diffImg);

  const relativePath = capture.before.replace(
    /[^/]+-before\.png$/,
    diffFilename,
  );

  return { diffPath: relativePath, diffPixels };
}

function processChange(
  changeId: string,
  entry: ScreenshotEntry,
  outputDir: string,
): CaptureEntry[] {
  log.info(`Processing diffs for ${changeId}`);
  const updatedCaptures: CaptureEntry[] = [];

  for (const capture of entry.captures) {
    const result = generateDiffForCapture(capture, outputDir);
    if (result) {
      log.info(`${capture.route}: ${result.diffPixels} diff pixels`);
      updatedCaptures.push({ ...capture, diff: result.diffPath });
    } else {
      updatedCaptures.push(capture);
    }
  }

  return updatedCaptures;
}

// --- Main ---

export async function generateDiffs(
  screenshotsJsonPath: string,
  outputDir: string,
): Promise<void> {
  if (!existsSync(screenshotsJsonPath)) {
    log.info("No screenshots.json found, nothing to diff");
    return;
  }

  const screenshots: ScreenshotsJson = JSON.parse(
    readFileSync(screenshotsJsonPath, "utf-8"),
  );

  for (const [changeId, entry] of Object.entries(screenshots)) {
    const updatedCaptures = processChange(changeId, entry, outputDir);
    screenshots[changeId] = {
      ...entry,
      captures: updatedCaptures,
    };
  }

  writeFileSync(screenshotsJsonPath, JSON.stringify(screenshots, null, 2));
  log.info("Updated screenshots.json with diff paths");
}
