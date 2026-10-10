// 暗記シート service worker
// キャッシュ名のバージョンを上げると、古いキャッシュが破棄されて更新が反映される
const CACHE_VERSION = 'anki-sheet-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

// PDF.js はアプリの中心機能なので、初回アクセス時にキャッシュしてオフラインでも
// PDFを開けるようにする
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // アプリ本体は失敗したらインストール自体を失敗させる
      await cache.addAll(APP_SHELL);
      // CDNアセットは失敗しても致命的にしない(オンライン初回時にランタイムキャッシュされる)
      await Promise.all(
        CDN_ASSETS.map((url) =>
          cache.add(url).catch(() => {})
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isAppFile = url.origin === self.location.origin;
  const isPdfJsCdn = url.href.startsWith('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/');

  if (!isAppFile && !isPdfJsCdn) return; // それ以外は素通し(フォント等)

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req, { ignoreSearch: true });

      // キャッシュ優先、裏側でネットワークからも更新を試みる(stale-while-revalidate)
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        networkFetch; // バックグラウンド更新は待たずに返す
        return cached;
      }

      const networkRes = await networkFetch;
      if (networkRes) return networkRes;

      // オフラインかつ未キャッシュの場合、アプリ本体のナビゲーションは index.html で代替
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('オフラインのため読み込めませんでした。', {
        status: 503,
        statusText: 'Offline'
      });
    })()
  );
});
