'use strict';

/* =========================================================
   教材伴读 · 前端
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---- 离线版（make_offline.py 生成的目录，平板直接打开）---- */
const OFF = window.__OFFLINE_BOOK__ || null;
const OFF_API = 'https://api.deepseek.com/v1';
function offNotesKey() {
  if (!OFF) return 'jb_off_notes_';
  const who = (OFF.multi && S.book) ? S.book.id : OFF.id;
  return 'jb_off_notes_' + who;
}
function offSettings() {
  try { return JSON.parse(localStorage.getItem('jb_off_settings') || '{}'); } catch (e) { return {}; }
}

const E = {
  stage: $('#stage'), wrap: $('#pagewrap'), img: $('#pageimg'), img2: $('#pageimg2'), ink: $('#ink'),
  selbox: $('#selbox'), empty: $('#empty'), booksPath: $('#booksPath'),
  topbar: $('#topbar'), bookName: $('#bookName'), pager: $('#pager'),
  pageInput: $('#pageInput'), pageTotal: $('#pageTotal'),
  panel: $('#panel'), panelHead: $('#panelHead'), panelTitle: $('#panelTitle'),
  msgs: $('#msgs'), q: $('#q'), send: $('#send'), ctxLabel: $('#ctxLabel'), ctxClear: $('#ctxClear'),
  ctxChip: $('#ctxChip'), chips: $('#chips'),
  drawer: $('#drawer'), dlist: $('#dlist'), dCount: $('#dCount'),
  tocDrawer: $('#tocDrawer'), tocList: $('#tocList'), tocCount: $('#tocCount'),
  tocOffset: $('#tocOffset'), tocScanBtn: $('#tocScanBtn'), btnToc: $('#btnToc'),
  setModal: $('#setModal'), booksModal: $('#booksModal'), bookList: $('#bookList'), bkCount: $('#bkCount'),
  toast: $('#toast'),
  progressBar: $('#progressBar'), zoombadge: $('#zoombadge'), pageLoading: $('#pageloading'),
  btnTheme: $('#btnTheme'), sTempVal: $('#sTempVal'),
};

const S = {
  books: [], book: null, page: 1, pages: 0,
  natW: 0, natH: 0, scale: 1, fit: 1, tx: 0, ty: 0,
  mode: 'read', notes: { pages: {} }, region: null, busy: false,
  stroke: null, settings: {}, uiHidden: false, loadSeq: 0, lastToggleAt: 0,
  activeMark: null,
  double: localStorage.getItem('jb_double') === '1',
  fitMode: localStorage.getItem('jb_fitmode') || 'height',
};
function wrapW() { return S.natW * (S.double ? 2 : 1); }

/* 页图分辨率：2 倍屏用 3.0x，普通屏 2.6x（服务端按比例分缓存） */
const PAGE_SCALE = (window.devicePixelRatio || 1) >= 1.5 ? '3.0' : '2.6';
function pageUrl(id, n) {
  if (OFF) {
    if (OFF.multi) {
      const b = S.books.find(x => x.id === id || x.title === id);
      const key = (b && b.key) || bookKey(id);
      return 'pages/' + key + '/' + String(n).padStart(4, '0') + '.jpg';
    }
    return 'pages/' + String(n).padStart(4, '0') + '.jpg';
  }
  return '/page/' + encodeURIComponent(id) + '/' + n + '?s=' + PAGE_SCALE;
}
function thumbUrl(id, n) {
  if (OFF) return pageUrl(id, n);
  return '/thumb/' + encodeURIComponent(id) + '/' + n;
}
/* 目录名 -> 安全的文件夹名（与 make_offline_all.py 的 safe_dir 一致，去掉 .pdf） */
function bookKey(id) {
  return String(id).replace(/\.(pdf|PDF)$/, "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 48);
}

const ptrs = new Map();
let gesture = null;
let saveTimer = null;
let lastTap = 0;
let tapTimer = null;
let plTimer = null;

/* ------------------------------------------------ utils */
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* ------------------------------------------------ 轻量 Markdown */
/* 轻量公式排版：只处理 $...$ 里常见的上下标与 \frac，不引第三方库 */
function renderMath(tex) {
  let t = tex;
  t = t.replace(/\\frac\{([^{}]{1,40})\}\{([^{}]{1,40})\}/g,
    '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>');
  t = t.replace(/\\sqrt\{([^{}]{1,40})\}/g, '√<span class="rad">$1</span>');
  t = t.replace(/\^\{([^{}]{1,24})\}/g, '<sup>$1</sup>')
       .replace(/_\{([^{}]{1,24})\}/g, '<sub>$1</sub>')
       .replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>')
       .replace(/_([A-Za-z0-9])/g, '<sub>$1</sub>');
  t = t.replace(/\\cdot/g, '·').replace(/\\times/g, '×').replace(/\\pm/g, '±')
       .replace(/\\approx/g, '≈').replace(/\\le/g, '≤').replace(/\\ge/g, '≥')
       .replace(/\\beta/g, 'β').replace(/\\alpha/g, 'α').replace(/\\omega/g, 'ω')
       .replace(/\\theta/g, 'θ').replace(/\\pi/g, 'π').replace(/\\mu/g, 'μ')
       .replace(/\\Omega/g, 'Ω').replace(/\\infty/g, '∞');
  return t;
}
function inlineMd(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\$([^$\n]{1,160})\$/g, (_, tex) => '<span class="math">' + renderMath(tex) + '</span>');
}
function md(t) {
  const src = esc(String(t || ''));
  const lines = src.split('\n');
  let out = '';
  let listKind = null;
  const closeList = () => { if (listKind) { out += '</' + listKind + '>'; listKind = null; } };
  const openList = (k) => { if (listKind !== k) { closeList(); out += '<' + k + ' class="md-list">'; listKind = k; } };

  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    let m;
    if ((m = ln.match(/^\s*[-*·]\s+(.+)$/))) { openList('ul'); out += '<li>' + inlineMd(m[1]) + '</li>'; continue; }
    if ((m = ln.match(/^\s*(\d{1,2})[.、)]\s+(.+)$/))) { openList('ol'); out += '<li>' + inlineMd(m[2]) + '</li>'; continue; }
    closeList();
    if ((m = ln.match(/^\s*#{1,4}\s*(.+)$/))) { out += '<div class="md-h">' + inlineMd(m[1]) + '</div>'; continue; }
    if ((m = ln.match(/^\s*&gt;\s?(.*)$/))) { out += '<div class="md-q">' + inlineMd(m[1]) + '</div>'; continue; }
    if (!ln.trim()) { out += '<div class="md-gap"></div>'; continue; }
    out += '<div class="md-p">' + inlineMd(ln) + '</div>';
  }
  closeList();
  return out;
}
function toast(msg, ms = 1800) {
  E.toast.textContent = msg;
  E.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => E.toast.classList.remove('show'), ms);
}
function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('图片加载失败 ' + url));
    im.src = url;
  });
}

/* ------------------------------------------------ page data */
function pd(n = S.page) {
  const k = String(n);
  const d = S.notes.pages[k] || (S.notes.pages[k] = {});
  if (!Array.isArray(d.strokes)) d.strokes = [];
  if (!Array.isArray(d.marks)) d.marks = [];
  if (!Array.isArray(d.chats)) d.chats = [];
  return d;
}
function saveNotes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.book) return;
    // 打上时间戳：云同步靠它判断哪边更新
    const cur = S.notes.pages && S.notes.pages[String(S.page)];
    if (cur) cur._t = Date.now();
    if (OFF) {
      try { localStorage.setItem(offNotesKey(), JSON.stringify(S.notes)); } catch (e) { }
      if (typeof scheduleSync === 'function') scheduleSync();
      return;
    }
    fetch('/api/notes?book=' + encodeURIComponent(S.book.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(S.notes),
    }).then(() => { if (typeof scheduleSync === 'function') scheduleSync(); }).catch(() => { });
  }, 600);
}

/* ------------------------------------------------ transform */
function applyT() {
  E.wrap.style.transform = `translate(${S.tx}px,${S.ty}px) scale(${S.scale})`;
  if (S.region) placeSelX();
}
function stageRect() { return E.stage.getBoundingClientRect(); }
function fit() {
  const r = stageRect();
  if (!S.natW || !r.width) return;
  const hidden = S.uiHidden;
  const padTop = hidden ? 10 : 62;      // 给顶栏留位
  const padBottom = hidden ? 10 : 84;   // 给页码胶囊留位
  const padX = hidden ? 8 : 14;
  const availW = Math.max(60, r.width - padX * 2);
  const availH = Math.max(60, r.height - padTop - padBottom);
  const W = wrapW();
  const byW = availW / W, byH = availH / S.natH;
  S.fit = S.fitMode === 'width' ? byW : Math.min(byW, byH);
  S.scale = S.fit;
  S.tx = padX + (availW - W * S.fit) / 2;
  S.ty = (S.fitMode === 'width' && S.natH * S.fit > availH)
    ? padTop
    : padTop + (availH - S.natH * S.fit) / 2;
  applyT();
}
function clampT() {
  const r = stageRect();
  const w = wrapW() * S.scale, h = S.natH * S.scale;
  S.tx = w <= r.width ? (r.width - w) / 2 : clamp(S.tx, r.width - w, 0);
  S.ty = h <= r.height ? (r.height - h) / 2 : clamp(S.ty, r.height - h, 0);
}
function zoomAt(cx, cy, ns) {
  ns = clamp(ns, S.fit * 0.9, S.fit * 9);
  const f = ns / S.scale;
  S.tx = cx - (cx - S.tx) * f;
  S.ty = cy - (cy - S.ty) * f;
  S.scale = ns;
  clampT(); applyT();
}

