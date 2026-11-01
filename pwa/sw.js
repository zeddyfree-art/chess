// The service worker that lets the installed app (and the site) start without a network.
// - Pages: the network first, so a new version arrives as soon as it is published; offline, the last one saved.
// - Everything else of the app (scripts, styles, Stockfish, sounds, icons): from the cache at once, refreshed in the
//   background. Each published version gets its own cache, and older ones are removed.
// - Not cached: version.json (how an open tab notices a new version), the Maia model (the app keeps it in its own
//   database), and anything from other sites (Lichess, Google), which always goes to the network.
const CACHE = 'repertoire-__BUILD__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png', '__PRECACHE__'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('repertoire-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('.onnx')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./', { ignoreVary: true }).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreVary: true }).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? fresh;
      }),
    ),
  );
});
