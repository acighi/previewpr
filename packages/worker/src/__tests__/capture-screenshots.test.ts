import { describe, it, expect } from "vitest";
import {
  detectAffectedRoutes,
  matchFileToRoute,
  routeToFilename,
} from "../pipeline/capture-screenshots.js";

const allRoutes = ["/", "/dashboard", "/settings", "/profile"];

describe("detectAffectedRoutes", () => {
  it("returns all routes when a Layout file changes", () => {
    const files = ["src/components/Layout.tsx"];
    const result = detectAffectedRoutes(files, allRoutes);
    expect(result).toEqual(allRoutes);
  });

  it("returns all routes when a Nav file changes", () => {
    const files = ["src/components/Nav.tsx"];
    const result = detectAffectedRoutes(files, allRoutes);
    expect(result).toEqual(allRoutes);
  });

  it('returns "/" when Home.tsx changes', () => {
    const files = ["src/pages/Home.tsx"];
    const result = detectAffectedRoutes(files, allRoutes);
    expect(result).toEqual(["/"]);
  });

  it("returns specific route when matching file changes", () => {
    const files = ["src/pages/Dashboard.tsx"];
    const result = detectAffectedRoutes(files, allRoutes);
    expect(result).toEqual(["/dashboard"]);
  });

  it('falls back to "/" for unrecognized files', () => {
    const files = ["src/utils/helpers.ts"];
    const result = detectAffectedRoutes(files, allRoutes);
    expect(result).toEqual(["/"]);
  });
});

describe("matchFileToRoute", () => {
  it('maps "Home" to "/"', () => {
    expect(matchFileToRoute("Home", allRoutes)).toBe("/");
  });

  it('maps "Index" to "/"', () => {
    expect(matchFileToRoute("Index", allRoutes)).toBe("/");
  });

  it('maps "Dashboard" to "/dashboard"', () => {
    expect(matchFileToRoute("Dashboard", allRoutes)).toBe("/dashboard");
  });

  it("returns null for unmatched names", () => {
    expect(matchFileToRoute("RandomComponent", allRoutes)).toBeNull();
  });
});

describe("routeToFilename", () => {
  it('converts "/" to "index"', () => {
    expect(routeToFilename("/")).toBe("index");
  });

  it('converts "/dashboard" to "dashboard"', () => {
    expect(routeToFilename("/dashboard")).toBe("dashboard");
  });

  it('converts "/settings/profile" to "settings-profile"', () => {
    expect(routeToFilename("/settings/profile")).toBe("settings-profile");
  });
});