/* ------------------------------------------------ ink + marks */
function redraw() {
  const ctx = E.ink.getContext('2d');
  const W = E.ink.width, H = E.ink.height;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  const d = pd();

  // 疑点框（未问 = 琥珀虚线，已问 = 蓝色实线）
  const lw = Math.max(3, Math.min(W, H) * 0.0045);
  d.marks.forEach(m => {
    const asked = !!m.question;
    ctx.lineWidth = lw;
    ctx.setLineDash(asked ? [] : [lw * 2.2, lw * 1.6]);
    ctx.strokeStyle = asked ? 'rgba(76,141,255,.95)' : 'rgba(255,176,46,.95)';
    ctx.fillStyle = asked ? 'rgba(76,141,255,.10)' : 'rgba(255,176,46,.10)';
    ctx.beginPath();
    ctx.rect(m.x * W, m.y * H, m.w * W, m.h * H);
    ctx.fill(); ctx.stroke();
  });
  ctx.setLineDash([]);

  // 手写笔迹
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.0032);
  d.strokes.forEach(st => {
    if (!st || !st.pts || !st.pts.length) return;
    ctx.beginPath();
    st.pts.forEach((p, i) => {
      const x = p.x * W, y = p.y * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (st.pts.length === 1) ctx.lineTo(st.pts[0].x * W + .1, st.pts[0].y * H + .1);
    ctx.stroke();
  });
}
const drawInk = redraw;
const renderMarks = redraw;
function cropFrom(imgEl, nx, ny, nw, nh, maxSide) {
  const sw = Math.max(1, Math.round(imgEl.naturalWidth * nw));
  const sh = Math.max(1, Math.round(imgEl.naturalHeight * nh));
  const sx = Math.round(imgEl.naturalWidth * nx);
  const sy = Math.round(imgEl.naturalHeight * ny);
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}

/* ------------------------------------------------ book / page */
async function loadBooks() {
  if (OFF) {
    if (OFF.multi) {
      try {
        const list = await fetch('books.json').then(x => x.json());
        S.books = (list || []).filter(b => b && b.id);
      } catch (e) { S.books = []; }
    } else {
      S.books = [{ id: OFF.id, title: OFF.id, pages: OFF.pages }];
    }
  } else {
    const r = await fetch('/api/books').then(x => x.json());
    S.books = r || [];
  }  renderBookList();
  if (!S.books.length) {
    E.empty.hidden = false;
    E.panel.classList.add('hidden');
    E.topbar.classList.add('hide');
    return;
  }
  E.empty.hidden = true;
  E.topbar.classList.remove('hide');
  const last = localStorage.getItem('jb_last');
  const pick = S.books.find(b => b.id === last) || S.books[0];
  if (!S.book) await openBook(pick);
  else E.topbar.classList.remove('hide');
}
function renderBookList() {
  E.bookList.innerHTML = '';
  if (E.bkCount) E.bkCount.textContent = S.books.length + ' 本';
  if (!S.books.length) {
    E.bookList.innerHTML = '<div class="bk-empty">books 文件夹里还没有书</div>';
    return;
  }
  S.books.forEach(b => {
    const cur = S.book && S.book.id === b.id;
    const read = parseInt(localStorage.getItem('jb_page_' + b.id) || '0', 10) || 0;
    const pct = b.pages ? clamp((read / b.pages) * 100, 0, 100) : 0;

    const d = document.createElement('div');
    d.className = 'bitem' + (cur ? ' cur' : '');
    d.innerHTML = `
      <div class="cover">
        <div class="ph">📖</div>
        <span class="badge">${b.kind === 'pdf' ? 'PDF' : 'IMG'} · ${b.pages} 页</span>
        ${read > 0 ? `<div class="prog"><i style="width:${pct.toFixed(1)}%"></i></div>` : ''}
      </div>
      <div class="meta">
        <div class="bname">${esc(b.title)}</div>
        <div class="bmeta">${read > 0 ? '读到第 ' + read + ' 页 · ' + Math.round(pct) + '%' : '尚未开始'}</div>
      </div>`;

    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.src = pageUrl(b.id, 1);
    img.onload = () => { img.classList.add('loaded'); const ph = d.querySelector('.ph'); if (ph) ph.remove(); };
    d.querySelector('.cover').prepend(img);

    const openBtn = document.createElement('button');
    openBtn.className = 'opennew';
    openBtn.title = '在新窗口打开（可以和另一本书并排看）';
    openBtn.textContent = '↗';
    openBtn.onclick = (e) => {
      e.stopPropagation();
      window.open('/?book=' + encodeURIComponent(b.id), '_blank', 'noopener');
    };
    d.appendChild(openBtn);

    d.onclick = () => { E.booksModal.hidden = true; openBook(b); };
    E.bookList.appendChild(d);
  });
}
async function openBook(b) {
  saveViewState();
  S.book = b;
  S.pages = b.pages || 0;
  E.bookName.textContent = b.title;
  E.pageTotal.textContent = '/ ' + S.pages;
  // 这本书的 PDF 在哪（有就本地渲染，没就回退图片）
  if (typeof PDFR !== 'undefined') {
    PDFR.doc = null; PDFR.loading = null; PDFR.cache.clear();
    PDFR.src = OFF
      ? (b.pdf || ('pdf/' + (b.key || bookKey(b.id)) + '.pdf'))
      : ('/pdf/' + encodeURIComponent(b.id));
  }
  document.title = b.title + ' · 教材伴读';
  localStorage.setItem('jb_last', b.id);
  let n = null;
  if (OFF) {
    const saved = localStorage.getItem(offNotesKey());
    if (saved) { try { n = JSON.parse(saved); } catch (e) { } }
    if (!n) {
      const meta = await fetch(OFF.multi ? 'notes/' + encodeURIComponent(b.id) + '.json' : 'data/book.json')
        .then(r => r.json()).catch(() => null);
      n = meta && (meta.notes || (meta.pages ? meta : null));
    }
  } else {
    n = await fetch('/api/notes?book=' + encodeURIComponent(b.id)).then(x => x.json()).catch(() => null);
  }
  S.notes = (n && n.pages) ? n : { pages: {} };
  S.region = null;
  S.needRestore = true;
  updateCtx();
  const saved = parseInt(localStorage.getItem('jb_page_' + b.id) || '1', 10) || 1;
  gotoPage(clamp(saved, 1, Math.max(1, S.pages)));
  E.empty.hidden = true;
  E.topbar.classList.remove('hide');
  E.pager.hidden = false;
  loadToc();
  updateBmBtn();
  renderMarker();
}
function gotoPage(n) {
  if (!S.book) return;
  n = clamp(Math.round(n), 1, Math.max(1, S.pages));
  if (S.scroll) {
    S.page = n;
    E.pageInput.value = n;
    localStorage.setItem('jb_page_' + S.book.id, String(n));
    updateProgress();
    updateChapterName();
    scrollToPage(n);
    return;
  }
  if (S.double && n > 1 && n % 2 === 0) n -= 1;   // 双页对齐到左页
  S.page = n;
  E.pageInput.value = n;
  localStorage.setItem('jb_page_' + S.book.id, String(n));
  // 只有真的换页了才丢掉上一次的框选；同页重载（缩放、刷新图片）不能用它清选区
  if (S.region && S.region.page !== n) clearRegion();
  updateProgress();
  try {
    history.replaceState(null, '', '?book=' + encodeURIComponent(S.book.id) + '&p=' + n);
  } catch (e) { }
  if (E.tocDrawer && E.tocDrawer.classList.contains('open')) { renderToc(); if ($('#bmList') && !$('#bmList').hidden) renderBookmarks(); }
  updateBmBtn();
  renderMarker();
  const url = pageUrl(S.book.id, n);
  E.img.onload = onPageLoaded;
  E.img.onerror = () => {
    // 网络抖动（本机 WiFi / 平板切网）时自动重试一次
    if (!E.img.dataset.retried) {
      E.img.dataset.retried = '1';
      setTimeout(() => {
        const u = E.img.getAttribute('src');
        E.img.removeAttribute('src');
        setTimeout(() => { E.img.src = u + (u.includes('?') ? '&' : '?') + 'r=1'; }, 60);
      }, 400);
      return;
    }
    delete E.img.dataset.retried;
    clearTimeout(plTimer);
    E.pageLoading.hidden = true;
    const box = $('#pageError');
    if (box) {
      box.hidden = false;
      const t = $('#peText');
      if (t) t.textContent = PDFR.src
        ? '第 ' + n + ' 页渲染失败 —— 点重试，或切到「图片模式」'
        : '第 ' + n + ' 页读不出来（文件可能损坏或页码越界）';
    }
  };
  if (E.img.getAttribute('src') === url && E.img.complete && E.img.naturalWidth) { onPageLoaded(); return; }
  E.img.classList.remove('ready');
  const seq = ++S.loadSeq;
  clearTimeout(plTimer);
  plTimer = setTimeout(() => {
    if (seq === S.loadSeq && !(E.img.complete && E.img.naturalWidth)) E.pageLoading.hidden = false;
  }, 400);
  // 低清缩略图先顶上，避免翻页瞬间露出空白
  try {
    E.wrap.style.backgroundImage = 'url("' + '/thumb/' + encodeURIComponent(S.book.id) + '/' + n + '")';
    E.wrap.style.backgroundSize = '100% 100%';
  } catch (e) { }
  // 双缓冲：新图先在内存里解码完，再换 #pageimg 的 src，翻页不会闪一下底色
  const pre = new Image();
  pre.decoding = 'async';
  pre.onload = () => {
    if (seq !== S.loadSeq) return;
    if (E.img.getAttribute('src') === url) { onPageLoaded(); return; }
    E.img.src = url;
  };
  pre.onerror = () => { if (seq === S.loadSeq) E.img.src = url; };

  // 有 PDF 就直接本地渲染（体积小、放大不糊），否则走预渲染图片
  if (PDFR.src) {
    pdfPageImage(n).then(dataUrl => {
      if (seq !== S.loadSeq) return;
      pre.src = dataUrl;
      // 顺带预热前后页
      pdfPrefetch([n + 1, n - 1, n + 2]);
    }).catch(err => {
      if (seq !== S.loadSeq) return;
      console.warn('pdf 渲染失败，回退图片:', err.message);
      pre.src = url;
    });
  } else {
    pre.src = url;
  }
}
function onPageLoaded() {
  clearTimeout(plTimer);
  E.pageLoading.hidden = true;
  E.wrap.style.backgroundImage = '';
  const errBox = $('#pageError');
  if (errBox) errBox.hidden = true;
  E.img.classList.add('ready');
  S.natW = E.img.naturalWidth; S.natH = E.img.naturalHeight;
  if (!S.natW) return;
  const W = wrapW();
  E.wrap.classList.toggle('double', S.double);
  E.wrap.style.width = W + 'px';
  E.wrap.style.height = S.natH + 'px';
  E.ink.width = W; E.ink.height = S.natH;
  fit();
  drawInk(); renderMarks(); renderChats();
  prefetch();
  updateProgress();
  loadSecond();
  if (S.needRestore) { S.needRestore = false; setTimeout(restoreView, 120); }
}

function loadSecond() {
  if (!E.img2) return;
  if (!S.double) { E.img2.hidden = true; return; }
  const p = S.page + 1;
  if (p > S.pages) { E.img2.hidden = true; return; }
  E.img2.hidden = false;
  const u = pageUrl(S.book.id, p);
  if (E.img2.getAttribute('src') !== u) E.img2.src = u;
}

function setDouble(on) {
  if (S.scroll) exitScroll();
  S.double = !!on;
  localStorage.setItem('jb_double', S.double ? '1' : '0');
  const btn = $('#btnLayout');
  if (btn) btn.classList.toggle('on', S.double);
  if (!S.double) { E.wrap.classList.remove('double'); if (E.img2) E.img2.hidden = true; }
  if (S.natW) { S.natW = E.img.naturalWidth; onPageLoaded(); }
  toast(S.double ? '双页模式' : '单页模式');
}
function updateProgress() {
  if (!S.pages) { E.progressBar.style.width = '0%'; return; }
  E.progressBar.style.width = ((S.page / S.pages) * 100).toFixed(2) + '%';
  updateChapterName();
}

function updateChapterName() {
  const el = $('#chapterName');
  if (!el) return;
  const items = (S.toc && S.toc.items) || [];
  if (!items.length) { el.textContent = ''; return; }
  const off = S.toc.offset || 0;
  const bookPage = S.page - off;
  let cur = null;
  for (const it of items) {
    if (it.page != null && it.page <= bookPage) cur = it;
    else if (it.page != null && it.page > bookPage) break;
  }
  el.textContent = cur ? cur.title.replace(/^第?\s*/, '') : '';
  el.title = cur ? cur.title : '';
}
function prefetch() {
  const step = S.double ? 2 : 1;
  const pages = [];
  for (let i = 1; i <= 4; i++) pages.push(S.page + step * i);
  if (S.double) pages.push(S.page + 2 * 1 + 1);
  pages.forEach(p => {
    if (p >= 1 && p <= S.pages) {
      const i = new Image();
      i.decoding = 'async';
      i.src = pageUrl(S.book.id, p);
    }
  });
}
function nextPage() { const st = S.double ? 2 : 1; if (S.page + st <= S.pages || (S.double && S.page + 1 < S.pages)) gotoPage(Math.min(S.pages, S.page + st)); }
function prevPage() { const st = S.double ? 2 : 1; if (S.page > 1) gotoPage(Math.max(1, S.page - st)); }

if ($('#btnLayout')) {
  $('#btnLayout').onclick = () => cycleLayout();
  if (S.double) $('#btnLayout').classList.add('on');
  $('#btnLayout').title = '单页 / 双页 / 滚动';
}

/* ------------------------------------------------ gestures */
function norm(e) {
  const r = E.wrap.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1),
           y: clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1) };
}
function pinchInit() {
  const a = [...ptrs.values()];
  const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
  return { type: 'pinch', d, scale: S.scale, tx: S.tx, ty: S.ty };
}

E.stage.addEventListener('pointerdown', e => {
  if (!S.book) return;
  E.stage.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (e.pointerType === 'pen' && S.mode === 'pen') {
    S.stroke = { pts: [norm(e)] };
    pd().strokes.push(S.stroke);
    gesture = { type: 'pen' };
    e.preventDefault();
    return;
  }
  if (S.mode === 'sel' && ptrs.size === 1) {
    const p = norm(e);
    gesture = { type: 'sel', x0: p.x, y0: p.y, x1: p.x, y1: p.y, sx: e.clientX, sy: e.clientY };
    E.selbox.hidden = false;
    updateSelBox(e.clientX, e.clientY);
    e.preventDefault();
    return;
  }
  if (ptrs.size === 1) {
    gesture = { type: 'pan', x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty, t: Date.now() };
  } else if (ptrs.size === 2) {
    gesture = pinchInit();
  }
});

E.stage.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture && gesture.type === 'pen') {
    const st = S.stroke; if (!st) return;
    const p = norm(e); const prev = st.pts[st.pts.length - 1];
    st.pts.push(p);
    const ctx = E.ink.getContext('2d');
    const W = E.ink.width, H = E.ink.height;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = Math.max(2, Math.min(W, H) * 0.0032);
    ctx.beginPath();
    ctx.moveTo(prev.x * W, prev.y * H);
    ctx.lineTo(p.x * W, p.y * H);
    ctx.stroke();
    return;
  }
  if (gesture && gesture.type === 'sel') {
    const p = norm(e);
    gesture.x1 = p.x; gesture.y1 = p.y;
    updateSelBox(e.clientX, e.clientY);
    return;
  }
  if (ptrs.size >= 2) {
    if (!gesture || gesture.type !== 'pinch') gesture = pinchInit();
    const a = [...ptrs.values()];
    const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
    const r = stageRect();
    const cx = (a[0].x + a[1].x) / 2 - r.left;
    const cy = (a[0].y + a[1].y) / 2 - r.top;
    const ns = clamp(gesture.scale * (d / gesture.d), S.fit * 0.9, S.fit * 9);
    const f = ns / S.scale;
    S.scale = ns;
    S.tx = cx - (cx - gesture.tx) * f;
    S.ty = cy - (cy - gesture.ty) * f;
    clampT(); applyT();
    return;
  }
  if (gesture && gesture.type === 'pan') {
    S.tx = gesture.tx + (e.clientX - gesture.x);
    S.ty = gesture.ty + (e.clientY - gesture.y);
    clampT(); applyT();
  }
});

function endPointer(e) {
  const had = ptrs.delete(e.pointerId);
  const g = gesture;

  if (g && g.type === 'pen') {
    S.stroke = null; drawInk(); saveNotes(); gesture = null;
    if (!ptrs.size) return;
  }
  if (g && g.type === 'sel') {
    E.selbox.hidden = true;
    const sz = $('#selSize'); if (sz) sz.hidden = true;
    commitSel(g);
    gesture = ptrs.size ? null : null;
    return;
  }
  if (g && g.type === 'pan' && ptrs.size === 0) {
    const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Date.now() - g.t;
    const far = Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800;
    if (S.scale <= S.fit * 1.02 && far) {
      if (dx < 0) nextPage(); else prevPage();
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && dt < 300) {
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        const r = stageRect();
        const nx = (e.clientX - r.left) / Math.max(1, r.width);
        lastTap = 0;
        // 刚才那一下已经切过 UI 了，双击要把它撤回来，否则会“闪一下”
        if (S.lastToggleAt && now - S.lastToggleAt < 300) { toggleUI(); S.lastToggleAt = 0; }
        // 双击左右边缘 = 翻页（平板单手操作）
        if (nx < 0.16) { prevPage(); return; }
        if (nx > 0.84) { nextPage(); return; }
        if (S.scale > S.fit * 1.3) { fit(); }
        else { zoomAt(e.clientX - r.left, e.clientY - r.top, S.fit * 2.6); }
      } else {
        lastTap = now;
        // 点中已有的框 → 聚焦它（可以继续说，也可以点叉删掉）
        const hit = markAt(e.clientX, e.clientY);
        if (hit) { focusMark(hit); return; }
        // 点空白但有聚焦 → 先取消聚焦，不切 UI
        if (S.activeMark) { clearFocus(); return; }
        // 立即响应，不等 320ms 双击判定——平板上「点下去没反应」最难受
        if (S.mode === 'read') { toggleUI(); S.lastToggleAt = now; }
      }
    }
  }
  if (ptrs.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = pinchInit();
}
E.stage.addEventListener('pointerup', endPointer);
E.stage.addEventListener('pointercancel', endPointer);

function updateSelBox(cx, cy) {
  const r = stageRect(), g = gesture;
  if (!g || g.type !== 'sel') return;
  const l = Math.min(g.sx, cx) - r.left;
  const t = Math.min(g.sy, cy) - r.top;
  const w = Math.abs(cx - g.sx), h = Math.abs(cy - g.sy);
  E.selbox.style.left = l + 'px';
  E.selbox.style.top = t + 'px';
  E.selbox.style.width = w + 'px';
  E.selbox.style.height = h + 'px';
  // 拖动时显示选框的实际像素尺寸（换算回原始页面像素）
  const badge = $('#selSize');
  if (badge && S.scale > 0) {
    badge.hidden = w < 30 || h < 30;
    badge.textContent = Math.round(w / S.scale) + ' × ' + Math.round(h / S.scale);
    badge.style.left = (l + w / 2) + 'px';
    badge.style.top = (t + h + 6) + 'px';
  }
}
function commitSel(g) {
  const nx = clamp(Math.min(g.x0, g.x1), 0, 1);
  const ny = clamp(Math.min(g.y0, g.y1), 0, 1);
  const nw = clamp(Math.abs(g.x1 - g.x0), 0, 1 - nx);
  const nh = clamp(Math.abs(g.y1 - g.y0), 0, 1 - ny);
  syncMode('read');
  if (nw * S.natW < 26 || nh * S.natH < 26) return;

  // 重新框 = 替换上一次的框，不在疑点里堆垃圾
  if (S.region && S.region.mark) {
    const old = pd(S.region.page);
    const oi = (old.marks || []).findIndex(x => x.id === S.region.mark.id);
    if (oi >= 0) old.marks.splice(oi, 1);
    S.region = null;
  }

  const mark = { id: 'm' + Date.now(), x: nx, y: ny, w: nw, h: nh, question: '', answer: '', ts: Date.now() };
  pd().marks.push(mark);
  renderMarks(); saveNotes();

  S.region = { mark, page: S.page, dataUrl: cropFrom(E.img, nx, ny, nw, nh, 1500) };
  S.activeMark = mark;
  S.needRestore = false;   // 用户已经动手框选了，别再让「恢复上次位置」把页面跳走、把选区清掉
  panelOpenedBySel = E.panel.classList.contains('hidden');
  openPanel(); updateCtx();
  showSelActions();
  placeSelX();
  setTimeout(() => E.q.focus(), 60);
  toast('已圈选这块，说点什么，或直接发送让我讲');
}
let panelOpenedBySel = false;

