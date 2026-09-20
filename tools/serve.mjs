/**
 * 本地预览服务器（零依赖）
 * 用法： node tools/serve.mjs [端口]
 * 然后打开 http://127.0.0.1:5173
 *
 * 注意：直接双击 index.html 也能正常浏览（图片全是相对路径），
 * 起服务器只是为了更接近真实部署环境。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    const target = normalize(join(ROOT, rel));
    if (!target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: rel + '/' }).end();
      return;
    }

    const body = await readFile(target);
    const ext = extname(target).toLowerCase();
    const isPage = ext === '.html' || ext === '';
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      // 页面不缓存（改了就能看到），图片/字体长缓存（体积大，重复访问省流量）
      'Cache-Control': isPage ? 'no-cache' : 'public, max-age=604800',
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  }
});

// 监听 0.0.0.0：同一个 WiFi 下的手机 / 其他电脑也能打开
server.listen(PORT, '0.0.0.0', () => {
  const lines = [`巡音流歌图片集 → http://127.0.0.1:${PORT}`];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) lines.push(`                 http://${ni.address}:${PORT}   （同一局域网可访问）`);
    }
  }
  console.log(lines.join('\n'));
});
