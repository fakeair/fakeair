/**
 * 【示例】扫描真实图片后生成的数据长什么样
 * -----------------------------------------------------------
 * 这不是页面实际读取的文件（页面读的是 data/works.js）。
 * 作用：让你在放图之前就知道扫描流程会产出什么。
 *
 * 下面 4 条记录是扫描 4 个测试文件后自动生成的：
 *   assets/works/luka-portrait-01.png   600x900  → 立绘
 *   assets/works/luka-wide-01.png       1200x800 → 横图
 *   assets/works/luka-head-01.png       800x800  → 头像
 *   assets/works/luka-photo-01.jpg      400x500  → 半身
 *
 * 可以看出几件事：
 *   1) w / h 是从图片文件头里真实读出来的（png / jpg / webp / gif / svg 都支持）
 *   2) tags 按宽高比自动判断：越窄越像立绘，越宽越像横图
 *   3) 新加入的图排在前面（按文件修改时间倒序）
 *   4) src 是原图，只在点开看大图时加载；
 *      thumb 是列表用的小图（约 60~90KB）；hero 是首屏主视觉用的中图（约 200~400KB）。
 *      thumb / hero 由 tools/make-thumbs.mjs 生成，没生成时自动回退成原图。
 *
 * 想重新按宽高比刷新分类： node tools/scan-works.mjs --retag
 */
window.WORKS = [
  {
    id: 'luka-photo-01',
    src: 'assets/works/luka-photo-01.jpg',
    thumb: 'assets/thumbnails/luka-photo-01.jpg',
    hero: 'assets/hero/luka-photo-01.jpg',
    w: 400, h: 500,
    title: 'Luka Photo 01',
    author: '',
    tags: ['半身'],
  },
  {
    id: 'luka-head-01',
    src: 'assets/works/luka-head-01.png',
    thumb: 'assets/thumbnails/luka-head-01.jpg',
    hero: 'assets/hero/luka-head-01.jpg',
    w: 800, h: 800,
    title: 'Luka Head 01',
    author: '',
    tags: ['头像'],
  },
  {
    id: 'luka-wide-01',
    src: 'assets/works/luka-wide-01.png',
    thumb: 'assets/thumbnails/luka-wide-01.jpg',
    hero: 'assets/hero/luka-wide-01.jpg',
    w: 1200, h: 800,
    title: 'Luka Wide 01',
    author: '',
    tags: ['横图'],
  },
  {
    id: 'luka-portrait-01',
    src: 'assets/works/luka-portrait-01.png',
    thumb: 'assets/thumbnails/luka-portrait-01.jpg',
    hero: 'assets/hero/luka-portrait-01.jpg',
    w: 600, h: 900,
    title: 'Luka Portrait 01',
    author: '',
    tags: ['立绘'],
  },
];