/* 当前页最后一个还没问过的框（不依赖 S.region，防止状态被别处清掉后按不到叉） */
function activeMark() {
  const d = pd(S.page);
  const ms = (Array.isArray(d.marks) ? d.marks : []).filter(m => m && !m.question);
  return ms.length ? ms[ms.length - 1] : null;
}

/* 点在哪就找哪个框（从上层往下找） */
function markAt(clientX, clientY) {
  const r = E.wrap.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nx = (clientX - r.left) / r.width;
  const ny = (clientY - r.top) / r.height;
  const d = pd(S.page);
  const list = (Array.isArray(d.marks) ? d.marks : []).filter(m =>
    nx >= m.x && nx <= m.x + m.w && ny >= m.y && ny <= m.y + m.h);
  return list.length ? list[list.length - 1] : null;
}

/* 聚焦到某个已有的框：不管是刚框的还是上周框的，都能继续说、也能删 */
function focusMark(m) {
  if (!m) return;
  S.activeMark = m;
  let dataUrl = '';
  try { dataUrl = cropFrom(E.img, m.x, m.y, m.w, m.h, 1500); } catch (e) { }
  S.region = { mark: m, page: S.page, dataUrl };
  panelOpenedBySel = E.panel.classList.contains('hidden');
  openPanel();
  updateCtx();
  showSelActions();
  placeSelX();
}
function clearFocus() {
  S.activeMark = null;
  S.region = null;
  updateCtx();
  hideSelActions();
  const x = $('#selX'); if (x) x.hidden = true;
}

/* 把取消按钮贴在选区右上角（fixed 定位，用视口坐标；选框提交后 selbox 已隐藏） */
function placeSelX() {
  const x = $('#selX');
  if (!x) return;
  const m = S.activeMark || (S.region && S.region.mark) || activeMark();
  if (!m) { x.hidden = true; return; }
  x.dataset.mid = m.id;
  const r = E.wrap.getBoundingClientRect();
  if (!r.width || !r.height) { x.hidden = true; return; }
  const px = clamp(r.left + (m.x + m.w) * r.width, 22, window.innerWidth - 22);
  const py = clamp(r.top + m.y * r.height, 22, window.innerHeight - 22);
  x.style.left = px + 'px';
  x.style.top = py + 'px';
  x.hidden = false;
}
function showSelActions() {
  const box = $('#selActions');
  if (!box) return;
  const reg = S.region;
  const m = S.activeMark || (reg && reg.mark);
  if (!m) { box.hidden = true; return; }
  const r = E.wrap.getBoundingClientRect();
  if (!r.width) { box.hidden = true; return; }
  const left = r.left + m.x * r.width;
  const right = r.left + (m.x + m.w) * r.width;
  const topY = r.top + m.y * r.height;
  const botY = r.top + (m.y + m.h) * r.height;
  box.hidden = false;
  const cx = clamp((left + right) / 2, 170, window.innerWidth - 170);
  let ty = botY + 12;
  if (ty > window.innerHeight - 130) ty = Math.max(10, topY - 56);
  box.style.left = cx + 'px';
  box.style.top = ty + 'px';
}
function hideSelActions() {
  const box = $('#selActions');
  if (box) box.hidden = true;
}
/* 兜底：用内联 onclick 直接调用，避免任何绑定/冒泡问题 */
window.__cancelSel = function () { cancelRegion(); };

(function bindSelActions() {
  const box = $('#selActions');
  if (!box) return;
  const xb = $('#selX');
  if (xb) {
    xb.addEventListener('pointerdown', e => e.stopPropagation());
    xb.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      cancelRegion();
    });
  }
  // 快捷条自己吞掉指针事件，别让画布把点击当成拖拽
  box.addEventListener('pointerdown', e => e.stopPropagation());
  box.addEventListener('click', e => {
    if (e.target.closest('#selCancel')) {
      e.stopPropagation();
      cancelRegion();
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    e.stopPropagation();
    hideSelActions();
    openPanel();
    E.q.value = b.dataset.q || '';
    autoGrow();
    if (!S.busy) send();
  });
  E.stage.addEventListener('pointerdown', () => hideSelActions(), true);
})();

/* ------------------------------------------------ mode */
function syncMode(m) {
  S.mode = m;
  $('#btnSel').classList.toggle('on', m === 'sel');
  $('#btnPen').classList.toggle('on', m === 'pen');
  E.stage.style.cursor = m === 'sel' ? 'crosshair' : (m === 'pen' ? 'cell' : 'default');
}
$('#btnSel').onclick = () => { syncMode(S.mode === 'sel' ? 'read' : 'sel'); if (S.mode === 'sel') toast('拖动框出疑问区域'); };
$('#btnPen').onclick = () => { syncMode(S.mode === 'pen' ? 'read' : 'pen'); if (S.mode === 'pen') toast('用笔在页面上书写'); };

/* ------------------------------------------------ context */
function updateCtx() {
  if (S.region) {
    E.ctxLabel.textContent = `第 ${S.region.page} 页 · 框选区域`;
    E.ctxClear.hidden = false;
    if (E.ctxChip) E.ctxChip.textContent = '框选';
  } else {
    E.ctxLabel.textContent = `整页 · 第 ${S.page} 页`;
    E.ctxClear.hidden = true;
    if (E.ctxChip) E.ctxChip.textContent = '第 ' + S.page + ' 页';
  }
}
function clearRegion() {
  S.region = null; S.activeMark = null; updateCtx(); hideSelActions();
  const x = $('#selX'); if (x) x.hidden = true;
}

/* 彻底取消这块：删掉刚建的疑点标记、收起浮窗、把框也撤掉 */
function cancelRegion(silent) {
  const reg = S.region;
  const m = S.activeMark || (reg && reg.mark) || activeMark();
  const page = (reg && reg.page) || S.page;
  const mid = m ? m.id : ($('#selX') && $('#selX').dataset.mid);
  const d = pd(page);
  let hit = -1;
  if (mid && Array.isArray(d.marks)) {
    hit = d.marks.findIndex(x => x.id === mid);
    if (hit >= 0) d.marks.splice(hit, 1);
  }
  window.__dbg = {
    reg: !!reg, mId: m ? m.id : null, ds: ($('#selX') || {}).dataset ? $('#selX').dataset.mid : null,
    mid: mid, hit: hit, lenAfter: d.marks.length,
    ids: d.marks.map(x => x.id + ':' + JSON.stringify(x.question)).join('|'),
  };
  // 当前页可能和 reg.page 不同（很少见），两页都扫一遍，务必删干净
  if (mid) {
    const d2 = pd(S.page);
    if (d2 !== d && Array.isArray(d2.marks)) {
      const j = d2.marks.findIndex(x => x.id === mid);
      if (j >= 0) d2.marks.splice(j, 1);
    }
  }
  S.region = null;
  S.activeMark = null;
  updateCtx();
  hideSelActions();
  E.selbox.hidden = true;
  const xb = $('#selX'); if (xb) xb.hidden = true;
  const sz = $('#selSize'); if (sz) sz.hidden = true;
  // 无条件重绘：画布上的框必须跟着消失
  try { renderMarks(); } catch (e) { }
  try { saveNotes(); } catch (e) { }
  syncMode('read');
  if (panelOpenedBySel) { E.panel.classList.add('hidden'); panelOpenedBySel = false; }
  if (!silent) toast('已取消这块');
}
E.ctxClear.onclick = () => { clearRegion(); toast('已改为整页上下文'); };

/* ------------------------------------------------ page ref parse */
function parsePages(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const maxP = Math.max(S.pages, 1);
  let m = t.match(/^\s*(?:第)?\s*(\d{1,4})\s*[-~–—到至]\s*(\d{1,4})\s*(?:页)?\s*$/);
  if (m) return rangeOf(m[1], m[2]);
  m = t.match(/第\s*(\d{1,4})\s*[-~–—到至]\s*(\d{1,4})\s*页/);
  if (m) return rangeOf(m[1], m[2]);
  m = t.match(/第\s*(\d{1,4})\s*[页篇]/);
  if (m) { const a = parseInt(m[1], 10); if (a >= 1 && a <= maxP) return [a]; }
  m = t.match(/^\s*(?:p|P)?\s*(\d{1,4})\s*页?\s*$/);
  if (m) { const a = parseInt(m[1], 10); if (a >= 1 && a <= maxP) return [a]; }
  return null;

  function rangeOf(a, b) {
    let x = parseInt(a, 10), y = parseInt(b, 10);
    if (isNaN(x) || isNaN(y)) return null;
    if (x > y) { const k = x; x = y; y = k; }
    x = clamp(x, 1, maxP); y = clamp(y, 1, maxP);
    const out = [];
    for (let i = x; i <= y && out.length < 3; i++) out.push(i);
    return out.length ? out : null;
  }
}

/* ------------------------------------------------ chat render */
function renderChats() {
  if (S.busy) return;
  const d = pd();
  E.msgs.innerHTML = '';
  if (!d.chats.length) {
    E.msgs.innerHTML = `<div class="hint">圈一块区域 → 直接提问；或在下面输入 <code>12</code> / <code>第12页</code> 让它讲整页；也可以把它当笔记，说说你的想法。</div>`;
    return;
  }
  d.chats.forEach(c => { addUserMsg(c.q, c.thumb); addBotMsg(c.a, c.via); });
  scrollMsgs();
}
function addUserMsg(text, thumb) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = md(text || '（无文字，仅图片）') + (thumb ? `<img class="thumb" src="${thumb}">` : '');
  E.msgs.appendChild(el);
  return el;
}
function addBotMsg(text, via) {
  const el = document.createElement('div');
  el.className = 'msg bot';
  if (text) finalizeBot(el, text, via);
  E.msgs.appendChild(el);
  return el;
}

/* 把回答末尾的「👉 可以继续问：1. … 2. …」抽成可点按钮 */
function splitFollowups(text) {
  const t = String(text || '');
  const idx = (() => {
    const a = t.lastIndexOf('可以继续问');
    return a >= 0 ? a : t.lastIndexOf('继续问');
  })();
  if (idx < 0) return { body: t, followups: [] };
  const tail = t.slice(idx);
  const lines = tail.split('\n').map(s => s.trim()).filter(Boolean);
  const items = [];
  for (const ln of lines) {
    const m = ln.match(/^[\d一二三四五][.、)．]\s*(.+)$/) || ln.match(/^[-*·]\s*(.+)$/);
    if (m) {
      const s = m[1].replace(/^[\s"'“”「」]+|[\s"'“”「」]+$/g, '').trim();
      if (s.length > 3 && s.length < 90) items.push(s);
    }
  }
  if (!items.length) return { body: t, followups: [] };
  return { body: t.slice(0, idx).replace(/[\s👉]+$/, ''), followups: items.slice(0, 4) };
}
function followupHtml(list) {
  if (!list.length) return '';
  return '<div class="fups">' + list.map(f => `<button class="fup">${esc(f)}</button>`).join('') + '</div>';
}
E.msgs.addEventListener('click', e => {
  const b = e.target.closest('.fup');
  if (!b || S.busy) return;
  E.q.value = b.textContent;
  autoGrow();
  openPanel();
  send();
});

function finalizeBot(el, text, via) {
  const { body, followups } = splitFollowups(text);
  el.dataset.raw = text;
  const long = body.length > 900;
  const inner = md(body);
  el.innerHTML = (long
      ? `<div class="md-body collapsed" data-long="1">${inner}</div>
         <button class="expand">展开全文（${body.length} 字）</button>`
      : `<div class="md-body">${inner}</div>`)
    + followupHtml(followups)
    + `<span class="meta">上下文：${esc(via)}</span>`
    + `<span class="mbtns"><button class="copy">复制</button><button class="copy tts">朗读</button><button class="copy shot">存图</button></span>`;
}

/* 长回答折叠/展开 */
E.msgs.addEventListener('click', e => {
  const b = e.target.closest('.expand');
  if (!b) return;
  const body = b.previousElementSibling;
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  b.textContent = collapsed ? `展开全文` : '收起';
});

/* 把一问一答（含框选截图）导出成一张 PNG 卡片 */
async function exportAnswerCard(botEl) {
  const raw = botEl.dataset.raw || '';
  if (!raw) return;
  const prev = botEl.previousElementSibling;
  const thumbImg = prev && prev.classList.contains('user') ? prev.querySelector('img.thumb') : null;
  const qText = prev && prev.classList.contains('user') ? (prev.childNodes[0]?.textContent || '').trim() : '';
  const via = botEl.querySelector('.meta')?.textContent || '';

  const W = 900, PAD = 36, LH = 30, FS = 17;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');

  // 先量文字高度
  ctx.font = `${FS}px -apple-system, "Microsoft YaHei", sans-serif`;
  const wrap = (text, maxW) => {
    const out = [];
    String(text).split('\n').forEach(par => {
      if (!par.trim()) { out.push(''); return; }
      let line = '';
      for (const ch of par) {
        if (ctx.measureText(line + ch).width > maxW) { out.push(line); line = ch; }
        else line += ch;
      }
      if (line) out.push(line);
    });
    return out;
  };
  const clean = raw.replace(/👉[\s\S]*$/, '').replace(/[#*`$]/g, '');
  const qLines = wrap(qText || '（看图提问）', W - PAD * 2);
  const aLines = wrap(clean, W - PAD * 2);

  let img = null;
  if (thumbImg) {
    img = await new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = thumbImg.src;
    });
  }
  const imgW = img ? Math.min(W - PAD * 2, img.width) : 0;
  const imgH = img ? Math.round(img.height * (imgW / img.width)) : 0;

  const H = PAD * 2 + (imgH ? imgH + 26 : 0) + qLines.length * LH + 16 + aLines.length * LH + 50;
  cv.width = W; cv.height = Math.max(400, H);

  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
  let y = PAD;
  if (img) {
    g.drawImage(img, PAD, y, imgW, imgH);
    g.strokeStyle = '#e3e8f2'; g.lineWidth = 1; g.strokeRect(PAD, y, imgW, imgH);
    y += imgH + 26;
  }
  // 问题
  g.fillStyle = '#3568e0';
  g.font = `600 ${FS}px -apple-system, "Microsoft YaHei", sans-serif`;
  g.fillText('问', PAD, y + FS);
  g.fillStyle = '#1b2130';
  g.font = `${FS}px -apple-system, "Microsoft YaHei", sans-serif`;
  qLines.forEach((l, i) => g.fillText(l, PAD + 30, y + i * LH + FS));
  y += qLines.length * LH + 16;

  // 分隔线
  g.strokeStyle = '#eef1f7'; g.beginPath(); g.moveTo(PAD, y - 6); g.lineTo(W - PAD, y - 6); g.stroke();

  // 回答
  g.fillStyle = '#6b7688';
  g.font = `${FS}px -apple-system, "Microsoft YaHei", sans-serif`;
  aLines.forEach((l, i) => g.fillText(l, PAD, y + i * LH + FS));
  y += aLines.length * LH + 22;

  // 页脚
  g.fillStyle = '#9aa4b6';
  g.font = `13px -apple-system, "Microsoft YaHei", sans-serif`;
  g.fillText(`${S.book ? S.book.title : ''}  ${via}`.trim(), PAD, y + 14);

  const url = cv.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = '伴读卡片-' + (S.page) + '-' + Date.now() + '.png';
  document.body.appendChild(a); a.click(); a.remove();
  toast('已导出卡片图');
}

/* 朗读 */
function speakText(text, btn) {
  if (!('speechSynthesis' in window)) { toast('这个浏览器不支持朗读'); return; }
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    document.querySelectorAll('.tts').forEach(b => b.textContent = '朗读');
    return;
  }
  const clean = String(text || '')
    .replace(/👉.*$/s, '')
    .replace(/[#*`$>]/g, '')
    .replace(/\n{2,}/g, '。')
    .slice(0, 2400);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'zh-CN';
  u.rate = 1.02;
  const vs = (speechSynthesis.getVoices() || []).filter(v => /zh|Chinese|中文/i.test((v.lang || '') + (v.name || '')));
  if (vs.length) u.voice = vs[0];
  u.onend = () => { if (btn) btn.textContent = '朗读'; };
  u.onerror = () => { if (btn) btn.textContent = '朗读'; };
  if (btn) btn.textContent = '停止';
  speechSynthesis.speak(u);
}

/* 正文字号 */
let msgFs = parseFloat(localStorage.getItem('jb_msgfs') || '14.5') || 14.5;
function applyMsgFont(v) {
  msgFs = clamp(v, 12, 20);
  localStorage.setItem('jb_msgfs', String(msgFs));
  document.documentElement.style.setProperty('--msg-fs', msgFs + 'px');
  const lbl = $('#fsVal');
  if (lbl) lbl.textContent = msgFs.toFixed(1) + 'px';
}
E.msgs.addEventListener('click', async e => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const msg = btn.closest('.msg');
  const raw = msg?.dataset.raw || '';
  if (!raw) return;
  if (btn.classList.contains('tts')) { speakText(raw, btn); return; }
  if (btn.classList.contains('shot')) { exportAnswerCard(msg); return; }
  // 复制时带出处，方便抄到纸质笔记上时标明来源
  const via = (msg.querySelector('.meta')?.textContent || '').replace(/^上下文：/, '').trim();
  const src = `《${(S.book && S.book.title) || ''}》${via}`;
  const text = src.trim() ? src + '\n\n' + raw : raw;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = '复制'; }, 1200);
  } catch { toast('复制失败，长按选中复制'); }
});
function addErrMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg err';
  el.textContent = '⚠ ' + text;
  E.msgs.appendChild(el);
  scrollMsgs();
  return el;
}
function scrollMsgs(force) {
  const box = E.msgs;
  // 用户手动往上翻看旧内容时，别把视图硬拽回底部
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 150;
  if (force || nearBottom) box.scrollTop = box.scrollHeight;
}

