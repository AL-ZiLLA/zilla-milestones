const STATIC_PREFIXES = ["/_next/static/", "/icons/"];

/**
 * @param {{ method?: string, url: string, mode?: string, origin: string }} input
 * @returns {"network-only" | "cache-first" | "network-first-document"}
 */
export function cacheDecision(input) {
  const method = input.method || "GET";
  if (method !== "GET") return "network-only";

  let url;
  try {
    url = new URL(input.url);
  } catch {
    return "network-only";
  }

  if (url.origin !== input.origin) return "network-only";

  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return "network-only";
  if (path === "/sw.js" || path === "/sw-policy.mjs") return "network-only";
  if (input.mode === "navigate" || path === "/offline.html") return "network-first-document";
  if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix)) || path === "/favicon.ico" || path === "/icon.svg") {
    return "cache-first";
  }
  return "network-only";
}
