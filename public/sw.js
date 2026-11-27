const CACHE_NAME = 'tagin-app-shell-v3';
const APP_SHELL = ['/','/index.html','/manifest.webmanifest','/tagin-logo.svg','/qrcode.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    const response = await fetch('/index.html', {cache:'no-store'});
    if (response.ok) {
      const html = await response.text();
      const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map((match) => match[1]);
      await Promise.all(assets.map(async (asset) => {
        try {
          const assetResponse = await fetch(asset, {cache:'no-store'});
          if (assetResponse.ok) await cache.put(asset, assetResponse);
        } catch { /* The app remains usable online if an optional asset cannot be precached. */ }
      }));
      await cache.put('/index.html', new Response(html, {headers:{'Content-Type':'text/html; charset=utf-8'}}));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('tagin-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/functions/') || url.pathname.startsWith('/storage/')) return;

  // Always prefer the current deployed app shell and assets. Older cache-first
  // responses can otherwise pair a new HTML file with an obsolete CSS bundle.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, {cache:'no-store'});
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await cache.match(request))
        || (request.mode === 'navigate' ? (await cache.match('/index.html')) : null)
        || Response.error();
    }
  })());
});