/* ------------------------------------------------ send */
function viaLabel(mode, pages) {
  if (mode === 'region') return `第 ${S.page} 页框选`;
  if (mode === 'range') return `第 ${Math.min(...pages)}–${Math.max(...pages)} 页`;
  return `第 ${pages[0]} 页整页`;
}

async function imagesFor(mode, pages, region) {
  if (mode === 'region') {
    if (!region) return [];
    const out = [];
    // 先给一张低清整页做定位上下文，再给高清框选块 —— 模型能看出这块在页面哪个位置
    try {
      const im = await loadImage(pageUrl(S.book.id, region.page));
      out.push(cropFrom(im, 0, 0, 1, 1, 720));
    } catch (e) { }
    out.push(region.dataUrl);
    return out;
  }
  const out = [];
  for (const p of pages.slice(0, 3)) {
    try {
      const url = pageUrl(S.book.id, p);
      const im = await loadImage(url);
      out.push(cropFrom(im, 0, 0, 1, 1, 1500));
    } catch (e) { }
  }
  return out;
}

/* ------------------------------------------------ 离线版：直连模型 API */
const OFF_SYS = '你是《教材》伴读助手。用户会给你教材的页面图片和问题。要求：① 先用一两句话点明这块内容在讲什么、属于哪个知识点；② 再拆解步骤或公式，关键处说明为什么；③ 涉及公式用 $...$ 括起来写 LaTeX；④ 不确定的地方直说不确定，不要编造页码和公式编号；⑤ 中文回答，语气像坐在旁边讲题的学长，不要客套话和总结段。';

function offErrText(code, detail) {
  const d = (detail || '').toLowerCase();
  if (code === 401) return 'API Key 无效 —— 到设置里重新填一次（Key 只存在这台设备）';
  if (code === 402 || d.includes('insufficient') || d.includes('balance')) return '账户余额不足 —— 充点钱再问';
  if (code === 429) return '请求太频繁，等十几秒';
  if (code >= 500) return '模型服务端出错（' + code + '），过会儿再试';
  if (code === 400 && d.includes('image')) return '这个模型不支持读图 —— 换成 deepseek-chat 之类能看图的';
  return '请求失败（' + code + '）：' + (detail || '').slice(0, 160);
}

async function offAsk(payload) {
  const s = offSettings();
  const key = (s.api_key || localStorage.getItem('jb_off_key') || '').trim();
  if (!key) throw new Error('离线版还没填 API Key —— 打开设置填一次，之后存在这台平板上');
  const base = (s.base_url || OFF_API).replace(/\/+$/, '');
  const model = s.model || 'deepseek-chat';

  let ctx = '';
  if (payload.mode === 'region') {
    ctx = '下面是《' + payload.book + '》第 ' + payload.page + ' 页的整页图（低清，用来看位置），接着是我框出来的那一块高清区域。';
  } else if (payload.mode === 'range') {
    ctx = '下面是《' + payload.book + '》第 ' + (payload.pages || []).join('、') + ' 页。';
  } else {
    ctx = '下面是《' + payload.book + '》第 ' + payload.page + ' 页。';
  }
  if (payload.question) ctx += '\n\n我的问题：' + payload.question;
  else ctx += '\n\n（没写问题）请主动讲讲这页的重点。';

  const content = [];
  (payload.images || []).forEach(u => content.push({ type: 'image_url', image_url: { url: u } }));
  content.push({ type: 'text', text: ctx });

  const messages = [{ role: 'system', content: s.system_prompt || OFF_SYS }];
  (payload.history || []).forEach(h => messages.push(h));
  messages.push({ role: 'user', content });

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: typeof s.temperature === 'number' ? s.temperature : 0.3,
      max_tokens: s.max_tokens || 3500,
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(offErrText(res.status, t));
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      const emit = o => ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let o; try { o = JSON.parse(data); } catch (e) { continue; }
            const d = o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
            if (d) emit({ type: 'delta', text: d });
            if (o.usage) emit({ type: 'usage', usage: o.usage });
          }
        }
        emit({ type: 'done' });
      } catch (e) {
        emit({ type: 'error', message: '网络中断：' + e.message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

/* 离线版：自查缓存了多少页，没缓存满就提示（联网时可补） */
async function checkOfflineCache() {
  if (!OFF || !('caches' in window)) return;
  let done = 0;
  try {
    const names = await caches.keys();
    for (const nm of names) {
      const c = await caches.open(nm);
      const keys = await c.keys();
      const n = keys.filter(r => r.url.indexOf('/pages/') >= 0).length;
      if (n > done) done = n;
    }
  } catch (e) { return; }
  const total = OFF.pages || 0;
  const el = $('#cacheInfo');
  if (el) el.textContent = '离线缓存 ' + done + ' / ' + total + ' 页';
  if (done >= total && total > 0) {
    if (!sessionStorage.getItem('jb_offfull')) {
      sessionStorage.setItem('jb_offfull', '1');
      toast('整本书已在这台设备上，断网也能看');
    }
  } else if (done > 0) {
    toast('已缓存 ' + done + ' / ' + total + ' 页，联网时继续补全（别关页面）');
  }
  return done;
}

async function send() {
  if (S.busy || !S.book) return;
  const raw = E.q.value.trim();
  if (!raw && !S.region) { toast('先圈一块区域，或说点什么'); return; }

  const ref = parsePages(raw);
  let mode, pages, region = S.region;
  if (ref) { mode = ref.length > 1 ? 'range' : 'page'; pages = ref; region = null; }
  else if (region) { mode = 'region'; pages = [S.page]; }
  else { mode = 'page'; pages = [S.page]; }

  S.busy = true;
  E.send.disabled = true;
  E.q.value = '';
  autoGrow();

  if (mode === 'page' && pages[0] !== S.page) gotoPage(pages[0]);

  const via = viaLabel(mode, pages);
  const thumb = (mode === 'region' && region) ? region.dataUrl : '';
  addUserMsg(raw, thumb);
  const botEl = addBotMsg('', '');
  botEl.classList.add('cursor');
  // 首 token 之前给个明确反馈，别让人以为卡住了
  const thinkEl = document.createElement('div');
  thinkEl.className = 'msg think';
  thinkEl.innerHTML = `<span class="pulse"></span>${mode === 'region' ? '正在看你框的这块…' : '正在看第 ' + pages[0] + ' 页…'}`;
  E.msgs.appendChild(thinkEl);
  scrollMsgs(true);
  const t0 = Date.now();
  const dropThink = () => { if (thinkEl.parentNode) thinkEl.remove(); };

  let imgs = [];
  try { imgs = await imagesFor(mode, pages, region); }
  catch (e) { addErrMsg('取图失败：' + e.message); }

  const payload = {
    book: S.book.title, page: pages[0], pages,
    mode: mode, question: raw, images: imgs,
    history: (pd(pages[0]).chats || []).slice(-6).flatMap(c => ([
      { role: 'user', content: c.q || '' },
      { role: 'assistant', content: c.a || '' },
    ])).filter(x => x.content),
  };

  let acc = '';
  let raf = 0;
  let lastUsage = null;
  const flush = () => { raf = 0; if (acc) dropThink(); botEl.innerHTML = md(acc); scrollMsgs(); };

  try {
    const res = OFF
      ? await offAsk(payload)
      : await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    if (!res.body) throw new Error('浏览器不支持流式响应');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let o; try { o = JSON.parse(line.slice(5)); } catch (e) { continue; }
          if (o.type === 'delta') {
            acc += o.text;
            if (!raf) raf = requestAnimationFrame(flush);
          } else if (o.type === 'usage') {
            lastUsage = o.usage || null;
          } else if (o.type === 'error') {
            throw new Error(o.message || '未知错误');
          } else if (o.type === 'done') {
            buf = '';
          }
        }
      }
    }
    botEl.classList.remove('cursor');
    dropThink();
    finalizeBot(botEl, acc, via);
    if (lastUsage) {
      const meta = botEl.querySelector('.meta');
      const tk = (lastUsage.prompt_tokens || 0) + (lastUsage.completion_tokens || 0);
      if (meta && tk) meta.textContent += ` · ${(tk / 1000).toFixed(1)}k tokens`;
    }

    const d = pd(pages[0]);
    d.chats.push({ q: raw, a: acc, via, ts: Date.now(), thumb });
    if (mode === 'region' && region) {
      const mk = pd(region.page).marks.find(m => m.id === region.mark.id);
      if (mk) { mk.question = raw || '（讲这块）'; mk.answer = acc.slice(0, 400); }
      renderMarks();
    }
    saveNotes();
  } catch (err) {
    botEl.classList.remove('cursor');
    if (!acc) botEl.remove();
    addErrMsg(err.message || String(err));
  } finally {
    S.busy = false;
    E.send.disabled = false;
    clearRegion();
    scrollMsgs();
  }
}
E.send.onclick = send;
E.q.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); return; }
  // ↑ 召回本页上一条提问（输入框为空时）
  if (e.key === 'ArrowUp' && !E.q.value.trim()) {
    const chats = (pd().chats || []);
    if (chats.length) {
      e.preventDefault();
      E.q.value = chats[chats.length - 1].q || '';
      autoGrow();
    }
  }
});
function autoGrow() {
  E.q.style.height = 'auto';
  E.q.style.height = Math.min(120, E.q.scrollHeight) + 'px';
}
E.q.addEventListener('input', autoGrow);

/* ------------------------------------------------ panel */
function savePanelRect() {
  const s = E.panel.style;
  if (!s.left || s.right !== 'auto') return;
  try {
    localStorage.setItem('jb_panel', JSON.stringify({
      left: s.left, top: s.top, width: s.width, height: s.height,
    }));
  } catch (e) { }
}
function restorePanelRect() {
  // 竖屏平板按 CSS 布局走，忽略桌面端拖出来的尺寸
  if (window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches) {
    const p = E.panel;
    p.style.left = ''; p.style.top = ''; p.style.width = ''; p.style.height = '';
    p.style.right = ''; p.style.bottom = '';
    return;
  }
  let d = null;
  try { d = JSON.parse(localStorage.getItem('jb_panel') || 'null'); } catch (e) { }
  if (!d || !d.left) return;
  const p = E.panel;
  const w = parseFloat(d.width) || 440, h = parseFloat(d.height) || 420;
  const left = clamp(parseFloat(d.left) || 0, 8, Math.max(8, window.innerWidth - w - 8));
  const top = clamp(parseFloat(d.top) || 0, 8, Math.max(8, window.innerHeight - h - 8));
  p.style.left = left + 'px'; p.style.top = top + 'px';
  p.style.right = 'auto'; p.style.bottom = 'auto';
  p.style.width = w + 'px'; p.style.height = h + 'px';
}
function openPanel() {
  E.panel.classList.remove('hidden', 'min');
  restorePanelRect();
}
$('#pClose').onclick = () => E.panel.classList.add('hidden');
$('#pMin').onclick = () => E.panel.classList.toggle('min');
$('#pMax').onclick = () => E.panel.classList.toggle('max');

