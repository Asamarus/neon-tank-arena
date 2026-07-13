/* global NTA_BUILD */
'use strict';

importScripts('./version.js');

const BUILD = self.NTA_BUILD;
const VERSION = BUILD.version;
const CACHE_PREFIX = BUILD.cachePrefix || 'neon-tank-arena';
const CORE_CACHE = `${CACHE_PREFIX}-core-v${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v${VERSION}`;
const OWNED_CACHE_PREFIX = `${CACHE_PREFIX}-`;

const APP_SHELL = [
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './offline.html',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './screenshots/game-wide.png',
  './screenshots/game-mobile.png',
  './icons/apple-touch-icon.png',
  './icons/icon-48.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
];

/**
 * Adds Vite's content-hashed module and stylesheet URLs from the built HTML.
 * This keeps the service worker independent from a particular asset hash.
 */
async function cacheBuiltAssets(cache) {
  const indexResponse = await cache.match('./index.html');
  if (!indexResponse) return;
  const markup = await indexResponse.text();
  const assetUrls = [...markup.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], self.registration.scope))
    .filter((url) => url.origin === self.location.origin && url.pathname.includes('/assets/'))
    .map((url) => url.href);
  await cache.addAll([...new Set(assetUrls)]);
}

/** Return the configured endpoint, falling back to same-origin version.json. */
function getVersionEndpoint() {
  const configured = String(BUILD.remoteVersionUrl || '');
  if (!configured) {
    return new URL(BUILD.localVersionUrl || './version.json', self.registration.scope).href;
  }
  return configured;
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

/** Install is transactional: failure leaves the old active worker/cache intact. */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    await cache.addAll(APP_SHELL);
    await cacheBuiltAssets(cache);
  })());
});

/** Activate only after the new shell exists, then discard obsolete app caches. */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(OWNED_CACHE_PREFIX) && key !== CORE_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );

    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }

    await self.clients.claim();
    await broadcast({ type: 'SW_ACTIVATED', version: VERSION });
  })());
});

/** Cache-first app shell keeps one coherent build active throughout a session. */
async function appShellResponse(request) {
  const cache = await caches.open(CORE_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Unknown same-origin assets use network first and become runtime-offline data. */
async function networkFirst(request, preloadResponse) {
  const runtime = await caches.open(RUNTIME_CACHE);
  try {
    const response = (await preloadResponse) || await fetch(request);
    if (response?.ok) await runtime.put(request, response.clone());
    return response;
  } catch (error) {
    return (await runtime.match(request)) || (await caches.match(request, { ignoreSearch: true }));
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // The deployment marker must always bypass Cache Storage and the HTTP cache.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const core = await caches.open(CORE_CACHE);
      const cachedIndex = await core.match('./index.html') || await core.match('./');
      if (cachedIndex) return cachedIndex;
      const response = await networkFirst(request, event.preloadResponse);
      return response || (await caches.match('./offline.html')) || Response.error();
    })());
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  const relativeName = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\//, '');
  const relativePath = `./${relativeName}`;
  const isShellAsset = APP_SHELL.includes(relativePath);
  event.respondWith(isShellAsset
    ? appShellResponse(request)
    : networkFirst(request, Promise.resolve(null))
  );
});

/** Compare server metadata without disturbing the current playable cache. */
async function checkRemoteVersion() {
  try {
    const response = await fetch(getVersionEndpoint(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const remote = await response.json();
    if (remote?.version && remote.version !== VERSION) {
      await broadcast({ type: 'UPDATE_AVAILABLE', version: remote.version });
      await self.registration.update();
    }
  } catch (_) {
    // Offline and CORS failures are expected; the current cache stays valid.
  }
}

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'CHECK_REMOTE_VERSION') {
    event.waitUntil(checkRemoteVersion());
  } else if (type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'SW_VERSION', version: VERSION });
  }
});
