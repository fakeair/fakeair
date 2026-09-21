/* ===========================================================
   巡音流歌图片集 · 互动存储层
   -----------------------------------------------------------
   同一套接口，两种实现，页面代码不需要知道背后是哪个：

   - 本机存储（默认）：数据存在浏览器 localStorage，零配置、零成本。
     缺点：每个人看到的赞数/评分是各自的，换设备就没了。
   - 共享存储：读取 config.js 里的 Supabase 配置，数据存云端，
     所有访客看到同一份数据。

   用法：
     const store = await GalleryStore.create();
     await store.getStats(['luka-01', 'luka-02']);
     await store.toggleLike('luka-01');
     await store.setRating('luka-01', 5);
     await store.addReview('luka-01', '很好看', '昵称');
   =========================================================== */
(function () {
  'use strict';

  const LS_KEY = 'luka-gallery:v1';
  const VISITOR_KEY = 'luka-gallery:visitor';

  /** 稳定的匿名访客标识（仅用于「同一人只能点一个赞/评一次分」的去重） */
  function visitorId() {
    try {
      let id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) ||
             'v-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch {
      return 'v-anonymous';
    }
  }

  /* =========================================================
     实现一：本机存储
     ========================================================= */
  class LocalStore {
    constructor() {
      this.mode = 'local';
      this.visitor = visitorId();
      this.data = this.#load();
    }

    #load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            likes: parsed.likes || {},        // { workId: { visitorId: 时间戳 } }
            favorites: parsed.favorites || {}, // { workId: { visitorId: 时间戳 } }
            ratings: parsed.ratings || {},     // { workId: { visitorId: 星数 } }
            reviews: parsed.reviews || {},     // { workId: [ { id, visitor, name, text, at } ] }
          };
        }
      } catch { /* 数据坏了就从空的开始 */ }
      return { likes: {}, favorites: {}, ratings: {}, reviews: {} };
    }

    #save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch { /* 无痕模式等，忽略 */ }
    }

    #bucket(kind, workId) {
      if (!this.data[kind][workId]) this.data[kind][workId] = {};
      return this.data[kind][workId];
    }

    async getStats(ids = null) {
      const target = ids || Object.keys(this.data.likes);
      const out = {};
      for (const id of target) {
        const likes = Object.keys(this.data.likes[id] || {}).length;
        const favs = Object.keys(this.data.favorites[id] || {}).length;
        const scores = Object.values(this.data.ratings[id] || {});
        const sum = scores.reduce((a, b) => a + b, 0);
        out[id] = {
          likes,
          favorites: favs,
          ratingCount: scores.length,
          ratingAvg: scores.length ? sum / scores.length : 0,
          liked: !!this.data.likes[id]?.[this.visitor],
          favorited: !!this.data.favorites[id]?.[this.visitor],
          myRating: this.data.ratings[id]?.[this.visitor] || 0,
          reviewCount: (this.data.reviews[id] || []).length,
        };
      }
      return out;
    }

    async toggleLike(id) {
      const bucket = this.#bucket('likes', id);
      const on = !bucket[this.visitor];
      if (on) bucket[this.visitor] = Date.now();
      else delete bucket[this.visitor];
      this.#save();
      return (await this.getStats([id]))[id];
    }

    async toggleFavorite(id) {
      const bucket = this.#bucket('favorites', id);
      const on = !bucket[this.visitor];
      if (on) bucket[this.visitor] = Date.now();
      else delete bucket[this.visitor];
      this.#save();
      return (await this.getStats([id]))[id];
    }

    async setRating(id, score) {
      const bucket = this.#bucket('ratings', id);
      const s = Math.max(1, Math.min(5, Math.round(score)));
      if (bucket[this.visitor] === s) delete bucket[this.visitor]; // 再点同一颗星 = 取消
      else bucket[this.visitor] = s;
      this.#save();
      return (await this.getStats([id]))[id];
    }

    async getReviews(id) {
      return (this.data.reviews[id] || []).slice().sort((a, b) => b.at - a.at);
    }

    async addReview(id, text, name) {
      const list = this.data.reviews[id] || (this.data.reviews[id] = []);
      list.push({
        id: 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        visitor: this.visitor,
        name: (name || '').trim().slice(0, 24) || '匿名访客',
        text: String(text).trim().slice(0, 200),
        at: Date.now(),
      });
      this.#save();
      return this.getReviews(id);
    }

    async getFavorites() {
      return Object.keys(this.data.favorites).filter((id) => this.data.favorites[id][this.visitor]);
    }
  }

  /* =========================================================
     实现二：共享存储（Supabase REST API）
     接口与 LocalStore 完全一致，页面代码无感。
     表结构见 docs/supabase-schema.sql：
       luka_likes(work_id, visitor_id)          唯一约束，赞 = 有行
       luka_favorites(work_id, visitor_id)      同上
       luka_ratings(work_id, visitor_id, score) 主键 (work_id, visitor_id)
       luka_comments(work_id, visitor_id, nickname, body, hidden)
       视图 luka_work_stats  每张图的赞/收藏/评分人数/平均分/评论数
       视图 luka_my_state    当前访客自己的状态（需带 visitor_id 过滤）
     ========================================================= */
  class SharedStore {
    constructor(cfg) {
      this.mode = 'shared';
      this.url = String(cfg.url).replace(/\/+$/, '');
      this.key = cfg.anonKey;
      this.visitor = visitorId();
    }

    async #req(path, options = {}) {
      let res;
      try {
        res = await fetch(this.url + '/rest/v1/' + path, {
          ...options,
          headers: {
            apikey: this.key,
            Authorization: 'Bearer ' + this.key,
            'Content-Type': 'application/json',
            'X-Visitor-Id': this.visitor,
            ...(options.headers || {}),
          },
        });
      } catch {
        throw new Error('连不上互动服务，检查一下网络');
      }

      const text = await res.text();
      if (!res.ok) {
        // PostgREST 的错误体里通常有 message，比如「短评太频繁了」
        let msg = '';
        try { msg = JSON.parse(text).message || ''; } catch { msg = text.slice(0, 120); }
        const err = new Error(msg || `请求失败（${res.status}）`);
        err.status = res.status;
        throw err;
      }
      return text ? JSON.parse(text) : null;
    }

    /** 全部作品的公开统计 */
    async #workStats() {
      const rows = await this.#req('luka_work_stats?select=work_id,like_count,favorite_count,rating_count,rating_avg,comment_count');
      const out = {};
      for (const r of rows || []) {
        out[r.work_id] = {
          likes: Number(r.like_count) || 0,
          favorites: Number(r.favorite_count) || 0,
          ratingCount: Number(r.rating_count) || 0,
          ratingAvg: Number(r.rating_avg) || 0,
          reviewCount: Number(r.comment_count) || 0,
        };
      }
      return out;
    }

    /**
     * 当前访客自己的赞 / 收藏 / 评分。
     *
     * 这里刻意**直接查三张基础表**，而不是用 schema 里的 luka_my_state 视图：
     * 那个视图没有暴露 visitor_id 列，没法按访客过滤（会被 PostgREST 拒绝：
     * 「column luka_my_state.visitor_id does not exist」），而且不带过滤查会
     * 把**所有访客**的数据一起返回。三个并行请求换正确性，值得。
     */
    async #mine() {
      const q = (table, cols) => this.#req(
        `${table}?select=${cols}&visitor_id=eq.${encodeURIComponent(this.visitor)}`,
      );
      const [likes, favs, ratings] = await Promise.all([
        q('luka_likes', 'work_id'),
        q('luka_favorites', 'work_id'),
        q('luka_ratings', 'work_id,score'),
      ]);
      return {
        likes: new Set((likes || []).map((r) => r.work_id)),
        favorites: new Set((favs || []).map((r) => r.work_id)),
        ratings: Object.fromEntries((ratings || []).map((r) => [r.work_id, Number(r.score)])),
      };
    }

    async getStats() {
      const [agg, mine] = await Promise.all([this.#workStats(), this.#mine()]);
      const out = {};
      for (const id of new Set([...Object.keys(agg), ...mine.likes, ...mine.favorites, ...Object.keys(mine.ratings)])) {
        const a = agg[id] || {};
        out[id] = {
          likes: a.likes || 0,
          favorites: a.favorites || 0,
          ratingCount: a.ratingCount || 0,
          ratingAvg: a.ratingAvg || 0,
          reviewCount: a.reviewCount || 0,
          liked: mine.likes.has(id),
          favorited: mine.favorites.has(id),
          myRating: mine.ratings[id] || 0,
        };
      }
      return out;
    }

    #insert(table, row, { onConflict = '', merge = false } = {}) {
      const qs = onConflict ? `?on_conflict=${onConflict}` : '';
      return this.#req(`${table}${qs}`, {
        method: 'POST',
        headers: { Prefer: `${merge ? 'resolution=merge-duplicates,' : ''}return=minimal` },
        body: JSON.stringify(row),
      });
    }

    #remove(table) {
      return this.#req(
        `${table}?work_id=eq.${encodeURIComponent(this.currentId)}&visitor_id=eq.${encodeURIComponent(this.visitor)}`,
        { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
      );
    }

    /**
     * 点赞/收藏是「有行 = 已点」的语义，所以切换 = 插入或删除。
     * 这里先试插入：插入成功说明之前没点过；因唯一约束冲突失败（409）说明已经点过，
     * 于是删掉它。只做增量更新，不需要每次把全量统计再拉一遍。
     */
    async #toggle(table, id) {
      this.currentId = id;
      try {
        await this.#insert(table, { work_id: id, visitor_id: this.visitor });
        return true;   // 现在是「已点」
      } catch (err) {
        if (err.status === 409) {
          await this.#remove(table);
          return false; // 现在是「未点」
        }
        throw err;
      }
    }

    async toggleLike(id) {
      const on = await this.#toggle('luka_likes', id);
      const s = await this.getOne(id);
      s.liked = on;
      return null;
    }

    async toggleFavorite(id) {
      const on = await this.#toggle('luka_favorites', id);
      const s = await this.getOne(id);
      s.favorited = on;
      return null;
    }

    /** 单张图的最新统计（切换后调用，保证卡片数字准确） */
    async getOne(id) {
      const [rows, mine] = await Promise.all([
        this.#req(
          `luka_work_stats?select=like_count,favorite_count,rating_count,rating_avg,comment_count&work_id=eq.${encodeURIComponent(id)}`,
        ),
        this.#mine(),
      ]);
      const r = rows && rows[0];
      return {
        likes: r ? Number(r.like_count) || 0 : 0,
        favorites: r ? Number(r.favorite_count) || 0 : 0,
        ratingCount: r ? Number(r.rating_count) || 0 : 0,
        ratingAvg: r ? Number(r.rating_avg) || 0 : 0,
        reviewCount: r ? Number(r.comment_count) || 0 : 0,
        liked: mine.likes.has(id),
        favorited: mine.favorites.has(id),
        myRating: mine.ratings[id] || 0,
      };
    }

    async setRating(id, score) {
      const s = Math.max(1, Math.min(5, Math.round(score)));
      const mine = await this.#mine();
      if (mine.ratings[id] === s) {
        this.currentId = id;
        await this.#remove('luka_ratings');
      } else {
        await this.#insert(
          'luka_ratings',
          { work_id: id, visitor_id: this.visitor, score: s },
          { onConflict: 'work_id,visitor_id', merge: true },
        );
      }
      return null;
    }

    async getReviews(id) {
      const rows = await this.#req(
        'luka_comments?select=id,nickname,body,created_at' +
        `&work_id=eq.${encodeURIComponent(id)}&hidden=eq.false&order=created_at.desc&limit=200`,
      );
      return (rows || []).map((r) => ({
        id: r.id,
        name: r.nickname || '匿名访客',
        text: r.body,
        at: Date.parse(r.created_at) || 0,
      }));
    }

    async addReview(id, text, name) {
      await this.#insert('luka_comments', {
        work_id: id,
        visitor_id: this.visitor,
        nickname: (name || '').trim().slice(0, 24) || null,
        body: String(text).trim().slice(0, 200),
      });
      return this.getReviews(id);
    }

    async getFavorites() {
      const mine = await this.#mine();
      return [...mine.favorites];
    }

    /* ---------- 访客上传（表结构见 docs/supabase-uploads.sql） ---------- */

    /** 列出所有未隐藏的投稿，转成和 data/works.js 同样的结构 */
    async listUploads() {
      const rows = await this.#req(
        'luka_uploads?select=work_id,title,author,tags,src,thumb,w,h,created_at' +
        '&hidden=eq.false&order=created_at.desc&limit=500',
      );
      return (rows || []).map((r) => ({
        id: r.work_id,
        title: r.title,
        author: r.author || '匿名访客',
        tags: Array.isArray(r.tags) && r.tags.length ? r.tags : ['投稿'],
        src: r.src,
        thumb: r.thumb || r.src,
        hero: r.thumb || r.src,
        w: Number(r.w) || 4,
        h: Number(r.h) || 3,
        uploaded: true,
        mtime: Date.parse(r.created_at) || 0,
      }));
    }

    /** 登记一条投稿。文件由 assets/js/upload.js 先传到 Storage */
    async addUpload(row) {
      await this.#insert('luka_uploads', {
        work_id: row.work_id,
        title: String(row.title).trim().slice(0, 60),
        author: String(row.author || '').trim().slice(0, 24) || null,
        tags: row.tags || [],
        src: row.src,
        thumb: row.thumb || null,
        w: row.w,
        h: row.h,
        visitor_id: this.visitor,
      });
    }
  }

  /* =========================================================
     入口：有配置就用共享存储，否则退回本机存储
     ========================================================= */
  async function create() {
    const cfg = window.GALLERY_BACKEND || null;
    const configured = cfg && cfg.url && cfg.anonKey &&
      !/YOUR-|在这里|PASTE/i.test(cfg.url + cfg.anonKey);

    if (!configured) return new LocalStore();

    // 只在「配置本身有问题」时退回本机（比如地址写错、密钥无效）；
    // 暂时性的网络故障不应该让用户以为数据是私有的。
    const store = new SharedStore(cfg);
    try {
      await store.getStats();
      return store;
    } catch (err) {
      console.warn('[gallery] 共享存储不可用：', err.message);
      store.brokenReason = err.message;
      return store; // 仍然用它，让用户看到真实的错误提示
    }
  }

  /** 评分平均值显示成 4.7 这种一位小数 */
  function formatAvg(avg) {
    return avg > 0 ? avg.toFixed(1) : '—';
  }

  window.GalleryStore = { create, formatAvg };
})();
