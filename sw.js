// サービスワーカー: すべての資材を先読みして、電波が届かない場所でも動くようにする。
//
// ★ 内容を更新したら必ず VERSION を変えること。
//    VERSION が変わらないと、利用者の端末に古い運賃データが残り続ける。
//    tools/build_network.py を実行すると、この行は自動で書き換わる。
const VERSION = "2026-09-02-1";

const CACHE = "toei-muryo-" + VERSION;

// scope からの相対パスで指定する(GitHub Pages などのサブパス配信に対応するため)
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./fares.js",
  "./router.js",
  "./app.js",
  "./mshiki.js",
  "./network.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./rayv_toruken_kiyaku_policy.html"
];

self.addEventListener("install", (e) => {
  // すぐには切り替えない。利用者が検索中に画面が入れ替わるのを避けるため、
  // 新版の準備ができたことを画面側に知らせて、更新するかどうかを選んでもらう。
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n.startsWith("toei-muryo-") && n !== CACHE)
           .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      // 取得できたものは次回のために取っておく
      if (res && res.ok && res.type === "basic") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      // オフラインで未キャッシュのページを開こうとした場合はトップを返す
      if (req.mode === "navigate") {
        const shell = await caches.match("./index.html");
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// 画面側から「今すぐ更新する」と言われたら切り替える
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
