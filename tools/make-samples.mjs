/**
 * 示例插画生成器（纯 Node，无依赖）
 * 用法： node tools/make-samples.mjs
 *
 * 这些 SVG 只是「你还没放真图时」的占位展示，让你先看到画廊排版效果。
 * 输出到 assets/samples/ —— 不会污染 assets/works/ 里的真实作品。
 * 放入真实作品后可以完全忽略这个脚本，甚至删掉这批示例。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'samples');
mkdirSync(OUT, { recursive: true });

/* 巡音流歌印象配色：粉 + 青 + 深蓝紫底 */
const THEMES = [
  { a: '#1a0f22', b: '#43203c', pink: '#ff6fa5', cyan: '#5ce1e6' },
  { a: '#081420', b: '#12384f', pink: '#ff8ab5', cyan: '#5ce1e6' },
  { a: '#150b22', b: '#301a55', pink: '#ff9ec7', cyan: '#b489ff' },
  { a: '#0b1720', b: '#233240', pink: '#ff7fb0', cyan: '#8ad8ff' },
  { a: '#1d0a1a', b: '#521438', pink: '#ff5f8f', cyan: '#ffd166' },
  { a: '#07171a', b: '#0f3f42', pink: '#ff9ad5', cyan: '#63f5d8' },
];

