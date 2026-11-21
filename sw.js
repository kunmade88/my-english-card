/* 오프라인 캐시. 파일을 바꾸면 VERSION 을 올려 주세요. */
const VERSION = 'poly-v14-4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  './assets/app.css', './assets/chart.umd.js', './assets/speak.js', './assets/extract.js',
  './assets/inter-400.woff2', './assets/inter-600.woff2', './assets/inter-800.woff2'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 캐시를 먼저 보여주고, 온라인이면 뒤에서 새 버전으로 갱신
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => {
    const net = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});
