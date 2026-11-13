/* =========================================================
   云同步 · 用 GitHub Gist 当免费的跨设备中转
   - 平板、电脑（网页版）看到同一份笔记
   - 按「页」合并，两边都改过也不会互相覆盖
   - 只在设置里填一次 GitHub token（只存本机）
   ========================================================= */
const SYNC = {
  TOKEN_KEY: 'jb_sync_token',
  GIST_KEY: 'jb_sync_gist',
  FILE: 'bandu-notes.json',
  enabled() {
    return !!(localStorage.getItem(this.TOKEN_KEY) && localStorage.getItem(this.GIST_KEY));
  },
  token() { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  gistId() { return localStorage.getItem(this.GIST_KEY) || ''; },
};

function noteStamp(pageObj) {
  if (!pageObj) return 0;
  let t = pageObj._t || 0;
  // 兜底：用过但没有 _t 的，用内容长度 + 是否问过，粗略判断
  if (!t) {
    const marks = (pageObj.marks || []).length;
    const chats = (pageObj.chats || []).length;
    t = 1 + marks + chats;
  }
  return t;
}

/* 合并两页笔记：谁新用谁；一样新就合起来（笔画/框/对话分别去重） */
function mergePage(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const lt = noteStamp(local), rt = noteStamp(remote);
  if (lt > rt) return local;
  if (rt > lt) return remote;
  const out = {
    strokes: (local.strokes || []).length >= (remote.strokes || []).length ? local.strokes : remote.strokes,
    marks: (local.marks || []).length >= (remote.marks || []).length ? local.marks : remote.marks,
    chats: (local.chats || []).length >= (remote.chats || []).length ? local.chats : remote.chats,
    _t: local._t || remote._t || 0,
  };
  return out;
}

function mergeNotes(localNotes, remoteNotes) {
  const out = { pages: {} };
  const keys = new Set([
    ...Object.keys((localNotes && localNotes.pages) || {}),
    ...Object.keys((remoteNotes && remoteNotes.pages) || {}),
  ]);
  keys.forEach(k => {
    const m = mergePage((localNotes.pages || {})[k], (remoteNotes.pages || {})[k]);
    if (m) out.pages[k] = m;
  });
  return out;
}

function allLocalNotes() {
  const out = {};
  (S.books || []).forEach(b => {
    try {
      const raw = localStorage.getItem('jb_off_notes_' + b.id);
      if (raw) out[b.id] = JSON.parse(raw);
    } catch (e) { }
  });
  // 电脑端（在线模式）用内存里的当前书
  if (!OFF && S.book && S.notes) out[S.book.id] = S.notes;
  return out;
}

async function syncPull() {
  if (!SYNC.enabled()) return null;
  const r = await fetch('https://api.github.com/gists/' + SYNC.gistId(), {
    headers: { Authorization: 'Bearer ' + SYNC.token(), Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('拉取失败（' + r.status + '）');
  const j = await r.json();
  const f = j.files && j.files[SYNC.FILE];
  if (!f) return {};
  return JSON.parse(f.content || '{}');
}

async function syncPush(payload) {
  if (!SYNC.enabled()) return;
  const body = {
    description: '教材伴读 · 笔记同步',
    files: {
      [SYNC.FILE]: { content: JSON.stringify(payload) },
    },
  };
  const r = await fetch('https://api.github.com/gists/' + SYNC.gistId(), {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + SYNC.token(),
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('上传失败（' + r.status + '）');
}

/* 首次开通：建一个 secret gist 并把 id 存下来 */
async function syncCreateGist() {
  const r = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + SYNC.token(),
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: '教材伴读 · 笔记同步（私密）',
      public: false,
      files: { [SYNC.FILE]: { content: '{}' } },
    }),
  });
  if (!r.ok) throw new Error('创建失败（' + r.status + '）—— 检查 token 是否有 gist 权限');
  const j = await r.json();
  localStorage.setItem(SYNC.GIST_KEY, j.id);
  return j.id;
}

/* 完整的「同步一次」：拉 → 合并 → 写本地 → 推 */
async function syncNow(silent) {
  if (!SYNC.enabled()) {
    if (!silent) toast('还没配好云同步（设置 → 云同步）');
    return false;
  }
  try {
    const remote = await syncPull() || {};
    const local = allLocalNotes();
    let changed = 0;
    const bookIds = new Set([...Object.keys(local), ...Object.keys(remote)]);
    bookIds.forEach(bid => {
      const merged = mergeNotes(local[bid], remote[bid]);
      local[bid] = merged;
      if (OFF) {
        try { localStorage.setItem('jb_off_notes_' + bid, JSON.stringify(merged)); } catch (e) { }
      }
      changed += Object.keys(merged.pages || {}).length;
    });
    if (!OFF && S.book && local[S.book.id]) {
      S.notes = local[S.book.id];
      if (typeof renderMarks === 'function') { try { renderMarks(); renderChats(); } catch (e) { } }
    }
    await syncPush(local);
    if (!silent) toast('已同步 · ' + changed + ' 页笔记');
    return true;
  } catch (e) {
    if (!silent) toast('同步失败：' + e.message);
    return false;
  }
}

/* 笔记变化后自动推（防抖 10 秒，避免频繁请求） */
let syncTimer = null;
function scheduleSync() {
  if (!SYNC.enabled()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow(true); }, 10000);
}
