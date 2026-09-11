const CACHE = "ziya-v10";
const STROKE_NAME_AUDIO = [
  "heng-zhe-zhe-pie", "shu-wan", "heng-zhe", "heng-xie-gou", "heng", "na", "heng-zhe-gou",
  "shu", "shu-gou", "dian", "pie", "pie-zhe", "shu-zhe-pie", "shu-zhe-zhe",
  "heng-zhe-zhe-zhe-gou", "heng-pie-wan-gou", "shu-zhe-zhe-gou", "ti", "wan-gou", "xie-gou",
  "wo-gou", "heng-zhe-zhe", "heng-zhe-wan", "heng-pie", "heng-gou", "heng-zhe-ti",
  "heng-zhe-zhe-zhe", "shu-ti", "pie-dian", "shu-wan-gou",
].map((name) => `stroke-name-${name}`);
const PROMPT_AUDIO = [
  "intro-reading", "look-start", "look-complete", "practice-start", "mistake", "correct", "complete",
  ...Array.from({ length: 5 }, (_, index) => `tone-${index + 1}`),
  ...Array.from({ length: 30 }, (_, index) => `total-strokes-${String(index + 1).padStart(2, "0")}`),
  ...Array.from({ length: 30 }, (_, index) => `stroke-${String(index + 1).padStart(2, "0")}`),
  ...STROKE_NAME_AUDIO,
].map((name) => `/audio/${name}.m4a`);
const CORE = [
  "/", "/manifest.webmanifest", "/favicon.svg",
  "/hanzi-data/永.json", "/hanzi-data/日.json", "/hanzi-data/月.json", "/hanzi-data/山.json",
  "/hanzi-data/川.json", "/hanzi-data/天.json", "/hanzi-data/地.json", "/hanzi-data/人.json",
  "/hanzi-data/春.json", "/hanzi-data/风.json", "/hanzi-data/雨.json", "/hanzi-data/大.json",
  "/hanzi-data/小.json", "/hanzi-data/多.json", "/hanzi-data/少.json",
  ...PROMPT_AUDIO,
];
self.addEventListener("install", (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()),
));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});