function rng(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 131 + ch.codePointAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r1 = (n) => Math.round(n * 10) / 10;

/** 一个八分音符：实心符头 + 符干 + 符尾，比例正常 */
function note(x, y, size, fill, opacity) {
  const head = size * 0.38;
  return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(-14)" opacity="${opacity}">
    <ellipse cx="0" cy="0" rx="${r1(head)}" ry="${r1(head * 0.82)}" fill="${fill}"/>
    <rect x="${r1(head * 0.74)}" y="${r1(-size * 1.55)}" width="${r1(size * 0.13)}" height="${r1(size * 1.62)}" rx="${r1(size * 0.065)}" fill="${fill}"/>
    <path d="M${r1(head * 0.87)} ${r1(-size * 1.55)} c ${r1(size * 0.5)} ${r1(size * 0.22)} ${r1(size * 0.62)} ${r1(size * 0.72)} ${r1(size * 0.3)} ${r1(size * 1.12)} c ${r1(size * 0.16)} ${r1(-size * 0.5)} ${r1(0.02 * size)} ${r1(-size * 0.78)} ${r1(-size * 0.3)} ${r1(-size * 1.12)} z" fill="${fill}"/>
  </g>`;
}

function softCircles(rand, w, h, colors, count) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const r = (0.1 + rand() * 0.34) * Math.min(w, h);
    const color = colors[i % colors.length];
    out += `<circle cx="${r1(rand() * w)}" cy="${r1(rand() * h)}" r="${r1(r)}" fill="${color}" opacity="${(0.06 + rand() * 0.09).toFixed(3)}"/>`;
  }
  return out;
}

function dotGrid(w, h, color, seed) {
  const rand = rng(seed);
  const r = Math.max(1.6, Math.min(w, h) * 0.0048);
  let out = `<g fill="${color}" opacity="0.22">`;
  for (let y = 0.11; y < 0.95; y += 0.045) {
    for (let x = 0.09; x < 0.96; x += 0.045) {
      out += `<circle cx="${r1(x * w + rand() * 5)}" cy="${r1(y * h + rand() * 5)}" r="${r1(r)}"/>`;
    }
  }
  return out + '</g>';
}

/** 底部五线谱：横向渐隐的曲线 */
function staff(w, h, color, seed) {
  const rand = rng(seed);
  const top = h * 0.66;
  const gap = h * 0.05;
  let out = `<g fill="none" stroke="${color}" stroke-linecap="round" opacity="0.5">`;
  for (let i = 0; i < 5; i++) {
    const seg = 6;
    const base = top + i * gap;
    let d = `M${r1(-w * 0.02)} ${r1(base + (rand() - 0.5) * gap * 0.4)}`;
    for (let k = 1; k <= seg; k++) {
      const x = (w * 1.02 * k) / seg;
      const y = base + Math.sin(k * 0.9 + i * 0.7 + rand() * 0.6) * gap * 0.55;
      d += ` Q ${r1(x - w / seg / 2)} ${r1(y - gap * 0.6)} ${r1(x)} ${r1(y)}`;
    }
    out += `<path d="${d}" stroke-width="${r1(Math.max(1.4, w / 700) * (1 + i * 0.25))}"/>`;
  }
  return out + '</g>';
}

/** 斜向光带 */
function beam(w, h, color, x, angle, width) {
  return `<g transform="rotate(${angle} ${r1(w / 2)} ${r1(h / 2)})">
    <rect x="${r1(x)}" y="${r1(-h * 0.3)}" width="${r1(width)}" height="${r1(h * 1.6)}" fill="${color}" opacity="0.07"/>
  </g>`;
}

function makeSvg({ id, w, h, themeIndex }) {
  const t = THEMES[themeIndex % THEMES.length];
  const rand = rng(id);
  const min = Math.min(w, h);
  const size = min * 0.2;
  const cx = w * 0.42;
  const cy = h * 0.44;

  const notes = [
    note(cx, cy, size, t.pink, 0.95),
    note(cx * 1.62, cy * 0.72, size * 0.62, t.cyan, 0.75),
    note(w * 0.78, h * 0.72, size * 0.44, '#ffffff', 0.42),
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="巡音流歌占位插画 ${id}">
  <defs>
    <radialGradient id="bg" cx="26%" cy="18%" r="92%">
      <stop offset="0" stop-color="${t.b}"/><stop offset="1" stop-color="${t.a}"/>
    </radialGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.pink}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${t.cyan}" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.a}" stop-opacity="0"/>
      <stop offset="1" stop-color="${t.a}" stop-opacity="0.92"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${t.pink}" stop-opacity="0.34"/>
      <stop offset="0.62" stop-color="${t.cyan}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${t.cyan}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${softCircles(rand, w, h, [t.pink, t.cyan, '#ffffff'], 7)}
  ${beam(w, h, '#ffffff', w * 0.22, -18, w * 0.16)}
  ${beam(w, h, t.cyan, w * 0.62, -18, w * 0.08)}

  <circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(min * 0.46)}" fill="url(#halo)"/>
  <circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(min * 0.34)}" fill="none" stroke="url(#glow)" stroke-width="${r1(min * 0.006)}" opacity="0.5"/>
  <circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(min * 0.4)}" fill="none" stroke="${t.pink}" stroke-width="1.2" opacity="0.2" stroke-dasharray="${r1(min * 0.02)} ${r1(min * 0.03)}"/>

  ${dotGrid(w, h, t.cyan, id + '-dots')}
  ${staff(w, h, t.cyan, id + '-staff')}
  ${notes}

  <rect y="${r1(h * 0.62)}" width="${w}" height="${r1(h * 0.38)}" fill="url(#fade)"/>
  <g opacity="0.14" fill="none" stroke="#ffffff" stroke-width="1.5">
    <rect x="${r1(w * 0.06)}" y="${r1(h * 0.06)}" width="${r1(w * 0.88)}" height="${r1(h * 0.88)}" rx="${r1(min * 0.05)}"/>
  </g>
</svg>
`;
}

/* 与 data/works.js 中 id 一一对应 */
const DATA = [
  ['twilight-song', 900, 1200, 0],
  ['deep-sea-echo', 900, 1200, 1],
  ['neon-stage', 1200, 900, 2],
  ['double-luka', 1200, 900, 3],
  ['pink-noise', 900, 1200, 4],
  ['vocaloid-live', 1200, 900, 5],
  ['smile-doodle', 900, 1200, 0],
  ['quartet', 1200, 900, 1],
  ['cassette', 900, 1200, 2],
  ['twin-tails', 900, 1200, 3],
  ['rainy-night', 1200, 900, 4],
  ['sound-wave', 900, 1200, 5],
];

for (const [id, w, h, themeIndex] of DATA) {
  writeFileSync(join(OUT, `${id}.svg`), makeSvg({ id, w, h, themeIndex }), 'utf8');
}

console.log(`已生成 ${DATA.length} 张示例插画 → assets/samples/`);