E.panelHead.addEventListener('pointerdown', e => {
  if (e.target.closest('button')) return;
  const p = E.panel, r = p.getBoundingClientRect();
  p.classList.remove('max');
  p.style.left = r.left + 'px'; p.style.top = r.top + 'px';
  p.style.right = 'auto'; p.style.bottom = 'auto';
  p.style.width = r.width + 'px'; p.style.height = r.height + 'px';
  const sx = e.clientX, sy = e.clientY;
  const move = ev => {
    p.style.left = (r.left + ev.clientX - sx) + 'px';
    p.style.top = (r.top + ev.clientY - sy) + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    savePanelRect();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  e.preventDefault();
});

$('#grip').addEventListener('pointerdown', e => {
  const p = E.panel, r = p.getBoundingClientRect();
  p.classList.remove('max');
  p.style.left = r.left + 'px'; p.style.top = r.top + 'px';
  p.style.right = 'auto'; p.style.bottom = 'auto';
  p.style.width = r.width + 'px'; p.style.height = r.height + 'px';
  const sx = e.clientX, sy = e.clientY;
  const move = ev => {
    p.style.width = clamp(r.width + ev.clientX - sx, 280, window.innerWidth - 20) + 'px';
    p.style.height = clamp(r.height + ev.clientY - sy, 160, window.innerHeight - 20) + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    savePanelRect();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  e.preventDefault(); e.stopPropagation();
});

/* ------------------------------------------------ pager */
$('#prev').onclick = prevPage;
$('#next').onclick = nextPage;
E.pageInput.addEventListener('change', () => {
  const n = parseInt(E.pageInput.value, 10);
  if (!isNaN(n)) gotoPage(n); else E.pageInput.value = S.page;
});
/* 输页码即时跳（不再等回车） */
let pageJumpTimer = null;
E.pageInput.addEventListener('input', () => {
  clearTimeout(pageJumpTimer);
  const v = E.pageInput.value.trim();
  if (!v) return;
  pageJumpTimer = setTimeout(() => {
    const n = parseInt(v, 10);
    if (!isNaN(n) && n !== S.page) gotoPage(n);
  }, 420);
});
E.pageInput.addEventListener('keydown', e => { if (e.key === 'Enter') E.pageInput.blur(); });

/* ------------------------------------------------ 目录 */
S.toc = { items: [], offset: 0 };

async function loadToc() {
  if (!S.book) return;
  if (OFF) {
    try {
      if (OFF.multi) {
        const meta = await fetch('toc/' + encodeURIComponent(S.book.id) + '.json').then(x => x.json());
        S.toc = { items: meta.items || [], offset: meta.offset || 0, source: 'offline' };
      } else {
        const meta = await fetch('data/book.json').then(x => x.json());
        const t = meta.toc || {};
        S.toc = { items: t.items || [], offset: t.offset || 0, source: 'offline' };
      }
    } catch (e) { S.toc = { items: [], offset: 0 }; }
    renderToc();
    return;
  }
  try {
    const d = await fetch('/api/toc?book=' + encodeURIComponent(S.book.id)).then(x => x.json());
    S.toc = { items: d.items || [], offset: d.offset || 0, source: d.source || '' };
  } catch (e) { S.toc = { items: [], offset: 0 }; }
  renderToc();
}

let tocQuery = '';
let noteQuery = '';
let noteSearchTimer = null;
(function bindSearch() {
  const ts = $('#tocSearch');
  if (ts) ts.addEventListener('input', e => { tocQuery = e.target.value.trim(); renderToc(); });
  const ns = $('#noteSearch');
  if (ns) ns.addEventListener('input', e => {
    noteQuery = e.target.value.trim();
    clearTimeout(noteSearchTimer);
    if (!noteQuery) { renderDrawer(); return; }
    noteSearchTimer = setTimeout(doGlobalSearch, 320);
  });
})();

async function doGlobalSearch() {
  const q = noteQuery;
  if (!q) return renderDrawer();
  try {
    const d = await fetch('/api/search?q=' + encodeURIComponent(q)).then(x => x.json());
    if (q !== noteQuery) return;          // 输入已变
    renderSearchResults(q, d.items || []);
  } catch { renderDrawer(); }
}

function renderSearchResults(q, items) {
  if (!items.length) {
    E.dlist.innerHTML = `<div class="dempty">全书里没有匹配「${esc(q)}」的内容。</div>`;
    return;
  }
  E.dlist.innerHTML = `<div class="srhint">全书搜到 ${items.length} 条</div>`;
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'ditem asked';
    el.innerHTML = `<div class="dp">${esc(it.book || '')} · 第 ${it.page} 页</div>
      <div class="dq">${esc(it.q || '（无提问）')}</div>
      ${it.a ? `<div class="da">${esc(it.a)}</div>` : ''}`;
    el.onclick = () => jumpTo(it.bookId, it.page);
    E.dlist.appendChild(el);
  });
}

async function jumpTo(bookId, page) {
  try {
    if (!S.book || S.book.id !== bookId) {
      const b = S.books.find(x => x.id === bookId);
      if (b) await openBook(b);
    }
    gotoPage(page);
    E.drawer.classList.remove('open');
    toast('第 ' + page + ' 页');
  } catch (e) { toast('跳转失败：' + e.message); }
}

function renderToc() {
  if (!E.tocList) return;
  const all = S.toc.items || [];
  const kw = tocQuery.toLowerCase();
  const items = kw
    ? all.filter(it => (it.title || '').toLowerCase().includes(kw) || String(it.page ?? '') === kw)
    : all;
  if (E.tocCount) E.tocCount.textContent = kw ? (items.length + '/' + all.length) : String(all.length);
  if (E.tocOffset) E.tocOffset.textContent = '偏移 ' + (S.toc.offset || 0);
  if (!all.length) {
    E.tocList.innerHTML = '<div class="toc-empty">这本书还没有目录。<br>点上面的「扫描」，让它读目录页自动生成（约 10 秒）。</div>';
    return;
  }
  if (!items.length) {
    E.tocList.innerHTML = '<div class="toc-empty">没找到匹配的章节。</div>';
    return;
  }
  const curBookPage = S.page - (S.toc.offset || 0);
  let curIdx = -1;
  items.forEach((it, i) => { if (it.page != null && it.page <= curBookPage) curIdx = i; });

  E.tocList.innerHTML = '';
  const off0 = S.toc.offset || 0;
  const pageHasNotes = (pdfPage) => {
    const d = (S.notes && S.notes.pages) ? S.notes.pages[String(pdfPage)] : null;
    return !!(d && (((d.chats || []).length) || ((d.marks || []).length)));
  };
  const rangeHasNotes = (fromBookPage, toBookPage) => {
    const a = clamp(fromBookPage + off0, 1, S.pages);
    const b = clamp(toBookPage + off0, 1, Math.min(S.pages, a + 60));
    for (let p = a; p <= b; p++) if (pageHasNotes(p)) return true;
    return false;
  };
  items.forEach((it, i) => {
    const el = document.createElement('div');
    el.className = 'toc-item lv' + Math.min(3, it.level || 1) + (i === curIdx ? ' cur' : '');
    let marked = false;
    if (it.page != null) {
      const next = items.slice(i + 1).find(x => x.page != null && x.page > it.page);
      const toPage = next ? next.page - 1 : it.page + 30;
      marked = rangeHasNotes(it.page, toPage);
    }
    el.innerHTML = `<span class="ti">${esc(it.title)}</span>`
      + (marked ? '<span class="dot" title="这一章有笔记"></span>' : '')
      + `<span class="pg">${it.page != null ? it.page : ''}</span>`;
    el.onclick = () => {
      if (it.page == null) { toast('这条没标页码'); return; }
      gotoPage(clamp(it.page + (S.toc.offset || 0), 1, S.pages));
      closeToc();
    };
    E.tocList.appendChild(el);
  });
  if (curIdx >= 0) {
    const cur = E.tocList.children[curIdx];
    if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 30);
  }
  updateChapterName();
}

function openToc() {
  if (!E.tocDrawer) return;
  E.drawer.classList.remove('open');
  E.tocDrawer.classList.add('open');
  const ts = $('#tocSearch');
  if (ts) { ts.value = ''; tocQuery = ''; }
  renderToc();
  setTimeout(() => { if (window.innerWidth > 900 && ts) ts.focus({ preventScroll: true }); }, 120);
}
function closeToc() { if (E.tocDrawer) E.tocDrawer.classList.remove('open'); }

if (E.btnToc) E.btnToc.onclick = () => {
  if (E.tocDrawer.classList.contains('open')) closeToc(); else openToc();
};
if ($('#tocClose')) $('#tocClose').onclick = closeToc;

if (E.tocOffset) E.tocOffset.onclick = async (e) => {
  e.stopPropagation();
  S.toc.offset = (S.toc.offset || 0) + (e.shiftKey ? -1 : 1);
  if (E.tocOffset) E.tocOffset.textContent = '偏移 ' + S.toc.offset;
  try {
    await fetch('/api/toc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: S.book.id, items: S.toc.items, offset: S.toc.offset }),
    });
  } catch { }
  renderToc();
  toast('页码偏移 = ' + S.toc.offset + '（点一下 +1，Shift 点 -1）');
};

if (E.tocScanBtn) E.tocScanBtn.onclick = async () => {
  if (!S.book || S.busy) return;
  const ans = prompt('从第几页开始读目录？（目录一般在前言后面，这本在 23 页左右）', '23');
  if (!ans) return;
  const frm = parseInt(ans, 10);
  if (!frm) return;
  const btn = E.tocScanBtn;
  btn.textContent = '扫描中…';
  btn.disabled = true;
  try {
    const r = await fetch('/api/toc/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: S.book.id, from: frm, to: frm + 7 }),
    }).then(x => x.json());
    if (r.error) toast('扫描失败：' + r.error);
    else { toast('抽到 ' + r.count + ' 条目录'); await loadToc(); }
  } catch (e) { toast('扫描失败：' + e.message); }
  btn.textContent = '扫描';
  btn.disabled = false;
};

/* ------------------------------------------------ 书签 */
function bmKey() { return 'jb_bm_' + (S.book ? S.book.id : ''); }
function loadBookmarks() {
  // 优先用随笔记落盘的（跟数据目录走，清浏览器缓存也不丢）
  if (S.notes && Array.isArray(S.notes.bookmarks)) return S.notes.bookmarks.slice();
  try { return JSON.parse(localStorage.getItem(bmKey()) || '[]'); } catch { return []; }
}
function saveBookmarks(list) {
  list = (list || []).slice().sort((a, b) => a.page - b.page);
  if (S.notes) { S.notes.bookmarks = list; saveNotes(); }   // 服务端持久化
  try { localStorage.setItem(bmKey(), JSON.stringify(list)); } catch { }
  renderBookmarks();
  updateBmBtn();
}
function updateBmBtn() {
  const btn = $('#btnBookmark');
  if (!btn) return;
  const has = loadBookmarks().some(b => b.page === S.page);
  btn.classList.toggle('on', has);
  btn.title = has ? '取消本页书签' : '给当前页加书签';
}
function currentChapterTitle(page) {
  const items = (S.toc && S.toc.items) || [];
  const off = S.toc.offset || 0;
  let cur = null;
  for (const it of items) {
    if (it.page != null && it.page + off <= page) cur = it;
    else if (it.page != null && it.page + off > page) break;
  }
  return cur ? cur.title : '第 ' + page + ' 页';
}
function toggleBookmark(page) {
  const list = loadBookmarks();
  const i = list.findIndex(b => b.page === page);
  if (i >= 0) { list.splice(i, 1); toast('已取消第 ' + page + ' 页的书签'); }
  else {
    list.push({ page, title: currentChapterTitle(page), ts: Date.now() });
    list.sort((a, b) => a.page - b.page);
    toast('已加书签：第 ' + page + ' 页');
  }
  saveBookmarks(list);
}
function renderBookmarks() {
  const box = $('#bmList');
  if (!box) return;
  const list = loadBookmarks();
  if (!list.length) {
    box.innerHTML = '<div class="bm-empty">还没有书签。<br>翻到某页，点顶栏的书签图标就钉住了。</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach(b => {
    const el = document.createElement('div');
    el.className = 'bm-item';
    el.innerHTML = `<span class="bmp">${b.page}</span><span class="bmt">${esc(b.title || '')}</span><span class="bmx" title="删除">×</span>`;
    el.onclick = (e) => {
      if (e.target.closest('.bmx')) {
        e.stopPropagation();
        saveBookmarks(loadBookmarks().filter(x => x.page !== b.page));
        return;
      }
      gotoPage(b.page);
      closeToc();
    };
    box.appendChild(el);
  });
}

(function bindBookmarkUI() {
  const btn = $('#btnBookmark');
  if (btn) btn.onclick = () => { if (S.book) toggleBookmark(S.page); };
  const tabs = $('#tocTabs');
  if (tabs) {
    tabs.addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (!b) return;
      tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b));
      const isToc = b.dataset.tab === 'toc';
      const tl = $('#tocList'), bl = $('#bmList'), sr = $('#tocSearch');
      if (tl) tl.hidden = !isToc;
      if (sr) sr.hidden = !isToc;
      if (bl) bl.hidden = isToc;
      if (!isToc) renderBookmarks();
    });
  }
})();

/* ------------------------------------------------ 连续滚动 */
S.scroll = false;
let spObserver = null;

function scrollEl() { return $('#scrollView'); }

function buildScroll() {
  const box = scrollEl();
  if (!box || !S.book) return;
  box.innerHTML = '';
  const ratio = (S.natH && S.natW) ? (S.natH / S.natW) : 1.4;
  const frag = document.createDocumentFragment();
  for (let p = 1; p <= S.pages; p++) {
    const d = document.createElement('div');
    d.className = 'sp';
    d.dataset.page = p;
    d.style.paddingBottom = '';           // 用宽高比撑高
    d.style.aspectRatio = '1 / ' + ratio.toFixed(4);
    d.innerHTML = `<div class="pm">第 ${p} 页</div><span class="pno">${p}</span><span class="jump">点这页切回单页提问</span>`;
    frag.appendChild(d);
  }
  box.appendChild(frag);
  if (spObserver) spObserver.disconnect();
  spObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const d = en.target;
      const p = +d.dataset.page;
      if (d.dataset.loaded) return;
      d.dataset.loaded = '1';
      const img = new Image();
      img.loading = 'lazy';
      img.alt = '';
      img.onload = () => {
        img.classList.add('loaded');
        const ph = d.querySelector('.pm');
        if (ph) ph.remove();
        d.style.aspectRatio = '';
        if (img.naturalWidth && img.naturalHeight) {
          d.style.aspectRatio = '1 / ' + (img.naturalHeight / img.naturalWidth).toFixed(4);
        }
      };
      img.src = pageUrl(S.book.id, p);
      d.insertBefore(img, d.firstChild);
    });
  }, { root: box, rootMargin: '600px 0px' });
  box.querySelectorAll('.sp').forEach(d => spObserver.observe(d));

  box.onscroll = () => {
    if (scrollLock) return;
    const mid = box.scrollTop + box.clientHeight * 0.42;
    let best = null, bestD = Infinity;
    box.querySelectorAll('.sp').forEach(d => {
      const dd = Math.abs((d.offsetTop + d.offsetHeight / 2) - mid);
      if (dd < bestD) { bestD = dd; best = d; }
    });
    if (best) {
      const p = +best.dataset.page;
      if (p !== S.page) {
        S.page = p;
        E.pageInput.value = p;
        localStorage.setItem('jb_page_' + S.book.id, String(p));
        updateProgress();
        updateChapterName();
        box.querySelectorAll('.sp.cur').forEach(x => x.classList.remove('cur'));
        best.classList.add('cur');
      }
    }
  };
  box.onclick = e => {
    const d = e.target.closest('.sp');
    if (!d) return;
    const p = +d.dataset.page;
    exitScroll();
    gotoPage(p);
    toast('已切回单页 · 第 ' + p + ' 页，点 ⬚ 框选提问');
    syncMode('sel');
  };
}

