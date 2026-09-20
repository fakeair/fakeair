/**
 * 原图体积优化（零依赖，借无头 Chrome 的 canvas）
 * -----------------------------------------------------------
 * 用法： node tools/optimize-originals.mjs
 *
 * 背景：AI 生成的 PNG 动辄 4~5MB，10 张就 44MB —— 部署会被平台限制，
 *       访客点开大图也要等很久。
 *
 * 做法：**不缩尺寸**，只把无损 PNG 重新编码成有损 WebP / JPEG
 *       （1728x2304 依然清晰，体积降到 1/5 左右）。
 *       哪种格式小就用哪种，然后替换掉原 PNG。
 *
 * 注意：只处理「颜色类型为 RGB（无透明通道）」的 PNG。
 *       带透明通道的图会被跳过，避免透明区域变成黑块。
 */
import { readdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets', 'works');
const TMP_HTML = join(ROOT, '_optimize-tmp.html');
const TEMPLATE = join(ROOT, 'tools', '_optimize-template.html');
const WEBP_Q = 0.9;
const JPEG_Q = 0.9;

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => existsSync(p));

/** PNG 颜色类型：6 / 4 带透明通道，跳过 */
function pngColorType(file) {
  const b = readFileSync(file);
  if (b.length < 26 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return b[25];
}

if (!CHROME) {
  console.error('没找到 Chrome / Edge，无法优化。（这一步需要浏览器做编码）');
  process.exit(1);
}

const originals = readdirSync(SRC_DIR).filter((f) => extname(f).toLowerCase() === '.png');
if (!originals.length) {
  console.log('assets/works/ 里没有 PNG，无需优化。');
  process.exit(0);
}

const todo = [];
const skipped = [];
const sizes = {};
for (const f of originals) {
  const full = join(SRC_DIR, f);
  const ct = pngColorType(full);
  if (ct === 6 || ct === 4) { skipped.push(`${f}（带透明通道）`); continue; }
  const size = statSync(full).size;
  if (size < 600 * 1024) { skipped.push(`${f}（已经够小）`); continue; }
  todo.push(f);
  sizes[f] = size;
}

if (!todo.length) {
  console.log('没有需要优化的 PNG。');
  if (skipped.length) console.log('跳过：' + skipped.join('、'));
  process.exit(0);
}

const conf = JSON.stringify({ files: todo, original: sizes, webpQuality: WEBP_Q, jpegQuality: JPEG_Q });
writeFileSync(TMP_HTML, readFileSync(TEMPLATE, 'utf8').replace('__CONF__', conf), 'utf8');

const total = Object.values(sizes).reduce((a, b) => a + b, 0);
console.log(`开始优化 ${todo.length} 张 PNG（原图合计 ${(total / 1048576).toFixed(1)}MB，不缩尺寸，只压体积）…`);

const res = spawnSync(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
  '--virtual-time-budget=600000', '--window-size=900,700',
  `--user-data-dir=${join(ROOT, '.opt-profile')}`,
  '--dump-dom', 'http://127.0.0.1:5173/_optimize-tmp.html',
], { encoding: 'utf8', maxBuffer: 2048 * 1024 * 1024 });

rmSync(TMP_HTML, { force: true });
rmSync(join(ROOT, '.opt-profile'), { recursive: true, force: true });

const dom = res.stdout || '';
const m = /###([\s\S]*?)###/.exec(dom);
if (!m) {
  console.error('优化失败：浏览器没有返回结果。请确认预览服务器在运行：node tools/serve.mjs');
  if (res.stderr) console.error(String(res.stderr).slice(0, 600));
  process.exit(1);
}

// 收集两种编码结果
const cand = new Map();
for (const line of m[1].trim().split('\n')) {
  const i = line.indexOf('|');
  const j = line.indexOf('|', i + 1);
  const fmt = line.slice(0, i);
  const name = line.slice(i + 1, j);
  const b64 = line.slice(j + 1);
  if (!cand.has(name)) cand.set(name, {});
  cand.get(name)[fmt] = Buffer.from(b64, 'base64');
}

let before = 0;
let after = 0;
let replaced = 0;
for (const [name, formats] of cand) {
  const orig = sizes[name];
  const pick = ['webp', 'jpeg']
    .filter((f) => formats[f])
    .sort((a, b) => formats[a].length - formats[b].length)[0];
  if (!pick) continue;

  const data = formats[pick];
  if (data.length >= orig) {
    console.log(`  ${name} → 优化后反而更大，保留原 PNG`);
    before += orig; after += orig;
    continue;
  }

  const stem = basename(name, '.png');
  writeFileSync(join(SRC_DIR, `${stem}.${pick === 'webp' ? 'webp' : 'jpg'}`), data);
  rmSync(join(SRC_DIR, name), { force: true });
  before += orig;
  after += data.length;
  replaced++;
  console.log(`  ${name} → ${stem}.${pick === 'webp' ? 'webp' : 'jpg'}  ${Math.round(orig / 1024)}KB → ${Math.round(data.length / 1024)}KB`);
}

console.log(`\n完成：替换 ${replaced} 张，原图合计 ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(1)}MB（省 ${(100 - after / before * 100).toFixed(0)}%）`);
if (skipped.length) console.log('跳过：' + skipped.join('、'));
console.log('下一步：\n  node tools/make-thumbs.mjs\n  node tools/scan-works.mjs');
