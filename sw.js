// 問題やアプリを更新したら CACHE_NAME の番号を上げる
const CACHE_NAME = "alarmchan-v2.0.0";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./matcher.js",
  "./questions/core.js",
  "./questions/lpic201.js",
  "./questions/lpic202.js",
  "./manifest.webmanifest",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// 朝の電波が弱いときでもすぐ開けるよう、キャッシュを先に返して裏で更新する
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);
  event.waitUntil(network.then(() => undefined));

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        network.then((response) => {
          if (response) return response;
          if (request.mode === "navigate") return caches.match("./index.html");
          return Response.error();
        }),
    ),
  );
});

// アラームの通知をタップしたらアプリを前面に出す
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("./index.html");
    }),
  );
});