let scrollLock = false;
function scrollToPage(n) {
  const box = scrollEl();
  if (!box) return;
  const d = box.querySelector('.sp[data-page="' + n + '"]');
  if (!d) return;
  scrollLock = true;
  box.scrollTop = Math.max(0, d.offsetTop - 20);
  box.querySelectorAll('.sp.cur').forEach(x => x.classList.remove('cur'));
  d.classList.add('cur');
  setTimeout(() => { scrollLock = false; }, 160);
}
function enterScroll() {
  if (!S.book || !S.pages) return;
  S.scroll = true;
  S.double = false;
  E.wrap.hidden = true;
  const box = scrollEl();
  box.hidden = false;
  buildScroll();
  const target = box.querySelector('.sp[data-page="' + S.page + '"]');
  scrollLock = true;
  requestAnimationFrame(() => {
    if (target) box.scrollTop = target.offsetTop - 20;
    setTimeout(() => { scrollLock = false; }, 120);
  });
  const b = $('#btnLayout');
  if (b) { b.classList.add('on'); b.title = '滚动模式（点一下回单页）'; }
  toast('滚动阅读：上下滑，点任意页可切回单页提问');
}
function exitScroll() {
  S.scroll = false;
  const box = scrollEl();
  if (box) box.hidden = true;
  E.wrap.hidden = false;
  const b = $('#btnLayout');
  if (b) b.classList.remove('on');
  if (S.natW) { fit(); onPageLoaded(); }
}

function cycleLayout() {
  if (S.scroll) { exitScroll(); toast('单页模式'); return; }
  if (S.double) { setDouble(false); enterScroll(); return; }
  setDouble(true);
}

/* ------------------------------------------------ drawer */
let panelWasOpen = false;
$('#btnList').onclick = () => {
  const ns = $('#noteSearch');
  if (ns) { ns.value = ''; noteQuery = ''; }
  renderDrawer();
  panelWasOpen = !E.panel.classList.contains('hidden');
  E.panel.classList.add('hidden');   // 抽屉打开时让浮窗退场，避免叠在一起
  E.tocDrawer.classList.remove('open');
  E.drawer.classList.add('open');
};
$('#dClose').onclick = () => {
  E.drawer.classList.remove('open');
  if (panelWasOpen) E.panel.classList.remove('hidden');
};
function renderDrawer() {
  E.dlist.innerHTML = '';
  const rows = [];
  Object.keys(S.notes.pages).forEach(k => {
    const d = S.notes.pages[k];
    (d.marks || []).forEach(m => rows.push({ page: +k, m }));
    (d.chats || []).forEach(c => rows.push({ page: +k, m: { question: c.q, answer: c.a, ts: c.ts, chat: true } }));
  });
  rows.sort((a, b) => (b.m.ts || 0) - (a.m.ts || 0));
  if (E.dCount) E.dCount.textContent = String(rows.length);
  if (noteQuery) {
    const k = noteQuery.toLowerCase();
    rows = rows.filter(r => ((r.m.question || '') + ' ' + (r.m.answer || '')).toLowerCase().includes(k));
  }
  if (!rows.length) {
    E.dlist.innerHTML = noteQuery
      ? '<div class="dempty">没有匹配的疑点。</div>'
      : '<div class="dempty">还没有疑点。圈一块区域问一下，就会记在这里。</div>';
    return;
  }
  rows.slice(0, 200).forEach(r => {
    const el = document.createElement('div');
    el.className = 'ditem' + (r.m.answer ? ' asked' : '');
    el.innerHTML = `<div class="dp">第 ${r.page} 页${r.m.chat ? '' : ' · 框选'}</div>
      <div class="dq">${esc(r.m.question || '（未提问）')}</div>
      ${r.m.answer ? `<div class="da">${esc(r.m.answer.slice(0, 160))}</div>` : ''}`;
    el.onclick = () => {
      E.drawer.classList.remove('open');
      if (r.page !== S.page) gotoPage(r.page);
      openPanel();
      toast('第 ' + r.page + ' 页');
    };
    E.dlist.appendChild(el);
  });
}

/* ------------------------------------------------ settings */
async function loadSettings() {
  let s;
  if (OFF) {
    s = offSettings();
    s.has_key = !!localStorage.getItem('jb_off_key');
    s.books_dir = '离线版（数据都在这台设备）';
  } else {
    s = await fetch('/api/settings').then(x => x.json()).catch(() => ({}));
  }
  S.settings = s;
  E.booksPath.textContent = s.books_dir || '教材伴读\\books';
  $('#sBase').value = s.base_url || '';
  $('#sModel').value = s.model || '';
  $('#sTemp').value = s.temperature ?? 0.3;
  $('#sPrompt').value = s.system_prompt || '';
  $('#sKey').placeholder = s.has_key ? '已保存（留空不修改）' : '粘贴你的 API Key';
  const sel = $('#sStyle');
  if (sel) sel.value = styleOfPrompt(s.system_prompt || '');
}
$('#btnSet').onclick = () => { E.setModal.hidden = false; $('#sTestOut').textContent = ''; };
$('#sCancel').onclick = () => { E.setModal.hidden = true; };
$('#sTest').onclick = async () => {
  const out = $('#sTestOut');
  out.className = 'tip'; out.textContent = '测试中…';
  if (OFF) {
    try {
      const key = $('#sKey').value.trim() || localStorage.getItem('jb_off_key') || '';
      if (!key) throw new Error('先填 API Key');
      const base = ($('#sBase').value.trim() || OFF_API).replace(/\/+$/, '');
      const model = $('#sModel').value.trim() || 'deepseek-chat';
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8 }),
      });
      if (!r.ok) throw new Error(offErrText(r.status, await r.text()));
      const j = await r.json();
      out.className = 'tip ok';
      out.textContent = '✓ 通了：' + ((j.choices && j.choices[0] && j.choices[0].message.content) || '正常').slice(0, 40);
    } catch (e) {
      out.className = 'tip bad'; out.textContent = '✗ ' + e.message;
    }
    return;
  }
  const r = await fetch('/api/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: $('#sBase').value.trim(),
      api_key: $('#sKey').value.trim(),
      model: $('#sModel').value.trim(),
    }),
  }).then(x => x.json()).catch(e => ({ ok: false, error: String(e) }));
  if (r.ok) { out.className = 'tip ok'; out.textContent = '✓ 通了：' + (r.reply || '正常'); }
  else { out.className = 'tip bad'; out.textContent = '✗ ' + (r.error || '失败'); }
};
$('#sSave').onclick = async () => {
  const patch = {
    base_url: $('#sBase').value.trim(),
    model: $('#sModel').value.trim(),
    temperature: parseFloat($('#sTemp').value) || 0.3,
    system_prompt: $('#sPrompt').value,
  };
  const key = $('#sKey').value.trim();
  if (key) patch.api_key = key;
  if (OFF) {
    if (key) localStorage.setItem('jb_off_key', key);
    localStorage.setItem('jb_off_settings', JSON.stringify(patch));
    E.setModal.hidden = true;
    toast('已保存到这台设备');
    return;
  }
  await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  E.setModal.hidden = true;
  toast('已保存');
};
$('#btnBooks').onclick = () => { renderBookList(); E.booksModal.hidden = false; };
/* 长按书名 → 命令面板 */
(function holdBookPill() {
  const pill = $('#btnBooks');
  if (!pill) return;
  let t = null, moved = false;
  pill.addEventListener('pointerdown', e => {
    moved = false;
    const x0 = e.clientX, y0 = e.clientY;
    const mv = ev => { if (Math.abs(ev.clientX - x0) > 10 || Math.abs(ev.clientY - y0) > 10) moved = true; };
    pill.addEventListener('pointermove', mv);
    t = setTimeout(() => {
      pill.removeEventListener('pointermove', mv);
      if (!moved) openCmd();
    }, 520);
    pill.addEventListener('pointerup', function up() {
      clearTimeout(t);
      pill.removeEventListener('pointerup', up);
      pill.removeEventListener('pointermove', mv);
    }, { once: true });
  });
})();
$('#bClose').onclick = () => { E.booksModal.hidden = true; };
$('#bReload').onclick = () => { E.booksModal.hidden = true; loadBooks().then(() => toast('已重新扫描')); };
$('#emptyReload').onclick = () => loadBooks();

/* ------------------------------------------------ misc */
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); nextPage(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevPage(); }
  if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); nextPage(); }
  if (e.key === 'Home') { e.preventDefault(); gotoPage(1); }
  if (e.key === 'End') { e.preventDefault(); gotoPage(S.pages); }
  if (e.key === '+' || e.key === '=') { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, S.scale * 1.25); }
  if (e.key === '-') { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, S.scale / 1.25); }
  if (e.key === '0') fit();
  if (e.key === 'Escape') {
    const mid = cmdModal && !cmdModal.hidden;
    if (mid) { closeCmd(); return; }
    if (S.region) { cancelRegion(); return; }
    E.drawer.classList.remove('open'); closeToc();
    E.setModal.hidden = true; E.booksModal.hidden = true;
    if (helpModal) helpModal.hidden = true;
    if ($('#thumbModal')) $('#thumbModal').hidden = true;
    hideSelActions(); syncMode('read');
  }
  const k = e.key.toLowerCase();
  if (k === 'b' && S.book) { toggleBookmark(S.page); }
  if (k === 't') { E.tocDrawer.classList.contains('open') ? closeToc() : openToc(); }
  if (k === 'l') { $('#btnList').click(); }
  if (k === 'f') { applyFx(fxIdx + 1); toast('显示：' + FX_NAMES[fxIdx]); }
  if (k === 'd') { setDouble(!S.double); }
  if (e.key === '?') { openHelp(); }
  if ((e.ctrlKey || e.metaKey) && (k === 'k' || k === 'f')) { e.preventDefault(); openCmd(); }
  if (k === '/' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openCmd(); }
});

window.addEventListener('resize', () => {
  if (!S.natW) return;
  const old = S.scale / S.fit;
  fit();
  if (old > 1.02) { S.scale = S.fit * old; clampT(); applyT(); }
});

E.stage.addEventListener('wheel', e => {
  if (!S.book) return;
  e.preventDefault();
  const r = stageRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, S.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
}, { passive: false });

/* ------------------------------------------------ UI 增强 */
function toggleUI(force) {
  const hide = typeof force === 'boolean' ? force : !S.uiHidden;
  S.uiHidden = hide;
  E.topbar.classList.toggle('hide', hide);
  E.pager.classList.toggle('hide', hide);
  if (hide) E.zoombadge.classList.remove('show');
  if (S.natW && S.scale <= S.fit * 1.06) {
    // 未手动缩放时，随工具栏显隐重新排版，让页面用满可用高度
    S.wrap && E.wrap.classList.add('smooth');
    fit();
    setTimeout(() => E.wrap.classList.remove('smooth'), 240);
  }
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('jb_theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f2f4f8' : '#0b0d11');
  if (E.btnTheme) E.btnTheme.title = t === 'light' ? '切到深色' : '切到浅色';
}
if (E.btnTheme) {
  E.btnTheme.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    toast(cur === 'dark' ? '浅色模式' : '深色模式');
  };
}

let zbTimer = null;
function showZoom() {
  if (!E.zoombadge) return;
  const pct = Math.round((S.scale / (S.fit || 1)) * 100);
  if (pct <= 103) { E.zoombadge.classList.remove('show'); return; }
  E.zoombadge.textContent = pct + '%';
  E.zoombadge.hidden = false;
  E.zoombadge.classList.add('show');
  clearTimeout(zbTimer);
  zbTimer = setTimeout(() => E.zoombadge.classList.remove('show'), 900);
}
const _applyT = applyT;
applyT = function () { _applyT(); showZoom(); };

/* 快捷提问 */
if (E.chips) {
  E.chips.addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    E.q.value = b.dataset.q || '';
    autoGrow();
    if (!S.busy) send();
  });
}

/* 温度滑块 */
const sTemp = $('#sTemp'), sTempVal = $('#sTempVal');
if (sTemp) {
  sTemp.addEventListener('input', () => { if (sTempVal) sTempVal.textContent = (+sTemp.value).toFixed(1); });
}

/* ------------------------------------------------ 导出 / PWA */
const dExport = $('#dExport');
if (dExport) dExport.onclick = async () => {
  if (!S.book) return;
  try {
    const r = await fetch('/api/export?book=' + encodeURIComponent(S.book.id)).then(x => x.json());
    const blob = new Blob([r.markdown || ''], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (S.book.title || 'notes').replace(/[\\/:*?"<>|]/g, '_') + ' · 笔记.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已导出 Markdown 笔记');
  } catch (e) { toast('导出失败：' + e.message); }
};

/* 本地服务常在线，Service Worker 只会让「改完看不到新版」。
   这里主动注销旧 SW、清掉它的缓存，然后自动刷新一次换成磁盘上的新版。 */
const APP_VER = '2026-11-12.3';
(function killOldSW() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length) await Promise.all(regs.map(r => r.unregister()));
      let cleared = false;
      if (window.caches) {
        const ks = await caches.keys();
        if (ks.length) { await Promise.all(ks.map(k => caches.delete(k))); cleared = true; }
      }
      if ((regs.length || cleared) && !sessionStorage.getItem('jb_swfix')) {
        sessionStorage.setItem('jb_swfix', '1');
        location.reload();
      }
    } catch (e) { }
  })();
})();

/* ------------------------------------------------ 扫描件增强 / 帮助 */
const FX_MODES = ['', 'fx-clear', 'fx-hard'];
const FX_NAMES = ['原图', '清晰', '高对比'];
let fxIdx = parseInt(localStorage.getItem('jb_fx') || '0', 10) || 0;
function applyFx(i) {
  fxIdx = (i + FX_MODES.length) % FX_MODES.length;
  localStorage.setItem('jb_fx', String(fxIdx));
  E.stage.classList.remove('fx-clear', 'fx-hard');
  if (FX_MODES[fxIdx]) E.stage.classList.add(FX_MODES[fxIdx]);
  const b = $('#btnFx');
  if (b) { b.classList.toggle('on', fxIdx > 0); b.title = '扫描件增强：' + FX_NAMES[fxIdx]; }
}
if ($('#btnFx')) $('#btnFx').onclick = () => { applyFx(fxIdx + 1); toast('显示：' + FX_NAMES[fxIdx]); };

