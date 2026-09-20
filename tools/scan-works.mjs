/**
 * 图片扫描器（纯 Node，无依赖）
 * -----------------------------------------------------------
 * 用法： node tools/scan-works.mjs
 *
 * 它会扫描 assets/works/ 里所有的图片（png / jpg / jpeg / webp / gif / svg），
 * 读出每张图的真实宽高，然后重新生成 data/works.js。
 *
 * 你只需要：把图丢进 assets/works/ → 跑这条命令 → 刷新页面。
 *
 * 想手写作品名和作者？在 data/works.js 里改就行，
 * 再次扫描时会尽量保留你已经填过的标题 / 作者 / 标签（按文件名匹配）。
 * 想彻底重来：node tools/scan-works.mjs --reset
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'assets', 'works');
const OUT = join(ROOT, 'data', 'works.js');
const RESET = process.argv.includes('--reset');
const RETAG = process.argv.includes('--retag');

const EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'];

/* ---------------- 读取图片尺寸 ---------------- */

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'GIF') return null;
  return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15，排除 DHT(c4) / JPG(c8) / DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const fmt = buf.toString('latin1', 12, 16);
  if (fmt === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (fmt === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function svgSize(buf) {
  const text = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  if (!/<svg[\s>]/i.test(text)) return null;
  const tag = text.slice(text.search(/<svg[\s>]/i));
  const attr = (name) => {
    const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag);
    return m ? parseFloat(m[1]) : NaN;
  };
  let w = attr('width');
  let h = attr('height');
  if ((!w || !h) && /viewBox/i.test(tag)) {
    const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (vb) {
      const p = vb[1].trim().split(/[\s,]+/).map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
    }
  }
  if (!w || !h || !isFinite(w) || !isFinite(h)) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

function readSize(file) {
  const ext = extname(file).toLowerCase();
  const buf = readFileSync(file);
  const found = ext === '.png' ? pngSize(buf)
    : ext === '.gif' ? gifSize(buf)
    : ext === '.jpg' || ext === '.jpeg' ? jpegSize(buf)
    : ext === '.webp' ? webpSize(buf)
    : ext === '.svg' ? svgSize(buf)
    : null;
  return found && found.w > 0 && found.h > 0 ? found : null;
}

/* ---------------- 分类与命名 ---------------- */

/** 按宽高比自动给出角色展示分类 */
function autoTags(w, h) {
  const ratio = w / h;
  if (ratio <= 0.78) return ['立绘'];
  if (ratio <= 0.95) return ['半身'];
  if (ratio <= 1.25) return ['头像'];
  return ['横图'];
}

/** 文件名 → 可读标题：去扩展名、下划线/连字符转空格 */
function prettyName(base) {
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function idFromFile(file) {
  return basename(file, extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'work';
}

/* ---------------- 读取旧数据，保留手工修改 ---------------- */

function loadExisting() {
  const map = new Map();
  if (RESET || !existsSync(OUT)) return map;
  try {
    const src = readFileSync(OUT, 'utf8');
    // 用 work.id 作为 key，粗暴但够用的解析
    const blocks = src.split(/\n\s*\{\s*\n/).slice(1);
    for (const b of blocks) {
      const pick = (k) => {
        const m = new RegExp(`${k}\\s*:\\s*(['"])([\\s\\S]*?)\\1`).exec(b);
        return m ? m[2] : undefined;
      };
      const id = pick('id');
      if (!id) continue;
      map.set(id, {
        title: pick('title'),
        author: pick('author'),
        link: pick('link'),
        tags: (() => {
          const m = /tags\s*:\s*\[([^\]]*)\]/.exec(b);
          return m ? m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : undefined;
        })(),
      });
    }
  } catch {
    /* 旧文件坏了就当作没有 */
  }
  return map;
}

/* ---------------- 主流程 ---------------- */

if (!existsSync(DIR)) {
  console.error(`找不到目录：${DIR}`);
  process.exit(1);
}

const files = readdirSync(DIR)
  .filter((f) => EXTS.includes(extname(f).toLowerCase()))
  .filter((f) => !f.startsWith('.'));

if (!files.length) {
  console.log(`assets/works/ 里还没有图片。把流歌的图放进去，再跑一次这条命令。`);
  process.exit(0);
}

const existing = loadExisting();
const skipped = [];
const works = [];
const THUMB_DIR = join(ROOT, 'assets', 'thumbnails');
const HERO_DIR = join(ROOT, 'assets', 'hero');

/** 优先用生成好的小图，没有就回退原图 */
function variantDir(dir, folder, file) {
  const candidate = join(dir, basename(file, extname(file)) + '.jpg');
  return existsSync(candidate) ? `assets/${folder}/${basename(file, extname(file))}.jpg` : null;
}

for (const file of files) {
  const full = join(DIR, file);
  const size = readSize(full);
  if (!size) { skipped.push(file); continue; }

  const id = idFromFile(file);
  const old = existing.get(id) || {};
  const stat = statSync(full);
  const original = `assets/works/${file}`;

  works.push({
    id,
    src: original,
    thumb: variantDir(THUMB_DIR, 'thumbnails', file) || original,
    hero: variantDir(HERO_DIR, 'hero', file) || variantDir(THUMB_DIR, 'thumbnails', file) || original,
    w: size.w,
    h: size.h,
    title: old.title || prettyName(basename(file, extname(file))),
    author: old.author || '',
    tags: (!RETAG && old.tags && old.tags.length) ? old.tags : autoTags(size.w, size.h),
    link: old.link,
    mtime: stat.mtimeMs,
  });
}

// 新图在前：按修改时间倒序
works.sort((a, b) => b.mtime - a.mtime);

const body = works.map((wk) => {
  const lines = [
    '  {',
    `    id: ${JSON.stringify(wk.id)},`,
    `    src: ${JSON.stringify(wk.src)},`,
    `    thumb: ${JSON.stringify(wk.thumb)},`,
    `    hero: ${JSON.stringify(wk.hero)},`,
    `    w: ${wk.w}, h: ${wk.h},`,
    `    title: ${JSON.stringify(wk.title)},`,
    `    author: ${JSON.stringify(wk.author)},`,
    `    tags: [${wk.tags.map((t) => JSON.stringify(t)).join(', ')}],`,
  ];
  if (wk.link) lines.push(`    link: ${JSON.stringify(wk.link)},`);
  lines.push('  },');
  return lines.join('\n');
}).join('\n');

const out = `/**
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
${body}
];
`;

writeFileSync(OUT, out, 'utf8');

console.log(`扫描完成：${works.length} 张图片 → data/works.js`);
const byTag = {};
for (const wk of works) for (const t of wk.tags) byTag[t] = (byTag[t] || 0) + 1;
console.log('分类统计：' + Object.entries(byTag).map(([k, v]) => `${k} ${v}`).join(' · '));
if (skipped.length) console.log(`跳过（读不出尺寸，可能是 avif 或损坏文件）：${skipped.join(', ')}`);
console.log('提示：在 data/works.js 里补上 author（作者署名），再刷新页面即可。');
