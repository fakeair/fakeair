/* ===========================================================
   巡音流歌 · 角色画廊 · 交互
   纯原生 JS，无依赖。数据来自 data/works.js 的 window.WORKS
   =========================================================== */
(function () {
  'use strict';

  const WORKS = Array.isArray(window.WORKS) ? window.WORKS.slice() : [];
  const IS_SAMPLE = window.WORKS_IS_SAMPLE === true || WORKS.some((w) => /^assets\/samples\//.test(w.src || ''));
  const ALL = '__all__';

  const $ = (sel, root = document) => root.querySelector(sel);

  const grid = $('#grid');
  const chipsBox = $('#chips');
  const searchInput = $('#search');
  const countEl = $('#count');
  const emptyEl = $('#empty');
  const emptyText = $('#emptyText');
  const setupEl = $('#setup');
  const sampleNote = $('#sampleNote');
  const randomBtn = $('#randomBtn');
  const resetBtn = $('#resetBtn');

  const boardImg = $('#boardImg');
  const boardLink = $('#boardLink');
  const boardTitle = $('#boardTitle');
  const boardAuthor = $('#boardAuthor');
  const boardLoading = $('#boardLoading');
  const boardShuffle = $('#boardShuffle');

  const lb = $('#lightbox');
  const lbImg = $('#lbImg');
  const lbSpinner = $('#lbSpinner');
  const lbTitle = $('#lbTitle');
  const lbAuthor = $('#lbAuthor');
  const lbTags = $('#lbTags');
  const lbOrig = $('#lbOrig');
  const lbDown = $('#lbDown');
  const lbIndex = $('#lbIndex');
  const prevBtn = $('#prevBtn');
  const nextBtn = $('#nextBtn');

  /* ---------- 状态 ---------- */
  const state = {
    tag: ALL,
    query: '',
    view: [],
    current: -1,
    boardId: null,
    lastFocus: null,
  };

  /* ---------- 工具 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function cssEscape(value) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function extOf(url) {
    const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url);
    return m ? m[1].toLowerCase() : 'jpg';
  }

  /** 数据里是否用了 WebP 原图 */
  const usesWebp = () => WORKS.some((w) => /\.webp([?#]|$)/i.test(w.src || ''));

  /**
   * 老浏览器（Safari 14 以前 / IE）不支持 WebP，原图会打不开。
   * 缩略图是 JPEG 所以列表正常，这里只在点开大图时给出提示，不做格式转换。
   */
  function checkWebpSupport() {
    const probe = new Image();
    probe.onerror = () => {
      lbSpinner.hidden = true;
      lbIndex.textContent = '这张原图是 WebP 格式，当前浏览器不支持。换 Chrome / Edge / 新版 Safari 即可查看，或点「下载原图」再看。';
    };
    probe.src = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
  }

  /**
   * 图片入场动画。
   * 一个刻意的取舍：这里只动 transform，绝不动 opacity。
   * 因为只要用透明度做「未加载 → 加载完」的切换，一旦动画时钟被暂停
   * （无头渲染、截图、部分省电/后台标签页），图就会永远停在透明的第一帧 —— 白屏。
   * 用位移/缩放则最坏情况只是位置偏一点，图一定看得见。
   */
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  function reveal(el) {
    el.classList.add('loaded');
    if (!canAnimate || !el.dataset.reveal) return;
    const delay = (Number(el.style.getPropertyValue('--i')) || 0) * 30;
    try {
      el.animate(
        [{ transform: 'translateY(14px) scale(0.97)' }, { transform: 'none' }],
        { duration: 480, delay, fill: 'backwards', easing: 'cubic-bezier(0.22,0.61,0.36,1)' },
      );
    } catch { /* 动画失败无所谓，图本来是可见的 */ }
  }

  /** 卡片上显示的短标签：优先展示分类（立绘 / 头像 / 横图…） */
  function kindOf(work) {
    const tags = work.tags || [];
    const kinds = ['立绘', '半身', '头像', '横图'];
    return tags.find((t) => kinds.includes(t)) || tags[0] || '';
  }

  /* ---------- 看板（主视觉） ---------- */
  function pickBoard(list) {
    if (!list.length) return null;
    // 横向的图更适合当主视觉，其次选第一张
    const wide = list.find((w) => (w.w || 0) > (w.h || 0));
    return wide || list[0];
  }

  function fillBoard(list, id) {
    const work = (id && list.find((w) => String(w.id) === String(id))) || pickBoard(list);
    if (!work) return;
    state.boardId = work.id;

    boardImg.classList.remove('loaded');
    boardLoading.hidden = false;
    boardImg.alt = `${work.title || '巡音流歌'} — 巡音流歌图片`;
    const token = String(work.id);
    boardImg.dataset.token = token;
    const done = () => {
      if (boardImg.dataset.token !== token) return;
      boardLoading.hidden = true;
      reveal(boardImg);
    };
    boardImg.onload = done;
    boardImg.onerror = done;
    boardImg.src = work.hero || work.thumb || work.src || '';
    if (boardImg.complete && boardImg.naturalWidth) done();

    boardLink.dataset.id = work.id;
    boardLink.setAttribute('aria-label', `查看大图：${work.title || '未命名'}`);
    boardTitle.textContent = work.title || '未命名';
    boardAuthor.textContent = work.author || '作者未署名';
  }

  function updateStats() {
    const total = WORKS.length;
    const full = WORKS.filter((w) => (w.tags || []).includes('立绘')).length;
    const authors = new Set(WORKS.map((w) => (w.author || '').trim()).filter(Boolean)).size;
    $('#statTotal').textContent = total || '0';
    $('#statFull').textContent = full || '0';
    const el = $('#statAuthors');
    el.textContent = authors ? String(authors) : '—';
  }

  /* ---------- 标签栏 ---------- */
  function buildChips() {
    const kinds = ['立绘', '半身', '头像', '横图'];
    const freq = new Map();
    for (const work of WORKS) {
      for (const tag of work.tags || []) freq.set(tag, (freq.get(tag) || 0) + 1);
    }
    // 分类在前，其余标签按出现次数
    const rest = [...freq.keys()]
      .filter((t) => !kinds.includes(t))
      .sort((a, b) => (freq.get(b) - freq.get(a)) || a.localeCompare(b, 'zh'));
    const ordered = [...kinds.filter((k) => freq.has(k)), ...rest];

    const make = (value, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.tag = value;
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(state.tag === value));
      return btn;
    };

    chipsBox.textContent = '';
    chipsBox.append(make(ALL, '全部'));
    for (const tag of ordered) chipsBox.append(make(tag, tag));
  }

  function setTag(tag) {
    state.tag = tag;
    for (const btn of chipsBox.children) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tag === tag));
    }
  }

  /* ---------- 过滤 ---------- */
  function matches(work) {
    if (state.tag !== ALL && !(work.tags || []).includes(state.tag)) return false;
    if (!state.query) return true;
    const hay = [work.title, work.author, ...(work.tags || [])].join(' ').toLowerCase();
    return hay.includes(state.query);
  }

  /* ---------- 渲染网格 ---------- */
  function card(work, i) {
    const el = document.createElement('article');
    el.className = 'card';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `查看大图：${work.title || '巡音流歌图片'}`);
    el.dataset.id = work.id;
    el.style.setProperty('--i', Math.min(i, 16));

    const kind = kindOf(work);
    el.innerHTML = `
      <div class="card-media">
        <img src="${esc(work.thumb || work.src)}" data-reveal="up" alt="${esc(work.title || '巡音流歌')}"
             loading="lazy" decoding="async" draggable="false">
        ${kind ? `<span class="card-kind">${esc(kind)}</span>` : ''}
      </div>
      <div class="card-overlay">
        <h3 class="card-title">${esc(work.title || '未命名')}</h3>
        <p class="card-author">${esc(work.author || '作者未署名')}</p>
      </div>`;

    const img = $('img', el);
    if (img.complete && img.naturalWidth) reveal(img);
    else img.addEventListener('load', () => reveal(img), { once: true });
    img.addEventListener('error', () => img.classList.add('loaded'), { once: true });
    el.addEventListener('click', () => openByCard(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openByCard(el); }
    });

    return el;
  }

  function render() {
    state.view = WORKS.filter(matches);

    grid.textContent = '';
    const frag = document.createDocumentFragment();
    state.view.forEach((work, i) => frag.append(card(work, i)));
    grid.append(frag);

    const filtered = state.view.length !== WORKS.length;
    emptyEl.hidden = !(filtered && state.view.length === 0);
    if (!emptyEl.hidden) emptyText.textContent = `没有符合条件的图片（当前 ${WORKS.length} 张收藏）。`;

    const total = WORKS.length;
    countEl.textContent = filtered ? `${state.view.length} / ${total} 张` : `共 ${total} 张`;

    if (!lb.hidden) close();
  }

  /* ---------- 全屏查看 ---------- */
  function openByCard(el) {
    const index = state.view.findIndex((w) => String(w.id) === el.dataset.id);
    if (index < 0) return;
    state.lastFocus = el;
    lb.hidden = false;
    document.body.classList.add('locked');
    show(index);
    requestAnimationFrame(() => $('.lb-close', lb).focus());
  }

  function show(index) {
    if (!state.view.length) return;
    const n = state.view.length;
    state.current = ((index % n) + n) % n;
    const work = state.view[state.current];

    lbImg.classList.remove('loaded');
    lbSpinner.hidden = false;
    lbImg.alt = work.title || '巡音流歌图片';
    const token = String(work.id) + ':' + state.current;
    lbImg.dataset.token = token;

    const done = () => {
      if (lbImg.dataset.token !== token) return;
      lbSpinner.hidden = true;
      reveal(lbImg);
    };
    lbImg.onload = done;
    lbImg.onerror = done;
    lbImg.src = work.src || work.thumb || '';
    if (lbImg.complete && lbImg.naturalWidth) done();

    if (history.replaceState) history.replaceState(null, '', '#!' + work.id);

    lbTitle.textContent = work.title || '未命名';
    lbAuthor.textContent = work.author || '作者未署名';

    lbTags.textContent = '';
    for (const tag of work.tags || []) {
      const li = document.createElement('li');
      li.textContent = tag;
      lbTags.append(li);
    }

    if (work.link) {
      lbOrig.href = work.link;
      lbOrig.hidden = false;
    } else {
      lbOrig.hidden = true;
      lbOrig.removeAttribute('href');
    }

    lbDown.href = work.src || work.thumb || '';
    lbDown.setAttribute('download', `${work.id || 'luka'}.${extOf(work.src || work.thumb || '')}`);

    lbIndex.textContent = `${state.current + 1} / ${n}`;

    const activeCard = grid.querySelector(`.card[data-id="${cssEscape(work.id)}"]`);
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function close() {
    if (lb.hidden) return;
    lb.hidden = true;
    lbImg.removeAttribute('src');
    document.body.classList.remove('locked');
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
  }

  function step(delta) {
    if (state.current < 0) return;
    show(state.current + delta);
  }

  /* ---------- 事件 ---------- */
  chipsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    setTag(btn.dataset.tag);
    render();
  });

  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = searchInput.value.trim().toLowerCase();
      render();
    }, 130);
  });

  resetBtn.addEventListener('click', () => {
    state.query = '';
    searchInput.value = '';
    setTag(ALL);
    render();
  });

  randomBtn.addEventListener('click', () => {
    if (!state.view.length) return;
    const i = Math.floor(Math.random() * state.view.length);
    if (lb.hidden) {
      const el = grid.querySelector(`.card[data-id="${cssEscape(state.view[i].id)}"]`);
      if (el) openByCard(el);
    } else {
      show(i);
    }
  });

  boardShuffle.addEventListener('click', () => {
    const pool = state.view.length ? state.view : WORKS;
    if (pool.length < 2) return;
    let next = state.boardId;
    while (next === state.boardId) next = pool[Math.floor(Math.random() * pool.length)].id;
    fillBoard(pool, next);
  });

  boardLink.addEventListener('click', (e) => {
    e.preventDefault();
    const el = grid.querySelector(`.card[data-id="${cssEscape(state.boardId)}"]`);
    if (el) openByCard(el);
  });

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));

  lb.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');

    if (e.key === 'Escape' && !lb.hidden) { close(); return; }
    if (!lb.hidden) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Tab') trapFocus(e);
      return;
    }
    if (typing) return;
    if (e.key === 'r' || e.key === 'R') randomBtn.click();
  });

  function trapFocus(e) {
    const focusables = [...lb.querySelectorAll('button, a[href]')].filter((el) => !el.hidden);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* 触屏左右滑动翻页 */
  let touchX = 0;
  let touchY = 0;
  lb.addEventListener('touchstart', (e) => {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------- 启动 ---------- */
  $('#year').textContent = new Date().getFullYear();

  if (!WORKS.length) {
    countEl.textContent = '';
    grid.hidden = true;
    emptyEl.hidden = true;
    setupEl.hidden = false;
    boardImg.closest('a').style.visibility = 'hidden';
    return;
  }

  if (IS_SAMPLE) sampleNote.hidden = false;

  buildChips();
  render();
  updateStats();
  fillBoard(WORKS);
  if (usesWebp()) checkWebpSupport();

  /* 打开形如 #!work-id 的链接（分享 / 刷新后回到同一张） */
  function openFromHash() {
    const m = /^#!(.+)$/.exec(location.hash || '');
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const el = grid.querySelector(`.card[data-id="${cssEscape(id)}"]`);
    if (el) openByCard(el);
    else fillBoard(WORKS, id);
  }
  window.addEventListener('hashchange', () => {
    if (lb.hidden) openFromHash();
  });
  openFromHash();
})();