const helpModal = $('#helpModal');
function openHelp() { if (helpModal) helpModal.hidden = false; }
if ($('#helpClose')) $('#helpClose').onclick = () => { if (helpModal) helpModal.hidden = true; };
if (helpModal) helpModal.addEventListener('click', e => { if (e.target === helpModal) helpModal.hidden = true; });

/* 错误态重试 + 页码输入体验 + 章节名点击开目录 */
(function polish() {
  const retry = $('#peRetry');
  if (retry) retry.onclick = () => {
    const box = $('#pageError');
    if (box) box.hidden = true;
    const cur = E.img.getAttribute('src');
    E.img.removeAttribute('src');
    setTimeout(() => gotoPage(S.page), 60);
  };
  if (E.pageInput) {
    E.pageInput.addEventListener('focus', () => setTimeout(() => E.pageInput.select(), 10));
  }
  const cn = $('#chapterName');
  if (cn) { cn.style.cursor = 'pointer'; cn.onclick = () => openToc(); }
})();

/* ------------------------------------------------ 长按放大镜 */
const lensCanvas = document.createElement('canvas');
lensCanvas.id = 'lens';
lensCanvas.width = 336; lensCanvas.height = 336;
document.body.appendChild(lensCanvas);

let lensTimer = null, lensOn = false, lensX = 0, lensY = 0;

function lensDraw(cx, cy) {
  const r = E.wrap.getBoundingClientRect();
  if (!r.width || !r.height) return hideLens();
  const nx = (cx - r.left) / r.width;
  const ny = (cy - r.top) / r.height;
  if (nx < -0.02 || nx > 1.02 || ny < -0.02 || ny > 1.02) return hideLens();

  let src = E.img;
  let localNx = nx;
  if (S.double && nx > 0.5 && E.img2 && !E.img2.hidden && E.img2.naturalWidth) {
    src = E.img2;
    localNx = (nx - 0.5) * 2;
  } else if (S.double) {
    localNx = nx * 2;
  }
  if (!src || !src.naturalWidth) return;

  const BOX = 168;                          // 屏幕上的直径
  const ZOOM = 3;
  const sw = Math.max(24, BOX / Math.max(0.05, S.scale * ZOOM));
  const sh = sw;
  const sx = clamp(localNx * src.naturalWidth - sw / 2, 0, Math.max(0, src.naturalWidth - sw));
  const sy = clamp(ny * src.naturalHeight - sh / 2, 0, Math.max(0, src.naturalHeight - sh));

  const ctx = lensCanvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, lensCanvas.width, lensCanvas.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, lensCanvas.width, lensCanvas.height);

  lensCanvas.style.left = cx + 'px';
  lensCanvas.style.top = cy + 'px';
  lensCanvas.classList.add('show');
  lensOn = true;
}

function hideLens() {
  lensOn = false;
  lensCanvas.classList.remove('show');
}

E.stage.addEventListener('pointerdown', e => {
  if (S.mode !== 'read' || S.scroll || !S.book) return;
  lensX = e.clientX; lensY = e.clientY;
  clearTimeout(lensTimer);
  lensTimer = setTimeout(() => { if (!ptrs.size || ptrs.size === 1) lensDraw(lensX, lensY); }, 520);
}, true);

E.stage.addEventListener('pointermove', e => {
  if (lensOn) {
    lensX = e.clientX; lensY = e.clientY;
    lensDraw(lensX, lensY);
    e.preventDefault();
    return;
  }
  if (lensTimer && (Math.abs(e.clientX - lensX) > 12 || Math.abs(e.clientY - lensY) > 12)) {
    clearTimeout(lensTimer);
    lensTimer = null;
  }
}, { passive: false });

['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
  E.stage.addEventListener(ev, () => { clearTimeout(lensTimer); lensTimer = null; hideLens(); }));

/* ------------------------------------------------ 学习统计 */
function collectStats(notesObj, pages) {
  const n = notesObj || { pages: {} };
  let marks = 0, chats = 0, pagesTouched = 0;
  const dayMap = {};
  for (const k in (n.pages || {})) {
    const d = n.pages[k];
    const m = (d.marks || []).length, c = (d.chats || []).length;
    if (m || c) pagesTouched++;
    marks += m;
    chats += c;
    [...(d.chats || []), ...(d.marks || [])].forEach(x => {
      const ts = x.ts || 0;
      if (!ts) return;
      const day = new Date(ts).toISOString().slice(0, 10);
      dayMap[day] = (dayMap[day] || 0) + 1;
    });
  }
  return { marks, chats, pagesTouched, total: pages || 0, dayMap };
}

function openStats() {
  const modal = $('#statsModal');
  if (!modal) return;
  const st = collectStats(S.notes, S.pages);
  const bm = loadBookmarks().length;
  const pct = st.total ? Math.round((st.pagesTouched / st.total) * 100) : 0;

  // 最近 7 天
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, label: (d.getMonth() + 1) + '/' + d.getDate(), cnt: st.dayMap[key] || 0 });
  }
  const maxC = Math.max(1, ...days.map(d => d.cnt));

  $('#statsBook').textContent = S.book ? S.book.title : '';
  $('#statsBody').innerHTML = `
    <div class="stats-grid">
      <div class="stat-box"><b>${st.chats}</b><span>本书提问</span></div>
      <div class="stat-box"><b>${st.marks}</b><span>本书疑点</span></div>
      <div class="stat-box"><b>${bm}</b><span>书签</span></div>
      <div class="stat-box"><b>${st.pagesTouched}</b><span>做过笔记的页</span></div>
      <div class="stat-box"><b>${pct}%</b><span>覆盖全书</span></div>
    </div>
    <div class="week">
      ${days.map(d => `<div class="wd"><div class="bar" style="height:${Math.round((d.cnt / maxC) * 70) + 3}px" title="${d.cnt} 条"></div><div class="dl">${d.label}</div></div>`).join('')}
    </div>
    <div class="stats-note">最近 7 天的提问 + 疑点数量。共 ${st.total} 页，${st.pagesTouched} 页留下过痕迹。</div>
  `;
  modal.hidden = false;
}
(function bindStats() {
  const b = $('#openStats');
  if (b) b.onclick = () => { E.setModal.hidden = true; openStats(); };
  const c = $('#statsClose');
  if (c) c.onclick = () => { $('#statsModal').hidden = true; };
  const m = $('#statsModal');
  if (m) m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
})();

/* 字号滑块 */
(function bindFont() {
  const f = $('#sFont');
  if (!f) return;
  f.value = msgFs;
  applyMsgFont(msgFs);
  f.addEventListener('input', () => applyMsgFont(parseFloat(f.value)));
})();

/* ------------------------------------------------ 讲解风格预设 */
const STYLE_PROMPTS = {
  teach: `你是一位极其耐心的理工科教材讲解老师，学生用的是中文教材，常是扫描页。
学生给你一页或一页中的一小块区域图片，以及他自己的疑问或想法。请：
1. 先用一两句话定位：这块内容在讲什么、属于哪个已学概念；
2. 再按步骤讲清推导 / 定义 / 条件，关键处说明「为什么会想到这一步」；
3. 学生若提出了具体疑问或自己的想法，直接针对它作答（包括指出他想错在哪）；
4. 需要时补一个小数值例子或一个生活类比；
5. 最后用一行「👉 可以继续问：」给出两个更具体的追问方向。
全部使用简体中文。公式写成一行可读的普通字符形式（例如 v = L·di/dt、P = U²/R），必要时才用行内 $...$。不要大段复述原文，不要客套。`,
  brief: `你是理工科教材速读助手。学生给你一页或一块区域的扫描图。
请只用最少的字给结论，结构固定为：
1. 一句话：这页在讲什么（不超过 30 字）
2. 关键式子：1–3 个，每个后面跟半句适用条件
3. 一句话：它和前一节/后一节的关系
不要推导过程，不要举例，不要客套。全部简体中文。
最后用一行「👉 可以继续问：」给两个追问方向。`,
  exam: `你是考研 / 期末冲刺辅导老师。学生给你一页教材扫描图。
请按考点组织回答，固定四段（没有就写「无」）：
**① 必背定义与条件**
**② 必会公式**（每条标出适用条件）
**③ 常考题型**（这页内容通常怎么出题）
**④ 易错点**
每个要点后面用「【记忆】」加一句不超过 15 字的口诀。
全部简体中文，公式写成一行的普通字符形式。最后用一行「👉 可以继续问：」给两个追问方向。`,
  plain: `你是一个刚学懂了这门课的学长，用大白话给学弟讲。
顺序固定：先打一个生活里的比方 → 再讲原理是怎么来的 → 最后说一句「考试会怎么考」。
避免术语堆砌；必须用术语时，紧接着用括号解释一句。语气自然，像聊天。
全部简体中文，公式写成一行可读的普通字符。最后用一行「👉 可以继续问：」给两个追问方向。`,
};

function styleOfPrompt(p) {
  const s = String(p || '');
  if (s.includes('速读助手')) return 'brief';
  if (s.includes('冲刺辅导老师')) return 'exam';
  if (s.includes('学长')) return 'plain';
  return 'teach';
}
(function bindStyle() {
  const sel = $('#sStyle');
  if (!sel) return;
  sel.value = styleOfPrompt($('#sPrompt') ? $('#sPrompt').value : '');
  sel.addEventListener('change', () => {
    const p = STYLE_PROMPTS[sel.value];
    if (p && $('#sPrompt')) $('#sPrompt').value = p;
    toast('已切换风格，点「保存」生效');
  });
})();

/* ------------------------------------------------ 阅读状态记忆 */
function saveViewState() {
  if (!S.book) return;
  try {
    const st = {
      zoom: +(S.scale / (S.fit || 1)).toFixed(2),
      mode: S.scroll ? 'scroll' : (S.double ? 'double' : 'single'),
    };
    localStorage.setItem('jb_view_' + S.book.id, JSON.stringify(st));
  } catch { }
}
function restoreView() {
  if (!S.book) return;
  let st = null;
  try { st = JSON.parse(localStorage.getItem('jb_view_' + S.book.id) || 'null'); } catch { }
  if (!st) return;
  if (st.mode === 'scroll' && !S.scroll) { enterScroll(); return; }
  if (st.mode === 'double' && !S.double) setDouble(true);
  if (st.zoom > 1.06) {
    setTimeout(() => {
      const r = stageRect();
      zoomAt(r.width / 2, r.height / 2, S.fit * clamp(st.zoom, 1, 8));
    }, 300);
  }
}
window.addEventListener('beforeunload', saveViewState);

/* 长按页码箭头连续翻页 */
(function bindHoldPage() {
  ['prev', 'next'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    let t1 = null, t2 = null;
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      stop();
      t1 = setTimeout(() => {
        t2 = setInterval(() => { id === 'next' ? nextPage() : prevPage(); }, 190);
      }, 520);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stop));
  });
})();

/* ------------------------------------------------ 存储与备份 */
/* （云同步模块见 sync.js，这里只做 UI 绑定） */
(function bindSyncUI() {
  const tok = $('#sSyncToken');
  const st = $('#syncState');
  const cfg = $('#btnSyncConfig');
  const now = $('#btnSyncNow');
  if (!cfg) return;
  const refresh = () => {
    if (!st) return;
    st.textContent = (typeof SYNC !== 'undefined' && SYNC.enabled()) ? '已连接' : '未配置';
  };
  refresh();
  cfg.onclick = async () => {
    const v = (tok && tok.value.trim()) || '';
    if (v) localStorage.setItem(SYNC.TOKEN_KEY, v);
    if (!SYNC.token()) { toast('先填 token'); return; }
    try {
      cfg.disabled = true;
      if (!SYNC.gistId()) await syncCreateGist();
      await syncNow(true);
      refresh();
      toast('云同步已开启');
    } catch (e) { toast(e.message); }
    cfg.disabled = false;
  };
  now.onclick = async () => {
    try { const ok = await syncNow(false); if (ok) refresh(); } catch (e) { toast(e.message); }
  };
})();

async function refreshCacheInfo() {
  const lbl = $('#cacheInfo');
  if (!lbl) return;
  const ver = $('#appVer');
  if (ver) ver.textContent = OFF ? '离线版 · 数据都存在这台设备' : ('界面版本 ' + APP_VER + ' · 选区取消在选框右上角 ✕');
  if (OFF) {
    let bytes = 0;
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.indexOf('jb_off_notes_') === 0) bytes += (localStorage.getItem(k) || '').length;
      }
    } catch (e) { }
    lbl.textContent = '笔记 ' + (bytes / 1024).toFixed(0) + ' KB · ' + (S.books.length || 0) + ' 本书';
    return;
  }
  try {
    const c = await fetch('/api/cache').then(x => x.json());
    const mb = (c.cacheBytes / 1048576).toFixed(0);
    lbl.textContent = `页图缓存 ${mb} MB · 笔记 ${(c.notesBytes / 1024).toFixed(0)} KB`;
  } catch { lbl.textContent = '读取失败'; }
}
(function bindStorage() {
  const bk = $('#btnBackup');
  if (bk) bk.onclick = () => {
    if (OFF) { toast('离线版没有服务器备份 —— 笔记已经存在这台设备，重装浏览器前记得导出'); return; }
    const a = document.createElement('a');
    a.href = '/api/backup';
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
    toast('正在导出备份 zip…');
  };
  const cl = $('#btnCleanCache');
  if (cl) cl.onclick = async () => {
    if (OFF) {
      let bytes = 0;
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.indexOf('jb_off_notes_') === 0) bytes += (localStorage.getItem(k) || '').length;
        }
      } catch (e) { }
      toast('笔记占用约 ' + (bytes / 1024).toFixed(0) + ' KB · 页图由系统管理');
      return;
    }
    if (!confirm('清掉页图缓存？笔记和书签不受影响，只是下次翻页要重新渲染。')) return;
    cl.disabled = true;
    try {
      const r = await fetch('/api/cache/clean', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepMb: 200 }),
      }).then(x => x.json());
      toast(`已删 ${r.removed} 个文件，释放 ${(r.freedBytes / 1048576).toFixed(0)} MB`);
      refreshCacheInfo();
    } catch (e) { toast('清理失败：' + e.message); }
    cl.disabled = false;
  };
  const sm = $('#btnSet');
  if (sm) sm.addEventListener('click', () => setTimeout(refreshCacheInfo, 300));
})();

/* ------------------------------------------------ 命令面板 */
const cmdModal = $('#cmdModal');
let cmdRows = [], cmdIdx = 0;

