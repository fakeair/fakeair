/**
 * 图片尺寸生成器（零依赖，借无头 Chrome 的 canvas 干活）
 * -----------------------------------------------------------
 * 用法： node tools/make-thumbs.mjs [列表宽] [主视觉宽]
 *        node tools/make-thumbs.mjs 520 1000      # 默认
 *
 * 为什么需要它：
 *   原图动辄 4~5MB，8 张就 40MB。这个脚本为每张原图生成两档 JPEG：
 *     assets/thumbnails/<名>.jpg   列表用，约 60~90KB
 *     assets/hero/<名>.jpg         首屏主视觉用，约 200~400KB
 *   原图只在点开大图时才加载，于是「列表秒开 + 点开看原图」。
 *
 * 生成完执行 node tools/scan-works.mjs 把路径写进数据。
 * 找不到 Chrome 也能用：数据会自动回退成直接加载原图（能看，只是慢）。
 */
import { readdirSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets', 'works');
const TMP_HTML = join(ROOT, '_thumbs-tmp.html');
const TEMPLATE = join(ROOT, 'tools', '_thumbs-template.html');

const WIDTH = Number(process.argv[2]) || 520;
const HERO_WIDTH = Number(process.argv[3]) || 1000;
const QUALITY = 0.82;
const HERO_QUALITY = 0.86;
const EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
const MAX_INPUT = 30 * 1024 * 1024;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const findBrowser = () => CHROME_CANDIDATES.find((p) => existsSync(p)) || null;

if (!existsSync(SRC_DIR)) {
  console.error(`找不到目录：${SRC_DIR}`);
  process.exit(1);
}

const files = readdirSync(SRC_DIR).filter((f) => EXTS.includes(extname(f).toLowerCase()));
if (!files.length) {
  console.log('assets/works/ 里还没有图片，先放图再生成。');
  process.exit(0);
}

const browser = findBrowser();
if (!browser) {
  console.log('没找到 Chrome / Edge，跳过生成。');
  console.log('画廊会自动回退成直接加载原图（能看，只是慢一些）。');
  console.log('想生成：装个 Chrome，或用环境变量 CHROME_PATH 指定浏览器路径。');
  process.exit(0);
}

const skipped = [];
const todo = files.filter((f) => {
  const full = join(SRC_DIR, f);
  const size = existsSync(full) ? statSync(full).size : 0;
  if (size > MAX_INPUT) { skipped.push(`${f}（${Math.round(size / 1024 / 1024)}MB，过大）`); return false; }
  return true;
});
if (!todo.length) {
  console.log('没有适合处理的图片。');
  if (skipped.length) console.log('跳过：' + skipped.join('、'));
  process.exit(0);
}

const conf = JSON.stringify({ files: todo, width: WIDTH, quality: QUALITY, heroWidth: HERO_WIDTH, heroQuality: HERO_QUALITY });
writeFileSync(TMP_HTML, readFileSync(TEMPLATE, 'utf8').replace('__CONF__', conf), 'utf8');

mkdirSync(join(ROOT, 'assets', 'thumbnails'), { recursive: true });
mkdirSync(join(ROOT, 'assets', 'hero'), { recursive: true });

console.log(`正在生成（列表 ${WIDTH}px / 主视觉 ${HERO_WIDTH}px），共 ${todo.length} 张原图…`);

const res = spawnSync(browser, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-crash-reporter',
  '--virtual-time-budget=180000',
  '--window-size=900,700',
  `--user-data-dir=${join(ROOT, '.thumbs-profile')}`,
  '--dump-dom',
  'http://127.0.0.1:5173/_thumbs-tmp.html',
], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });

rmSync(TMP_HTML, { force: true });
rmSync(join(ROOT, '.thumbs-profile'), { recursive: true, force: true });

const dom = res.stdout || '';
const m = /###([\s\S]*?)###/.exec(dom);
if (!m) {
  console.error('生成失败：浏览器没有返回结果。');
  console.error('请确认本地预览服务器正在运行：node tools/serve.mjs');
  if (res.stderr) console.error(String(res.stderr).slice(0, 800));
  process.exit(1);
}

const DIRS = { thumb: 'thumbnails', hero: 'hero' };
let count = 0;
for (const line of m[1].trim().split('\n')) {
  const parts = line.split('|');
  if (parts.length !== 5) continue;
  const [kind, name, w, h, b64] = parts;
  const out = join(ROOT, 'assets', DIRS[kind], basename(name, extname(name)) + '.jpg');
  writeFileSync(out, Buffer.from(b64, 'base64'));
  count++;
  console.log(`  ${kind.padEnd(5)} ${name} → ${w}x${h}`);
}

// 清理孤儿文件：原图被删掉或改名后，旧的缩略图/主视觉图会留在目录里，
// 越攒越乱，所以这里按「原图文件名」清一遍。
const stems = new Set(files.map((f) => basename(f, extname(f))));
let pruned = 0;
for (const folder of ['thumbnails', 'hero']) {
  const dir = join(ROOT, 'assets', folder);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== '.jpg') continue;
    if (!stems.has(basename(f, '.jpg'))) {
      rmSync(join(dir, f), { force: true });
      pruned++;
      console.log(`  清理孤儿 ${folder}/${f}`);
    }
  }
}

console.log(`\n完成：${count} 个文件（assets/thumbnails/ 与 assets/hero/）`);
if (pruned) console.log(`清理了 ${pruned} 个已无对应原图的旧文件。`);
if (skipped.length) console.log('跳过：' + skipped.join('、'));
console.log('下一步： node tools/scan-works.mjs');
