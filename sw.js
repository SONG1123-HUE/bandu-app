/* 教材伴读 离线全站缓存 */
const CACHE = 'bandu-full-v1';
const CORE = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'books.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(u => c.add(u).catch(() => {})));
    let books = [];
    try { books = await fetch('books.json').then(r => r.json()); } catch (e) {}
    let done = 0;
    let total = books.reduce((s, b) => s + (b.pages || 0), 0);
    const notify = (type, extra) => {
      self.clients.matchAll().then(cs => cs.forEach(cl => cl.postMessage(Object.assign({ type, done, total }, extra || {}))));
    };
    notify('progress');
    for (const b of books) {
      const key = b.key;
      const tocUrl = 'toc/' + encodeURIComponent(b.id) + '.json';
      const notesUrl = 'notes/' + encodeURIComponent(b.id) + '.json';
      await c.add(tocUrl).catch(() => {});
      await c.add(notesUrl).catch(() => {});
      for (let i = 1; i <= b.pages; i += 20) {
        const batch = [];
        for (let j = i; j < Math.min(i + 20, b.pages + 1); j++) {
          batch.push('pages/' + key + '/' + String(j).padStart(4, '0') + '.jpg');
        }
        await Promise.all(batch.map(u => c.add(u).catch(() => {})));
        done += batch.length;
        notify('progress');
      }
    }
    notify('cached');
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // 模型 API 不拦
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit))
  );
});