const CMD_ACTIONS = [
  { k: '目录', icon: '☰', run: () => openToc() },
  { k: '书签', icon: '🔖', run: () => { $('#btnBookmark').click(); } },
  { k: '疑点清单', icon: '≡', run: () => $('#btnList').click() },
  { k: '设置', icon: '⚙', run: () => { E.setModal.hidden = false; refreshCacheInfo(); } },
  { k: '学习统计', icon: '📊', run: () => openStats() },
  { k: '切换单/双页/滚动', icon: '▯', run: () => cycleLayout() },
  { k: '切换深浅主题', icon: '☀', run: () => $('#btnTheme').click() },
  { k: '扫描件增强', icon: '◐', run: () => $('#btnFx').click() },
  { k: '书架', icon: '📚', run: () => { renderBookList(); E.booksModal.hidden = false; } },
  { k: '导出全部备份', icon: '⬇', run: () => { location.href = '/api/backup'; } },
  { k: '适应宽度 / 适应整页', icon: '⇔', run: () => {
      S.fitMode = S.fitMode === 'width' ? 'height' : 'width';
      localStorage.setItem('jb_fitmode', S.fitMode);
      fit();
      toast(S.fitMode === 'width' ? '适应宽度（可上下拖）' : '适应整页');
    } },
  { k: '页面缩略图', icon: '▦', run: () => openThumbs() },
  { k: '快捷键说明', icon: '?', run: () => openHelp() },
];

function buildCmdResults(q) {
  const out = [];
  const s = (q || '').trim();
  const num = s.match(/^(\d{1,4})$/);
  if (num) {
    const p = parseInt(num[1], 10);
    out.push({ icon: '➤', text: `跳到第 ${p} 页`, key: '页码', run: () => gotoPage(p) });
  }
  const pct = s.match(/^%?\s*(\d{1,3})\s*%?$/);
  if (pct && !num) {
    const r = clamp(parseInt(pct[1], 10), 1, 99);
    const p = Math.max(1, Math.round(S.pages * r / 100));
    out.push({ icon: '➤', text: `跳到全书 ${r}%（第 ${p} 页）`, key: '百分比', run: () => gotoPage(p) });
  }
  const items = (S.toc && S.toc.items) || [];
  const low = s.toLowerCase();
  const hits = items
    .filter(it => {
      if (!s) return it.level === 1;
      return (it.title || '').toLowerCase().includes(low) || String(it.page ?? '') === s;
    })
    .slice(0, s ? 12 : 8);
  hits.forEach(it => out.push({
    icon: '§', text: it.title, key: it.page != null ? 'p.' + it.page : '',
    run: () => { if (it.page != null) gotoPage(clamp(it.page + (S.toc.offset || 0), 1, S.pages)); },
  }));
  CMD_ACTIONS
    .filter(a => !s || a.k.toLowerCase().includes(low))
    .forEach(a => out.push({ icon: a.icon, text: a.k, key: '命令', run: a.run }));
  return out.slice(0, 16);
}

function renderCmd(q) {
  cmdRows = buildCmdResults(q);
  cmdIdx = 0;
  const box = $('#cmdList');
  if (!cmdRows.length) {
    const n = ((S.toc && S.toc.items) || []).length;
    box.innerHTML = `<div class="cmd-empty">没有匹配项{目录 ${n} 条}<br><span style="font-size:11.5px">也可以直接输页码，或输入「目录 / 设置」等命令</span></div>`;
    return;
  }
  box.innerHTML = cmdRows.map((r, i) =>
    `<div class="cmd-row${i === 0 ? ' on' : ''}" data-i="${i}">
       <span class="ci">${esc(r.icon)}</span>
       <span class="ct">${esc(r.text)}</span>
       <span class="ck">${esc(r.key || '')}</span>
     </div>`).join('');
  box.scrollTop = 0;
}

function cmdMove(d) {
  if (!cmdRows.length) return;
  cmdIdx = clamp(cmdIdx + d, 0, cmdRows.length - 1);
  [...$('#cmdList').children].forEach((el, i) => el.classList.toggle('on', i === cmdIdx));
  const cur = $('#cmdList').children[cmdIdx];
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function cmdRun(i) {
  const r = cmdRows[i];
  if (!r) return;
  closeCmd();
  try { r.run(); } catch (e) { toast('执行失败：' + e.message); }
}

async function openCmd() {
  if (!cmdModal) return;
  if (S.book && (!S.toc || !(S.toc.items || []).length)) {
    try { await loadToc(); } catch { }
  }
  cmdModal.hidden = false;
  const inp = $('#cmdInput');
  inp.value = '';
  renderCmd('');
  setTimeout(() => inp.focus(), 30);
}
function closeCmd() { if (cmdModal) cmdModal.hidden = true; }

(function bindCmd() {
  if (!cmdModal) return;
  const inp = $('#cmdInput');
  inp.addEventListener('input', () => renderCmd(inp.value));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); cmdRun(cmdIdx); }
    else if (e.key === 'Escape') { closeCmd(); }
  });
  $('#cmdList').addEventListener('click', e => {
    const row = e.target.closest('.cmd-row');
    if (row) cmdRun(+row.dataset.i);
  });
  cmdModal.addEventListener('click', e => { if (e.target === cmdModal) closeCmd(); });
})();

/* ------------------------------------------------ 纸笔进度标记 + 习惯设置 */
S.keepChat = localStorage.getItem('jb_keepchat') !== '0';

function markerKey() { return 'jb_marker_' + (S.book ? S.book.id : ''); }
function getMarker() {
  try { return JSON.parse(localStorage.getItem(markerKey()) || 'null'); } catch { return null; }
}
function setMarker(page) {
  localStorage.setItem(markerKey(), JSON.stringify({ page, at: Date.now() }));
  renderMarker();
  toast('已标记：纸质笔记写到第 ' + page + ' 页');
}
function renderMarker() {
  const el = $('#markerDot');
  const btn = $('#btnMarker');
  const m = getMarker();
  if (el) {
    if (m && m.page) {
      el.textContent = '✎ p.' + m.page;
      el.classList.remove('hide');
      el.title = '纸笔笔记写到这里了，点一下跳回去';
      el.onclick = () => gotoPage(m.page);
    } else el.classList.add('hide');
  }
  if (btn) btn.classList.toggle('on', !!(m && m.page === S.page));
}
if ($('#btnMarker')) $('#btnMarker').onclick = () => {
  const m = getMarker();
  if (m && m.page === S.page) {
    localStorage.removeItem(markerKey());
    renderMarker();
    toast('已清除这页的纸笔标记');
  } else setMarker(S.page);
};

/* 保存时按习惯剥离对话记录 */
const _saveNotesRaw = saveNotes;
saveNotes = function () {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.book) return;
    let payload = S.notes;
    if (!S.keepChat) {
      const clone = JSON.parse(JSON.stringify(S.notes));
      Object.keys(clone.pages || {}).forEach(k => { delete clone.pages[k].chats; });
      payload = clone;
    }
    fetch('/api/notes?book=' + encodeURIComponent(S.book.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { });
  }, 600);
};

/* 打印 / 清空本页 */
(function bindMisc() {
  const pr = $('#btnPrint');
  if (pr) pr.onclick = () => { E.setModal.hidden = true; setTimeout(() => window.print(), 120); };
  const cp = $('#btnClearPage');
  if (cp) cp.onclick = () => {
    if (!S.book) return;
    if (!confirm('清空第 ' + S.page + ' 页的对话记录？（框选和手写不受影响）')) return;
    const d = pd(S.page);
    d.chats = [];
    renderChats();
    saveNotes();
    toast('已清空本页对话');
  };
  const kc = $('#sKeepChat');
  if (kc) {
    kc.value = S.keepChat ? '1' : '0';
    kc.addEventListener('change', () => {
      S.keepChat = kc.value === '1';
      localStorage.setItem('jb_keepchat', S.keepChat ? '1' : '0');
      if (!S.keepChat) { saveNotes(); toast('之后的对话不再写盘，只在当前会话里显示'); }
      else toast('对话会随笔记一起保存');
    });
  }
})();

/* ------------------------------------------------ 缩略图导航 */
let thumbObserver = null;

function openThumbs() {
  const modal = $('#thumbModal');
  if (!modal || !S.book) return;
  const grid = $('#thumbGrid');
  const info = $('#thumbInfo');
  if (info) info.textContent = S.book.title + ' · ' + S.pages + ' 页';
  grid.innerHTML = '';

  const frag = document.createDocumentFragment();
  for (let p = 1; p <= S.pages; p++) {
    const d = document.createElement('div');
    d.className = 'tg' + (p === S.page ? ' cur' : '');
    d.dataset.page = p;
    d.innerHTML = `<span>${p}</span>`;
    frag.appendChild(d);
  }
  grid.appendChild(frag);

  if (thumbObserver) thumbObserver.disconnect();
  thumbObserver = new IntersectionObserver(es => {
    es.forEach(en => {
      if (!en.isIntersecting) return;
      const d = en.target;
      const p = +d.dataset.page;
      if (d.dataset.done) return;
      d.dataset.done = '1';
      const img = new Image();
      img.loading = 'lazy';
      img.onload = () => img.classList.add('on');
      img.src = '/thumb/' + encodeURIComponent(S.book.id) + '/' + p;
      d.insertBefore(img, d.firstChild);
    });
  }, { root: grid, rootMargin: '300px' });
  grid.querySelectorAll('.tg').forEach(d => thumbObserver.observe(d));

  modal.hidden = false;
  const cur = grid.querySelector('.tg.cur');
  if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 60);
}

(function bindThumbs() {
  const modal = $('#thumbModal');
  if (!modal) return;
  const close = $('#thumbClose');
  if (close) close.onclick = () => { modal.hidden = true; };
  modal.addEventListener('click', e => {
    if (e.target === modal) { modal.hidden = true; return; }
    const tg = e.target.closest('.tg');
    if (tg) {
      modal.hidden = true;
      gotoPage(+tg.dataset.page);
    }
  });
})();

/* ------------------------------------------------ boot */
(function initTheme() {
  applyTheme(localStorage.getItem('jb_theme') || 'dark');
})();

(async function boot() {
  // 先把 URL 参数抓下来：loadBooks 会自动打开第一本书并改写地址栏，晚了就读不到了
  const qs = new URLSearchParams(location.search);
  const wantBook = qs.get('book');
  const wantPage = qs.get('p');

  await loadSettings();
  const t = S.settings.temperature;
  if (sTemp && typeof t === 'number') {
    sTemp.value = t;
    if (sTempVal) sTempVal.textContent = (+t).toFixed(1);
  }
  await loadBooks();
  if (S.books.length) {
    openPanel();
    // 竖屏平板：面板默认收成一条，把屏幕让给书；点标题栏再展开
    if (window.matchMedia('(max-width: 900px) and (orientation: portrait)').matches) {
      E.panel.classList.add('min');
    }
  }
  syncMode('read');
  autoGrow();
  updateProgress();
  applyFx(fxIdx);

  // 深链接：?books / ?drawer / ?light / ?panel=0
  if (wantBook) {
    const b = S.books.find(x => x.id === wantBook || x.title === wantBook);
    if (b && (!S.book || S.book.id !== b.id)) await openBook(b);
  }
  if (qs.has('light')) applyTheme('light');
  if (wantPage) {
    const n = parseInt(wantPage, 10);
    if (!isNaN(n)) { S.needRestore = false; gotoPage(n); }
  }
  if (qs.has('books')) { renderBookList(); E.booksModal.hidden = false; }
  if (qs.has('drawer')) { renderDrawer(); E.drawer.classList.add('open'); }
  if (qs.has('toc')) openToc();
  if (qs.has('stats')) openStats();
  if (qs.has('seltest')) {
    const showDbg = qs.get('seltest') !== '3';
    const dbg = document.createElement('div');
    dbg.style.cssText = 'position:fixed;left:10px;top:78px;z-index:99999;background:#000;color:#0f0;font:14px monospace;padding:12px;white-space:pre;border-radius:8px;line-height:1.6';
    if (showDbg) document.body.appendChild(dbg);
    let stage = 'wait', clicked = 'no', err = '';
    setTimeout(() => {
      try { commitSel({ x0: 0.20, y0: 0.24, x1: 0.72, y1: 0.48 }); stage = 'committed'; }
      catch (e) { err = 'commitSel: ' + e.message; }
    }, 1200);
    // seltest=4：模拟「点中已有的框」→ 应该聚焦并出现 ✕
    if (qs.get('seltest') === '4') setTimeout(() => {
      const r = E.wrap.getBoundingClientRect();
      const m = pd().marks[0];
      if (m) {
        const cx = r.left + (m.x + m.w / 2) * r.width;
        const cy = r.top + (m.y + m.h / 2) * r.height;
        const hit = markAt(cx, cy);
        stage = 'hit=' + (hit ? 'YES' : 'null');
        if (hit) focusMark(hit);
      }
    }, 2200);
    if (qs.get('seltest') === '2') setTimeout(() => {
      const b = $('#selX');
      stage = 'pre-click hidden=' + (b ? b.hidden : 'null');
      if (b && !b.hidden) { b.click(); clicked = 'yes'; }
    }, 2100);
    setInterval(() => {
      const b = $('#selX');
      dbg.textContent = 'stage=' + stage + '\nclicked=' + clicked + (err ? '\nERR ' + err : '') +
        '\nregion=' + !!S.region + '  active=' + (S.activeMark ? S.activeMark.id : 'null') +
        '  marks=' + ((pd().marks || []).length) +
        '\nselX.hidden=' + (b ? b.hidden : 'null');
    }, 350);
  }
  if (qs.has('thumbs')) openThumbs();
  if (qs.has('cmd')) { (async () => { await openCmd(); if (qs.get('q')) { const ci = $('#cmdInput'); ci.value = qs.get('q'); renderCmd(qs.get('q')); } })(); }
  if (qs.has('settings')) { E.setModal.hidden = false; refreshCacheInfo(); }
  if (qs.has('mdtest')) setTimeout(() => {
    openPanel();
    E.msgs.innerHTML = '';
    const demo = `**1. 定位**
这一页讲的是共射放大电路的**静态工作点**，属于「三极管放大区 + 直流通路」的直接应用。

**2. 推导**
- 输入回路：UCC = IBQ·Rb + UBEQ，所以 IBQ = (UCC - UBEQ) / Rb
- 电流关系：ICQ = beta·IBQ
- 输出回路：UCEQ = UCC - ICQ·Rc

公式：$I_{BQ} = (U_{CC} - U_{BEQ}) / R_b$

> 这两条都成立的前提是「管子确实工作在放大区」。

### 3. 小例子
设 UCC = 12 V，Rb = 300 kΩ，则 IBQ ≈ 37.7 μA。

👉 可以继续问：
1. 如果 UCEQ 算出来小于 0.3 V 说明什么？
2. 温度升高时 Q 点会怎么漂？`;
    const el = addBotMsg(demo, '第 30 页整页');
    el.dataset.raw = demo;
    scrollMsgs();
  }, 1600);
  const sq = qs.get('q');
  if (sq) {
    const ns = $('#noteSearch');
    if (ns) ns.value = sq;
    noteQuery = sq;
    E.panel.classList.add('hidden');
    E.drawer.classList.add('open');
    doGlobalSearch();
  }
  if (qs.has('help')) openHelp();
  if (qs.has('scroll')) enterScroll();
  if (qs.get('double') === '1' && !S.double) setDouble(true);
  if (qs.get('panel') === '0') E.panel.classList.add('hidden');
  if (qs.get('panel') === '1') E.panel.classList.remove('min', 'hidden');
  if (OFF) setTimeout(checkOfflineCache, 3500);
})();