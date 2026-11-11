import { cacheDecision } from "./sw-policy.mjs";

const CACHE = "zilla-milestones-v3";
const PRECACHE = [
  "/offline.html",
  "/favicon.ico",
  "/favicon-32.png",
  "/icon.svg",
  "/powered-by-zilla-ai.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const decision = cacheDecision({
    method: event.request.method,
    url: event.request.url,
    mode: event.request.mode,
    origin: self.location.origin,
  });
  if (decision === "cache-first") {
    event.respondWith(fromCache(event.request));
    return;
  }
  if (decision === "network-first-document") {
    event.respondWith(documentOrOffline(event.request));
  }
});

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    try {
      await cache.put(request, response.clone());
    } catch {
      // A cache write must not fail the response.
    }
  }
  return response;
}

async function offlineResponse() {
  const cache = await caches.open(CACHE);
  const offline = await cache.match("/offline.html");
  if (offline) return offline;
  return new Response("Zilla Milestones is offline.", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function documentOrOffline(request) {
  if (!self.navigator.onLine) return offlineResponse();
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) });
    if (response.ok && response.type === "basic" && new URL(request.url).pathname === "/offline.html") {
      const cache = await caches.open(CACHE);
      try {
        await cache.put("/offline.html", response.clone());
      } catch {
        // Keep the network response even if the offline copy cannot be refreshed.
      }
    }
    return response;
  } catch {
    return offlineResponse();
  }
}
