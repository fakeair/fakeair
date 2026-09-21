/* ===========================================================
   巡音流歌 · 角色画廊 · 访客上传
   -----------------------------------------------------------
   访客能在这里上传自己的图，提交后立即展示并署名。

   需要 Supabase Storage + luka_uploads 表（见 docs/supabase-uploads.sql）。
   只在配置了共享后端时启用。

   上传流程：
     1. 读文件 → 校验类型与体积
     2. 用 canvas 生成缩略图（列表用）和主视觉图（首屏用）
     3. 三者都传到 Storage 桶 luka-uploads
     4. 往 luka_uploads 表插一条记录
     5. 画廊重新拉取，新图出现在最前面
   =========================================================== */
(function () {
  'use strict';

  const BUCKET = 'luka-uploads';
  const MAX_ORIGINAL = 20 * 1024 * 1024; // 与桶限制保持一致
  const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
  const THUMB_W = 520;
  const HERO_W = 1000;
  const KIND_TAGS = ['立绘', '半身', '头像', '横图'];

  let store = null;   // 由 main.js 注入的 SharedStore
  let onDone = null;  // 上传成功后的回调

  const $ = (sel) => document.querySelector(sel);

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function shortId() {
    const bytes = new Uint8Array(6);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** 按宽高比猜分类，和站内固定作品的规则一致 */
  function autoKind(w, h) {
    const r = w / h;
    if (r <= 0.78) return '立绘';
    if (r <= 0.95) return '半身';
    if (r <= 1.25) return '头像';
    return '横图';
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图片读不出来，换一张试试')); };
      img.src = url;
    });
  }

  /** 把图缩到指定宽度，返回 Blob（JPEG）。原图本身更小就直接用原图 */
  function resize(img, maxW, quality, mime) {
    if (img.naturalWidth <= maxW && mime === 'image/jpeg') {
      return new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob((b) => resolve(b), 'image/jpeg', quality);
      });
    }
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', quality));
  }

  /* ---------- 上传到 Storage ---------- */
  async function putObject(path, blob, contentType) {
    const url = `${store.url}/storage/v1/object/${BUCKET}/${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: store.key,
        Authorization: 'Bearer ' + store.key,
        'Content-Type': contentType,
        'Cache-Control': 'max-age=31536000',
        'x-upsert': 'false',
      },
      body: blob,
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch { /* 忽略 */ }
      const err = new Error(msg || `上传失败（${res.status}）`);
      err.status = res.status;
      throw err;
    }
    // 公开地址：public 桶直接拼即可
    return `${store.url}/storage/v1/object/public/${BUCKET}/${path}`;
  }

  /* ---------- 界面状态 ---------- */
  function setStatus(text, kind) {
    const el = $('#upStatus');
    el.textContent = text || '';
    el.className = 'up-status' + (kind ? ' up-' + kind : '');
    el.hidden = !text;
  }

  function setProgress(pct) {
    const bar = $('#upBar');
    bar.hidden = pct === null;
    if (pct !== null) $('#upBarFill').style.width = Math.round(pct * 100) + '%';
  }

  let previewUrl = null;
  async function onFileChosen() {
    const file = $('#upFile').files[0];
    const info = $('#upFileInfo');
    const preview = $('#upPreview');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }

    if (!file) {
      info.textContent = '';
      preview.hidden = true;
      return;
    }
    if (!OK_TYPES.includes(file.type)) {
      info.textContent = `不支持这种格式（${file.type || '未知'}）。请用 PNG / JPEG / WebP / GIF。`;
      info.className = 'up-fileinfo up-error';
      preview.hidden = true;
      $('#upFile').value = '';
      return;
    }
    if (file.size > MAX_ORIGINAL) {
      info.textContent = `图片太大了（${(file.size / 1048576).toFixed(1)}MB），上限 20MB。`;
      info.className = 'up-fileinfo up-error';
      preview.hidden = true;
      $('#upFile').value = '';
      return;
    }

    try {
      const img = await loadImage(file);
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
      info.className = 'up-fileinfo';
      info.textContent = `${img.naturalWidth}×${img.naturalHeight} · ${(file.size / 1048576).toFixed(1)}MB · 将自动归为「${autoKind(img.naturalWidth, img.naturalHeight)}」`;

      // 作品名留空时，用文件名当默认值
      const title = $('#upTitle');
      if (!title.value.trim()) {
        title.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 60);
      }
    } catch (err) {
      info.textContent = err.message;
      info.className = 'up-fileinfo up-error';
      preview.hidden = true;
    }
  }

  /* ---------- 提交 ---------- */
  async function submit(event) {
    event.preventDefault();
    if (!store || store.mode !== 'shared') {
      setStatus('上传需要先配置共享后端（见 docs/supabase-uploads.md）', 'error');
      return;
    }

    const file = $('#upFile').files[0];
    const title = $('#upTitle').value.trim();
    const author = $('#upAuthor').value.trim();
    const kind = $('#upKind').value;
    const submitBtn = $('#upSubmit');

    if (!file) { setStatus('先选一张图片', 'error'); return; }
    if (!title) { setStatus('给作品起个名字吧', 'error'); return; }
    if (!author) { setStatus('填一下署名（想匿名就写「匿名」）', 'error'); return; }

    submitBtn.disabled = true;
    $('#upFile').disabled = true;
    try {
      setStatus('正在处理图片…', 'busy');
      setProgress(0.05);

      const img = await loadImage(file);
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      const [thumbBlob, heroBlob] = await Promise.all([
        resize(img, THUMB_W, 0.82, 'image/jpeg'),
        resize(img, HERO_W, 0.86, 'image/jpeg'),
      ]);
      setProgress(0.25);

      const id = 'up-' + shortId();
      const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
      const base = `${id}`;

      setStatus('正在上传原图…', 'busy');
      const srcUrl = await putObject(`${base}/original.${ext}`, file, file.type);
      setProgress(0.55);

      setStatus('正在上传预览图…', 'busy');
      const [thumbUrl, heroUrl] = await Promise.all([
        putObject(`${base}/thumb.jpg`, thumbBlob, 'image/jpeg'),
        putObject(`${base}/hero.jpg`, heroBlob, 'image/jpeg'),
      ]);
      setProgress(0.8);

      setStatus('正在登记…', 'busy');
      await store.addUpload({
        work_id: id,
        title,
        author,
        tags: [kind],
        src: srcUrl,
        thumb: thumbUrl,
        hero: heroUrl,
        w, h,
      });
      setProgress(1);

      setStatus('上传成功，已展示在画廊里 🎉', 'ok');
      try { localStorage.setItem('luka-gallery:nickname', author); } catch { /* 忽略 */ }

      // 重置表单（保留昵称，方便连续上传）
      $('#upFile').value = '';
      $('#upTitle').value = '';
      $('#upFileInfo').textContent = '';
      $('#upPreview').hidden = true;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }

      if (onDone) await onDone(id);
      setTimeout(() => setProgress(null), 1200);
    } catch (err) {
      console.error('[upload]', err);
      setStatus(err.message || '上传失败，稍后再试', 'error');
      setProgress(null);
    } finally {
      submitBtn.disabled = false;
      $('#upFile').disabled = false;
    }
  }

  /* ---------- 对外接口 ---------- */
  function open(myStore, doneCallback) {
    store = myStore;
    onDone = doneCallback;
    $('#uploadModal').hidden = false;
    document.body.classList.add('locked');
    setStatus('');
    setProgress(null);
    try {
      const saved = localStorage.getItem('luka-gallery:nickname');
      if (saved && !$('#upAuthor').value) $('#upAuthor').value = saved;
    } catch { /* 忽略 */ }
    $('#upFile').focus();
  }

  function close() {
    $('#uploadModal').hidden = true;
    document.body.classList.remove('locked');
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  function init() {
    const modal = $('#uploadModal');
    if (!modal) return;
    $('#upFile').addEventListener('change', onFileChosen);
    $('#upForm').addEventListener('submit', submit);
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-up-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }

  window.GalleryUpload = { init, open, close };
})();
