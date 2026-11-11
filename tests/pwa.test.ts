import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { columnLayout } from "@/lib/gantt-columns";
import { CANONICAL_ORIGIN, resolveSiteUrl, THEME_COLOR } from "@/lib/site";
import { cacheDecision } from "../public/sw-policy.mjs";

function decodePng(path: string): { width: number; height: number; pixels: Buffer } {
  const png = readFileSync(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let pos = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    chunks.push({ type, data: png.subarray(pos + 8, pos + 8 + length) });
    pos += 12 + length;
    if (type === "IEND") break;
  }
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const color = ihdr[9];
  expect(color).toBe(6);
  const bpp = 4;
  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
  const stride = width * bpp;
  const pixels = Buffer.alloc(width * height * bpp);
  let offset = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const paeth = left + up - upLeft;
        const nearest =
          Math.abs(paeth - left) <= Math.abs(paeth - up) && Math.abs(paeth - left) <= Math.abs(paeth - upLeft)
            ? left
            : Math.abs(paeth - up) <= Math.abs(paeth - upLeft)
              ? up
              : upLeft;
        row[x] = (row[x] + nearest) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported png filter ${filter}`);
      }
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  return { width, height, pixels };
}

function pixel(decoded: { width: number; pixels: Buffer }, x: number, y: number): number[] {
  const index = (y * decoded.width + x) * 4;
  return [...decoded.pixels.subarray(index, index + 4)];
}

function countPixels(decoded: { width: number; height: number; pixels: Buffer }, match: (px: number[]) => boolean): number {
  let count = 0;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      if (match(pixel(decoded, x, y))) count += 1;
    }
  }
  return count;
}

function maxOpaqueRadius(
  decoded: { width: number; height: number; pixels: Buffer },
  include: (px: number[]) => boolean = (px) => px[3] >= 8,
): number {
  const cx = (decoded.width - 1) / 2;
  const cy = (decoded.height - 1) / 2;
  let maxR = 0;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const sample = pixel(decoded, x, y);
      if (!include(sample)) continue;
      const radius = Math.hypot(x - cx, y - cy);
      if (radius > maxR) maxR = radius;
    }
  }
  return maxR;
}

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
  it("ships the favicon, apple touch icon, and install sizes from the Zilla AI mark", () => {
    expect(pngSize("public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/icon-maskable-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
    expect(pngSize("public/favicon-32.png")).toEqual({ width: 32, height: 32 });
    expect(readFileSync("public/icons/icon-512.png")).toEqual(readFileSync("brand/z-mark-ai-512.png"));
    expect(readFileSync("public/icons/icon-512.png")).not.toEqual(readFileSync("public/icons/icon-maskable-512.png"));
    expect(readFileSync("public/favicon-32.png")).toEqual(readFileSync("brand/z-mark-ai-light-32.png"));
    expect(readFileSync("public/icon.svg")).toEqual(readFileSync("brand/z-mark-ai.svg"));
    expect(readFileSync("public/powered-by-zilla-ai.svg")).toEqual(readFileSync("brand/powered-by-zilla-ai-inline-dark.svg"));

    const ico = readFileSync("public/favicon.ico");
    const light32 = readFileSync("brand/z-mark-ai-light-32.png");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt8(6)).toBe(32);
    expect(ico.readUInt8(7)).toBe(32);
    expect(ico.readUInt32LE(14)).toBe(light32.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22)).toEqual(light32);

    const svg = readFileSync("public/icon.svg", "utf8");
    expect(svg).toContain('aria-label="Zilla AI"');
    expect(svg).toContain("#C8102E");
    expect(svg).toContain("#FFFFFF");
    expect(svg).not.toContain("#d6f26a");
    expect(svg).not.toContain("M16 18h28");

    const dark = decodePng("public/icons/icon-512.png");
    const install = decodePng("public/icons/icon-192.png");
    const apple = decodePng("public/icons/apple-touch-icon.png");
    const maskable = decodePng("public/icons/icon-maskable-512.png");
    const nearWhite = (px: number[]) => px[0] > 230 && px[1] > 230 && px[2] > 230 && px[3] > 200;
    const nearInk = (px: number[]) => px[0] < 40 && px[1] < 40 && px[2] < 40 && px[3] > 200;
    expect(pixel(dark, 0, 0)[3]).toBe(0);
    expect(countPixels(dark, nearWhite)).toBeGreaterThan(500);
    expect(pixel(install, 0, 0)[3]).toBe(0);
    expect(countPixels(install, nearWhite)).toBeGreaterThan(80);
    expect(pixel(apple, 0, 0)[3]).toBe(0);
    expect(countPixels(apple, nearWhite)).toBeGreaterThan(40);
    expect(pixel(maskable, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(maskable, 511, 511)).toEqual([255, 255, 255, 255]);
    expect(countPixels(maskable, nearInk)).toBeGreaterThan(400);
    const markRadius = maxOpaqueRadius(maskable, (px) => px[0] < 250 || px[1] < 250 || px[2] < 250);
    expect(markRadius).toBeLessThanOrEqual(512 * 0.4);
    expect(markRadius).toBeGreaterThan(512 * 0.3);

    const script = readFileSync("scripts/generate-icons.mjs", "utf8");
    expect(script).toContain("z-mark-ai-512.png");
    expect(script).toContain("z-mark-ai-light-512.png");
    expect(script).toContain("z-mark-ai-light-32.png");
    expect(script).not.toContain("#d6f26a");
    expect(script).not.toContain("M16 18h28");
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
    expect(cacheDecision({ method: "GET", url: `${origin}/favicon-32.png`, mode: "same-origin", origin })).toBe(
      "cache-first",
    );
    expect(cacheDecision({ method: "GET", url: `${origin}/powered-by-zilla-ai.svg`, mode: "same-origin", origin })).toBe(
      "cache-first",
    );
    expect(cacheDecision({ method: "GET", url: `${origin}/`, mode: "navigate", origin })).toBe("network-first-document");
    expect(cacheDecision({ method: "GET", url: `${origin}/offline.html`, mode: "navigate", origin })).toBe(
      "network-first-document",
    );
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('const CACHE = "zilla-milestones-v3"');
    expect(worker).toContain('cache.match("/offline.html")');
    expect(worker).toContain("/favicon-32.png");
    expect(worker).toContain("/powered-by-zilla-ai.svg");
    expect(worker).toContain("navigator.onLine");
    const offline = readFileSync("public/offline.html", "utf8");
    expect(offline).toContain("You're offline");
    expect(offline).toContain('src="/icon.svg"');
    expect(offline).toContain("Zilla AI");
    expect(offline).not.toContain("M16 18h28");
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
    expect(layout).toContain("/favicon-32.png");
    expect(layout).toContain("prefers-color-scheme: light");
    expect(layout).toContain("prefers-color-scheme: dark");
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    expect(shell).toContain('src="/icon.svg"');
    expect(shell).toContain("Zilla Milestones");
    expect(shell).toContain("by Zilla Labs");
    expect(shell).toContain('src="/powered-by-zilla-ai.svg"');
    expect(shell).toContain("Powered by Zilla AI");
    expect(shell).not.toContain("Milestones module");
    const card = readFileSync("app/opengraph-image.tsx", "utf8");
    expect(card).toContain("public/icons/icon-512.png");
    expect(card).not.toContain(">Z<");
    expect(layout).not.toContain("vercel.app");
    expect(layout).not.toContain("localhost:3000");
    expect(readme).toContain("https://milestones.zillalabs.ai");
    expect(readme).not.toContain("vercel.app");
    expect(readFileSync("app/opengraph-image.tsx", "utf8")).toContain("milestones.zillalabs.ai");
  });
});
