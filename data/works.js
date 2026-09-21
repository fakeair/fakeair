/**
 * 巡音流歌 · 角色画廊数据
 * -----------------------------------------------------------
 * 本文件由 tools/scan-works.mjs 自动生成，请勿手改结构；
 * 但你可以放心修改 title（作品名）和 author（作者署名），
 * 再次扫描时会保留你填的内容。
 *
 * 重新生成： node tools/scan-works.mjs
 * 清空重来： node tools/scan-works.mjs --reset
 *
 * 字段：
 *   id      文件名生成，用于分享链接 #!id
 *   src     原图（只在点开看大图时加载）
 *   thumb   列表缩略图（约 60~90KB，列表秒开）
 *   hero    首屏主视觉图（中等尺寸，约 200~400KB）
 *   w / h   原始宽高，用于加载前占位
 *   title   作品名（默认取文件名）
 *   author  作者署名
 *   tags    展示分类：立绘 / 半身 / 头像 / 横图（按尺寸自动判断，可手改）
 *   link    可选，原帖链接
 *
 * thumb / hero 由 tools/make-thumbs.mjs 生成；没有生成时自动回退成原图。
 */
window.WORKS = [
  {
    id: "luka-08",
    src: "assets/works/luka-08.webp",
    thumb: "assets/thumbnails/luka-08.jpg",
    hero: "assets/hero/luka-08.jpg",
    w: 1728, h: 2304,
    title: "聚光灯下",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-07",
    src: "assets/works/luka-07.webp",
    thumb: "assets/thumbnails/luka-07.jpg",
    hero: "assets/hero/luka-07.jpg",
    w: 1728, h: 2304,
    title: "霓虹雨夜",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-06",
    src: "assets/works/luka-06.webp",
    thumb: "assets/thumbnails/luka-06.jpg",
    hero: "assets/hero/luka-06.jpg",
    w: 1728, h: 2304,
    title: "星间气泡",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-05",
    src: "assets/works/luka-05.webp",
    thumb: "assets/thumbnails/luka-05.jpg",
    hero: "assets/hero/luka-05.jpg",
    w: 1728, h: 2304,
    title: "白厅回眸",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-04",
    src: "assets/works/luka-04.webp",
    thumb: "assets/thumbnails/luka-04.jpg",
    hero: "assets/hero/luka-04.jpg",
    w: 1728, h: 2304,
    title: "镜前",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-03",
    src: "assets/works/luka-03.webp",
    thumb: "assets/thumbnails/luka-03.jpg",
    hero: "assets/hero/luka-03.jpg",
    w: 1728, h: 2304,
    title: "林间微光",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-02",
    src: "assets/works/luka-02.webp",
    thumb: "assets/thumbnails/luka-02.jpg",
    hero: "assets/hero/luka-02.jpg",
    w: 1728, h: 2304,
    title: "录音室",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "luka-01",
    src: "assets/works/luka-01.webp",
    thumb: "assets/thumbnails/luka-01.jpg",
    hero: "assets/hero/luka-01.jpg",
    w: 1728, h: 2304,
    title: "落日海岸",
    author: "fakeair",
    tags: ["立绘"],
  },
  {
    id: "collab-02",
    src: "assets/works/collab-02.webp",
    thumb: "assets/thumbnails/collab-02.jpg",
    hero: "assets/hero/collab-02.jpg",
    w: 2048, h: 2048,
    title: "立牌合照",
    author: "fakeair",
    tags: ["头像"],
  },
  {
    id: "collab-01",
    src: "assets/works/collab-01.webp",
    thumb: "assets/thumbnails/collab-01.jpg",
    hero: "assets/hero/collab-01.jpg",
    w: 1097, h: 1434,
    title: "贴纸合影",
    author: "fakeair",
    tags: ["立绘"],
  },
];
