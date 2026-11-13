/* =========================================================
   PDF 渲染管线（pdf.js）
   - 只传 PDF 文件，平板本地渲染 —— 体积小、放大不糊、能搜文字
   - 渲染结果转成 JPEG 塞回 <img>，原有缩放/框选/裁切逻辑一行不用改
   ========================================================= */
const PDFR = {
  doc: null,
  loading: null,
  scale: 2.0,          // 渲染倍率（pdf.js 的 scale 更精细，2.0 足够清晰）
  cache: new Map(),    // pageNum -> dataURL（LRU，最多留 8 页）
  maxCache: 8,
};

function pdfReady() { return typeof pdfjsLib !== 'undefined'; }

async function pdfLoad(url) {
  if (PDFR.doc) return PDFR.doc;
  if (PDFR.loading) return PDFR.loading;
  PDFR.loading = (async () => {
    if (!pdfReady()) throw new Error('pdf.js 没加载');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const buf = await fetch(url).then(r => {
      if (!r.ok) throw new Error('取 PDF 失败 HTTP ' + r.status);
      return r.arrayBuffer();
    });
    const doc = await pdfjsLib.getDocument({ data: buf, disableAutoFetch: true }).promise;
    PDFR.doc = doc;
    return doc;
  })();
  return PDFR.loading;
}

async function pdfPageCount(url) {
  const doc = await pdfLoad(url);
  return doc.numPages;
}

/* 渲染一页 → dataURL（带 LRU 缓存） */
async function pdfRender(n, scale) {
  const key = n + '@' + (scale || PDFR.scale);
  const hit = PDFR.cache.get(key);
  if (hit) return hit;

  const doc = await pdfLoad(PDFR.src);
  if (n < 1 || n > doc.numPages) throw new Error('页码越界');
  const page = await doc.getPage(n);

  // 按设备像素比挑倍率，保证平板上不糊
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const base = scale || PDFR.scale;
  const vp1 = page.getViewport({ scale: 1 });
  const targetW = Math.min(2200, Math.round(vp1.width * base * (dpr > 1.4 ? 1.15 : 1)));
  const s = targetW / vp1.width;
  const vp = page.getViewport({ scale: s });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();

  const url = canvas.toDataURL('image/jpeg', 0.86);
  canvas.width = canvas.height = 0;

  if (PDFR.cache.size >= PDFR.maxCache) {
    const firstKey = PDFR.cache.keys().next().value;
    PDFR.cache.delete(firstKey);
  }
  PDFR.cache.set(key, url);
  return url;
}

/* 用 pdf.js 换掉 pageUrl 的取图逻辑；返回 null 表示走老路
   带超时保护：pdf.js 起不来（worker 被禁、文件太大）就自动回退到预渲染图片 */
async function pdfPageImage(n) {
  if (!PDFR.src) return null;
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('pdf 渲染超时')), PDFR.timeout || 5000));
  return Promise.race([pdfRender(n), timeout]);
}

/* 预渲染相邻页（后台，不占主线程太久） */
function pdfPrefetch(list) {
  if (!PDFR.src) return;
  (list || []).forEach(n => {
    if (!n || PDFR.cache.has(n + '@' + PDFR.scale)) return;
    setTimeout(() => { pdfRender(n).catch(() => { }); }, 120);
  });
}
