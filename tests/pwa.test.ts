import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { columnLayout } from "@/lib/gantt-columns";
import { CANONICAL_ORIGIN, resolveSiteUrl, THEME_COLOR } from "@/lib/site";
import { cacheDecision } from "../public/sw-policy.mjs";

const origin = CANONICAL_ORIGIN;

function pngSize(path: string): { width: number; height: number } {
  const png = readFileSync(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.toString("ascii", 12, 16)).toBe("IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("canonical origin", () => {
  it("uses the live milestones host when the public site env is unset", () => {
    expect(resolveSiteUrl("").href).toBe(`${CANONICAL_ORIGIN}/`);
    expect(resolveSiteUrl("   ").href).toBe(`${CANONICAL_ORIGIN}/`);
    expect(resolveSiteUrl(undefined).href).toBe(`${CANONICAL_ORIGIN}/`);
  });

  it("keeps an explicit NEXT_PUBLIC_SITE_URL override", () => {
    expect(resolveSiteUrl("https://preview.example").href).toBe("https://preview.example/");
  });
});

describe("web app manifest", () => {
  it("is installable and matches the product colors", () => {
    const webApp = manifest();
    expect(webApp.name).toBe("Zilla Milestones");
    expect(webApp.short_name).toBe("Milestones");
    expect(webApp.start_url).toBe("/");
    expect(webApp.display).toBe("standalone");
    expect(webApp.theme_color).toBe(THEME_COLOR);
    expect(webApp.background_color).toBe("#07110e");
    expect(webApp.prefer_related_applications).toBe(false);
    expect(webApp.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ src: "/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });
});

describe("icons", () => {
  it("ships the favicon, apple touch icon, and install sizes from the brand mark", () => {
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(readFileSync("public/icons/icon-512.png")).not.toEqual(readFileSync("public/icons/icon-maskable-512.png"));
    const ico = readFileSync("public/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    const svg = readFileSync("public/icon.svg", "utf8");
    expect(svg).toContain("#d6f26a");
    expect(svg).toContain("#07110e");
  });
});

describe("service worker cache policy", () => {
  it("keeps API, webhooks, chat, and every non-GET request on the network", () => {
    const networkOnly = [
      { method: "POST", url: `${origin}/api/paypal/webhook`, mode: "cors" },
      { method: "POST", url: `${origin}/api/chat`, mode: "cors" },
      { method: "GET", url: `${origin}/api/project`, mode: "cors" },
      { method: "DELETE", url: `${origin}/api/project`, mode: "cors" },
      { method: "POST", url: `${origin}/api/phases/invoice`, mode: "cors" },
      { method: "GET", url: `${origin}/api/phases/sync`, mode: "cors" },
      { method: "GET", url: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices", mode: "cors" },
      { method: "GET", url: `${origin}/sw.js`, mode: "same-origin" },
    ];
    for (const request of networkOnly) {
      expect(cacheDecision({ ...request, origin }), request.url).toBe("network-only");
    }
  });

  it("caches the static shell and falls back to the offline page for navigations", () => {
    expect(cacheDecision({ method: "GET", url: `${origin}/_next/static/chunks/app.js`, mode: "same-origin", origin })).toBe(
      "cache-first",
    );
    expect(cacheDecision({ method: "GET", url: `${origin}/icons/icon-512.png`, mode: "same-origin", origin })).toBe(
      "cache-first",
    );
    expect(cacheDecision({ method: "GET", url: `${origin}/`, mode: "navigate", origin })).toBe("network-first-document");
    expect(cacheDecision({ method: "GET", url: `${origin}/offline.html`, mode: "navigate", origin })).toBe(
      "network-first-document",
    );
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('cache.match("/offline.html")');
    expect(worker).toContain("navigator.onLine");
    expect(readFileSync("public/offline.html", "utf8")).toContain("You're offline");
  });
});

describe("phone gantt columns", () => {
  it("keeps the desktop column widths and compacts the phone layout", () => {
    expect(columnLayout(1440)).toMatchObject({ name: 220, date: 108, locked: 704, hidden: [] });
    expect(columnLayout(1100)).toMatchObject({ name: 210, date: 100, locked: 666, hidden: [] });
    expect(columnLayout(936)).toMatchObject({ name: 204, date: 90, locked: 640, hidden: [] });
    expect(columnLayout(390).hidden).toEqual(["start", "finish", "amount", "payment", "gate"]);
    expect(columnLayout(390).locked).toBeLessThan(220);
  });
});

describe("canonical copy", () => {
  it("points metadata and the readme at the live host", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    const readme = readFileSync("README.md", "utf8");
    expect(layout).toContain("resolveSiteUrl()");
    expect(layout).toContain('title: "Zilla Milestones"');
    expect(layout).toContain("apple-mobile-web-app-capable");
    expect(layout).toContain('themeColor: THEME_COLOR');
    expect(layout).not.toContain("vercel.app");
    expect(layout).not.toContain("localhost:3000");
    expect(readme).toContain("https://milestones.zillalabs.ai");
    expect(readme).not.toContain("vercel.app");
    expect(readFileSync("app/opengraph-image.tsx", "utf8")).toContain("milestones.zillalabs.ai");
  });
});
