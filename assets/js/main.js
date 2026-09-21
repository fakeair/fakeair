/* ===========================================================
   巡音流歌 · 角色画廊 · 交互
   纯原生 JS，无依赖。
   数据来源：data/works.js（作品）+ assets/js/store.js（点赞/收藏/评分/短评）
   =========================================================== */
(function () {
  'use strict';

  const WORKS = Array.isArray(window.WORKS) ? window.WORKS.slice() : [];
  const IS_SAMPLE = window.WORKS_IS_SAMPLE === true || WORKS.some((w) => /^assets\/samples\//.test(w.src || ''));
  const ALL = '__all__';
  const FAV = '__favorites__';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const grid = $('#grid');
  const chipsBox = $('#chips');
  const searchInput = $('#search');
  const sortSelect = $('#sort');
  const countEl = $('#count');
  const emptyEl = $('#empty');
  const emptyText = $('#emptyText');
  const setupEl = $('#setup');
  const sampleNote = $('#sampleNote');
  const modeNote = $('#modeNote');
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

  const btnLike = $('#btnLike');
  const btnFav = $('#btnFav');
  const likeCount = $('#likeCount');
  const favCount = $('#favCount');
  const starsBox = $('#stars');
  const rateSummary = $('#rateSummary');
  const reviewForm = $('#reviewForm');
  const reviewName = $('#reviewName');
  const reviewText = $('#reviewText');
  const reviewLen = $('#reviewLen');
  const reviewList = $('#reviewList');
  const reviewCount = $('#reviewCount');
  const reviewEmpty = $('#reviewEmpty');

  /* ---------- 状态 ---------- */
  const state = {
    tag: ALL,
    query: '',
    sort: 'new',
    view: [],
    current: -1,
    boardId: null,
    lastFocus: null,
  };

  let store = null;   // 互动数据存储（本机 或 共享）
  let stats = {};     // { workId: { likes, liked, favorites, ratingAvg, ... } }
  let degraded = false;

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

  const usesWebp = () => WORKS.some((w) => /\.webp([?#]|$)/i.test(w.src || ''));

  function checkWebpSupport() {
    const probe = new Image();
    probe.onerror = () => {
      lbSpinner.hidden = true;
      lbIndex.textContent = '这张原图是 WebP 格式，当前浏览器不支持。换 Chrome / Edge / 新版 Safari 即可查看，或点「下载原图」再看。';
    };
    probe.src = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
  }

  /**
   * 图片入场动画：只动 transform，绝不动 opacity。
   * 若用透明度做「加载完成」切换，一旦动画时钟被暂停（无头渲染、后台标签页、
   * 部分省电模式），图会永远停在透明的第一帧 —— 表现就是白板。
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

  const statOf = (id) => stats[id] || {
    likes: 0, favorites: 0, ratingCount: 0, ratingAvg: 0, reviewCount: 0,
    liked: false, favorited: false, myRating: 0,
  };

  const formatAvg = (avg) => (avg > 0 ? avg.toFixed(1) : '—');

  function relTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 2592000000) return Math.floor(diff / 86400000) + ' 天前';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function kindOf(work) {
    const tags = work.tags || [];
    const kinds = ['立绘', '半身', '头像', '横图'];
    return tags.find((t) => kinds.includes(t)) || tags[0] || '';
  }

  /* ---------- 看板（主视觉） ---------- */
  function pickBoard(list) {
    if (!list.length) return null;
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
    const s = statOf(work.id);
    boardAuthor.textContent = [
      work.author || '作者未署名',
      `♥ ${s.likes}`,
      s.ratingCount ? `★ ${formatAvg(s.ratingAvg)}` : '',
    ].filter(Boolean).join(' · ');
  }

  function updateStats() {
    const total = WORKS.length;
    const full = WORKS.filter((w) => (w.tags || []).includes('立绘')).length;
    const authors = new Set(WORKS.map((w) => (w.author || '').trim()).filter(Boolean)).size;
    const totalLikes = Object.values(stats).reduce((a, s) => a + (s.likes || 0), 0);
    const totalFavs = Object.values(stats).reduce((a, s) => a + (s.favorites || 0), 0);
    $('#statTotal').textContent = total || '0';
    $('#statFull').textContent = full || '0';
    $('#statAuthors').textContent = authors ? String(authors) : '—';
    const likesEl = $('#statLikes');
    if (likesEl) likesEl.textContent = String(totalLikes);
    const favEl = $('#statFavs');
    if (favEl) favEl.textContent = String(totalFavs);
  }

  /* ---------- 标签栏 ---------- */
  function buildChips() {
    const kinds = ['立绘', '半身', '头像', '横图'];
    const freq = new Map();
    for (const work of WORKS) {
      for (const tag of work.tags || []) freq.set(tag, (freq.get(tag) || 0) + 1);
    }
    const rest = [...freq.keys()]
      .filter((t) => !kinds.includes(t))
      .sort((a, b) => (freq.get(b) - freq.get(a)) || a.localeCompare(b, 'zh'));
    const ordered = [...kinds.filter((k) => freq.has(k)), ...rest];

    const make = (value, label, cls) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (cls ? ' ' + cls : '');
      btn.dataset.tag = value;
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(state.tag === value));
      return btn;
    };

    chipsBox.textContent = '';
    chipsBox.append(make(ALL, '全部'));
    for (const tag of ordered) chipsBox.append(make(tag, tag));
    chipsBox.append(make(FAV, '♥ 我的收藏', 'chip-fav'));
  }

  function setTag(tag) {
    state.tag = tag;
    for (const btn of chipsBox.children) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tag === tag));
    }
  }

  /* ---------- 过滤与排序 ---------- */
  function matches(work) {
    if (state.tag === FAV) {
      if (!statOf(work.id).favorited) return false;
    } else if (state.tag !== ALL && !(work.tags || []).includes(state.tag)) {
      return false;
    }
    if (!state.query) return true;
    const hay = [work.title, work.author, ...(work.tags || [])].join(' ').toLowerCase();
    return hay.includes(state.query);
  }

  function sortWorks(list) {
    const out = list.slice();
    const s = (id) => statOf(id);
    if (state.sort === 'likes') {
      out.sort((a, b) => s(b.id).likes - s(a.id).likes);
    } else if (state.sort === 'rating') {
      // 评分人数太少的往后放，避免「1 个人打 5 星」霸榜
      const weight = (x) => (x.ratingCount >= 3 ? x.ratingAvg : x.ratingAvg * 0.6);
      out.sort((a, b) => weight(s(b.id)) - weight(s(a.id)));
    } else if (state.sort === 'reviews') {
      out.sort((a, b) => s(b.id).reviewCount - s(a.id).reviewCount);
    }
    return out;
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
    const s = statOf(work.id);
    // 降级状态下，新建出来的按钮也要是禁用的
    const off = degraded ? ' disabled' : '';

    el.innerHTML = `
      <div class="card-media">
        <img src="${esc(work.thumb || work.src)}" data-reveal="up" alt="${esc(work.title || '巡音流歌')}"
             loading="lazy" decoding="async" draggable="false">
        ${kind ? `<span class="card-kind">${esc(kind)}</span>` : ''}
        <span class="card-favflag" ${s.favorited ? '' : 'hidden'} title="已收藏" aria-hidden="true">★</span>
      </div>
      <div class="card-bar${degraded ? ' is-off' : ''}">
        <button type="button" class="mini mini-like" data-act="like" aria-pressed="${s.liked}"${off}
                aria-label="点赞：${esc(work.title || '')}" title="点赞">
          <span aria-hidden="true">♥</span><b>${s.likes}</b>
        </button>
        <button type="button" class="mini mini-fav" data-act="fav" aria-pressed="${s.favorited}"${off}
                aria-label="收藏：${esc(work.title || '')}" title="收藏">
          <span aria-hidden="true">★</span><b>${s.favorites}</b>
        </button>
        <span class="mini mini-rate" title="平均评分">
          <span aria-hidden="true">☆</span><b>${formatAvg(s.ratingAvg)}</b>
          <i>${s.ratingCount ? `(${s.ratingCount})` : ''}</i>
        </span>
      </div>
      <div class="card-overlay">
        <h3 class="card-title">${esc(work.title || '未命名')}</h3>
        <p class="card-author">${esc(work.author || '作者未署名')}</p>
      </div>`;

    const img = $('img', el);
    if (img.complete && img.naturalWidth) reveal(img);
    else img.addEventListener('load', () => reveal(img), { once: true });
    img.addEventListener('error', () => img.classList.add('loaded'), { once: true });

    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        onQuickAction(act.dataset.act, work.id, act);
        return;
      }
      openByCard(el);
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('[data-act]')) {
        e.preventDefault();
        openByCard(el);
      }
    });

    return el;
  }

  function render() {
    state.view = sortWorks(WORKS.filter(matches));

    grid.textContent = '';
    const frag = document.createDocumentFragment();
    state.view.forEach((work, i) => frag.append(card(work, i)));
    grid.append(frag);

    const filtered = state.view.length !== WORKS.length;
    emptyEl.hidden = !(filtered && state.view.length === 0);
    if (!emptyEl.hidden) {
      emptyText.textContent = state.tag === FAV
        ? '你还没有收藏任何图片 —— 在图片下方点 ☆ 就能收藏。'
        : `没有符合条件的图片（当前 ${WORKS.length} 张收藏）。`;
    }

    const total = WORKS.length;
    countEl.textContent = filtered ? `${state.view.length} / ${total} 张` : `共 ${total} 张`;

    if (!lb.hidden) close();
  }

  /* ---------- 互动数据 ---------- */
  async function refreshStats() {
    const ids = WORKS.map((w) => w.id);
    const fresh = await store.getStats(ids);
    stats = {};
    for (const id of ids) {
      const s = fresh[id] || {};
      stats[id] = {
        likes: Number(s.likes) || 0,
        favorites: Number(s.favorites) || 0,
        ratingCount: Number(s.ratingCount) || 0,
        ratingAvg: Number(s.ratingAvg) || 0,
        reviewCount: Number(s.reviewCount) || 0,
        liked: !!s.liked,
        favorited: !!s.favorited,
        myRating: Number(s.myRating) || 0,
      };
    }
  }

  async function onQuickAction(act, id, btnEl) {
    if (!store || degraded) return;
    btnEl.disabled = true;
    try {
      if (act === 'like') await store.toggleLike(id);
      else if (act === 'fav') await store.toggleFavorite(id);
      await refreshStats();
      syncCard(id);
      updateStats();
      if (state.tag === FAV) render();
      if (state.boardId === id) fillBoard(WORKS, id);
    } catch (err) {
      handleStoreError(err);
    } finally {
      btnEl.disabled = false;
    }
  }

  /** 只更新某张卡片的数字与状态，不整体重绘（避免图片重新加载、动画重放） */
  function syncCard(id) {
    const el = grid.querySelector(`.card[data-id="${cssEscape(id)}"]`);
    if (!el) return;
    const s = statOf(id);
    const like = el.querySelector('.mini-like');
    const fav = el.querySelector('.mini-fav');
    const rate = el.querySelector('.mini-rate');
    const flag = el.querySelector('.card-favflag');
    if (like) { like.setAttribute('aria-pressed', String(s.liked)); $('b', like).textContent = s.likes; }
    if (fav) { fav.setAttribute('aria-pressed', String(s.favorited)); $('b', fav).textContent = s.favorites; }
    if (rate) {
      $('b', rate).textContent = formatAvg(s.ratingAvg);
      $('i', rate).textContent = s.ratingCount ? `(${s.ratingCount})` : '';
    }
    if (flag) flag.hidden = !s.favorited;
  }

  /**
   * 互动后端挂掉时（项目被暂停、密钥失效、被墙）不应该让整个画廊跟着坏：
   * 图片照常看，互动按钮禁用并说明原因。只在第一次失败时改界面，避免反复打扰。
   */
  function degrade(reason) {
    if (degraded) return;
    degraded = true;
    if (modeNote) {
      modeNote.hidden = false;
      modeNote.classList.add('mode-note-warn');
      modeNote.textContent = `互动功能暂时不可用（${reason}）。图片浏览不受影响，稍后刷新页面即可重试。`;
    }
    for (const el of $$('.card-bar, .interact')) el.classList.add('is-off');
    for (const el of $$('.mini-like, .mini-fav, #btnLike, #btnFav, .star, #reviewSubmit')) el.disabled = true;
  }

  /** 统一处理 store 异常：属于「后端不可用」就降级，否则只弹一次提示 */
  function handleStoreError(err) {
    const msg = (err && err.message) ? err.message : '网络或配置问题';
    // 只把「配置 / 权限 / 端点」类错误当成不可用；
    // 暂时性网络抖动、频率限制（429）只提示，不影响继续操作。
    const fatal = err && (err.status === 401 || err.status === 403 || err.status === 404);
    if (fatal && store && store.mode === 'shared') degrade(msg);
    else flashError(err);
  }

  function flashError(err) {
    console.warn('[gallery]', err);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = '操作失败：' + ((err && err.message) ? err.message : '网络或配置问题');
    document.body.append(el);
    setTimeout(() => el.remove(), 3600);
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

    renderInteract(work.id);
    reviewText.value = '';
    reviewLen.textContent = '0 / 200';
    loadReviews(work.id);

    const activeCard = grid.querySelector(`.card[data-id="${cssEscape(work.id)}"]`);
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function renderInteract(id) {
    const s = statOf(id);
    btnLike.setAttribute('aria-pressed', String(s.liked));
    btnFav.setAttribute('aria-pressed', String(s.favorited));
    likeCount.textContent = s.likes;
    favCount.textContent = s.favorites;

    const score = s.myRating || 0;
    for (const b of starsBox.children) {
      const n = Number(b.dataset.score);
      b.classList.toggle('on', n <= score);
      b.setAttribute('aria-checked', String(n === score));
    }
    // 降级状态下灯箱里的按钮也必须保持禁用
    if (degraded) {
      btnLike.disabled = true;
      btnFav.disabled = true;
      for (const b of starsBox.children) b.disabled = true;
      $('#reviewSubmit').disabled = true;
    }
    rateSummary.textContent = s.ratingCount
      ? `${formatAvg(s.ratingAvg)} 分 · ${s.ratingCount} 人评分${score ? ` · 你打了 ${score} 星` : ''}`
      : (score ? `你打了 ${score} 星` : '还没有评分');
  }

  async function loadReviews(id) {
    reviewList.textContent = '';
    reviewEmpty.hidden = true;
    reviewCount.textContent = statOf(id).reviewCount || 0;
    if (!store) return;
    try {
      const list = await store.getReviews(id);
      const cur = state.view[state.current];
      if (cur && cur.id !== id) return; // 已经翻到别的图了
      reviewCount.textContent = list.length;
      reviewEmpty.hidden = list.length > 0;
      for (const r of list) {
        const li = document.createElement('li');
        li.className = 'review-item';
        li.innerHTML = `
          <p class="review-head"><b>${esc(r.name || '匿名访客')}</b><time>${esc(relTime(r.at))}</time></p>
          <p class="review-body">${esc(r.text)}</p>`;
        reviewList.append(li);
      }
    } catch (err) {
      handleStoreError(err);
    }
  }

  const currentWork = () => state.view[state.current] || null;

  /* ---------- 事件 ---------- */
  chipsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    setTag(btn.dataset.tag);
    render();
  });

  sortSelect.addEventListener('change', () => {
    state.sort = sortSelect.value;
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

  btnLike.addEventListener('click', async () => {
    const w = currentWork();
    if (!w || !store || degraded) return;
    btnLike.disabled = true;
    try {
      await store.toggleLike(w.id);
      await refreshStats();
      renderInteract(w.id);
      syncCard(w.id);
      updateStats();
      if (state.boardId === w.id) fillBoard(WORKS, w.id);
    } catch (err) { handleStoreError(err); } finally { btnLike.disabled = false; }
  });

  btnFav.addEventListener('click', async () => {
    const w = currentWork();
    if (!w || !store || degraded) return;
    btnFav.disabled = true;
    try {
      await store.toggleFavorite(w.id);
      await refreshStats();
      renderInteract(w.id);
      syncCard(w.id);
      updateStats();
    } catch (err) { handleStoreError(err); } finally { btnFav.disabled = false; }
  });

  starsBox.addEventListener('click', async (e) => {
    const star = e.target.closest('.star');
    const w = currentWork();
    if (!star || !w || !store || degraded) return;
    try {
      await store.setRating(w.id, Number(star.dataset.score));
      await refreshStats();
      renderInteract(w.id);
      syncCard(w.id);
      if (state.sort === 'rating') render();
    } catch (err) { handleStoreError(err); }
  });

  reviewText.addEventListener('input', () => {
    reviewLen.textContent = `${reviewText.value.length} / 200`;
  });

  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const w = currentWork();
    const text = reviewText.value.trim();
    if (!w || !store || !text || degraded) return;
    const submit = $('#reviewSubmit');
    submit.disabled = true;
    try {
      await store.addReview(w.id, text, reviewName.value);
      try { localStorage.setItem('luka-gallery:nickname', reviewName.value.trim()); } catch { /* 忽略 */ }
      reviewText.value = '';
      reviewLen.textContent = '0 / 200';
      await loadReviews(w.id);
      await refreshStats();
      syncCard(w.id);
    } catch (err) {
      handleStoreError(err);
    } finally {
      submit.disabled = false;
    }
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
      if (typing) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Tab') trapFocus(e);
      return;
    }
    if (typing) return;
    if (e.key === 'r' || e.key === 'R') randomBtn.click();
  });

  function trapFocus(e) {
    const focusables = $$('button, a[href], input, textarea, select', lb)
      .filter((el) => !el.hidden && !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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

  /* 触屏滑动翻页：只在图片区域起手才算，避免和评论/详情的滚动冲突 */
  let touchX = 0;
  let touchY = 0;
  let touchInStage = false;
  lb.addEventListener('touchstart', (e) => {
    touchInStage = !!e.target.closest('.lb-stage');
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (!touchInStage) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ---------- 启动 ---------- */
  async function boot() {
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

    // 存储层：有共享后端配置就用共享，否则退回本机存储
    try {
      store = await window.GalleryStore.create();
    } catch (err) {
      console.warn('[gallery] 存储初始化失败', err);
      store = null;
    }
    if (!store) {
      store = {
        mode: 'none',
        getStats: async () => ({}),
        getReviews: async () => [],
        toggleLike: async () => null,
        toggleFavorite: async () => null,
        setRating: async () => null,
        addReview: async () => [],
      };
      degrade('存储不可用');
    }
    if (store.mode === 'local') modeNote.hidden = false;
    if (store.brokenReason) degrade(store.brokenReason);

    try {
      await refreshStats();
    } catch (err) {
      console.warn('[gallery] 互动数据加载失败', err);
      stats = {};
      handleStoreError(err);
    }

    try { reviewName.value = localStorage.getItem('luka-gallery:nickname') || ''; } catch { /* 忽略 */ }

    buildChips();
    render();
    updateStats();
    fillBoard(WORKS);
    if (usesWebp()) checkWebpSupport();

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
  }

  boot();
})();
