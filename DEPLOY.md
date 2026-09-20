# 部署指南 · 让这个网站留在网上

这个站是**纯静态**的：没有后端、没有数据库、没有构建步骤。
所有文件原样传上去就能跑，**不需要 Node、不需要联网抓数据**（访客访问时也不依赖任何外部服务）。

当前体积：图片合计 **7.9MB**（原图 4.7MB + 主视觉 2.5MB + 缩略图 0.8MB），任何免费平台都放得下。

---

## 三种方式，按省事程度排

### 方式一：Netlify Drop —— 最省事，不用装东西

适合「我只想赶紧有个网址能发给人看」。

1. 打开 <https://app.netlify.com/drop>
2. 把整个项目文件夹 `D:\WANZHAN` **直接拖进网页**
3. 等十几秒 → 拿到一个网址，类似 `https://random-name-123.netlify.app`
4. 想改名字：Site settings → Change site name
5. 想传新版本：把文件夹再拖一次（或在该站点 Deploys 页里拖）

不需要注册也能先看到效果；注册（可用 GitHub / Google 登录）后网址才不会被回收。

**注意**：拖拽时要拖**整个文件夹**，不要只拖 `index.html`，否则图片会 404。

---

### 方式二：GitHub Pages —— 免费、稳定、长期

适合「以后还会慢慢加图」。

前置：本机没装 git，先装 <https://git-scm.com/download/win>（一路下一步即可）。

```bash
cd /d D:\WANZHAN

git init
git add .
git commit -m "巡音流歌图片集"
git branch -M main

# 先在 GitHub 网页上新建一个空仓库（不要勾选 README），拿到它的地址
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

然后：仓库页面 → **Settings → Pages** → Source 选 `Deploy from a branch` → 分支选 `main`、目录选 `/ (root)` → Save。

等 1~2 分钟，网址是：

```
https://你的用户名.github.io/仓库名/
```

以后加图只要：

```bash
node tools/make-thumbs.mjs
node tools/scan-works.mjs
git add -A && git commit -m "新增图片" && git push
```

**已经准备好的文件**（不用你手动配）：
- `.nojekyll` —— 让 GitHub Pages 原样发布，不要用 Jekyll 处理
- `.gitignore` —— 已排除临时文件

---

### 方式三：Vercel / Cloudflare Pages —— 有国内访问优化

如果主要给国内的人看，Cloudflare Pages 通常比 GitHub Pages 快一些。

1. 注册 <https://dash.cloudflare.com>
2. Workers & Pages → Create → Pages → **Upload assets**
3. 把整个文件夹拖进去
4. 得到 `https://项目名.pages.dev`

项目里已经放好了 `netlify.toml` 和 `vercel.json`（缓存头配置），
用 Netlify 或 Vercel 的 Git 集成时会自动生效。

---

## 只想先给身边的人看（局域网）

不需要任何部署，同一个 WiFi 下就能打开：

```bash
node tools/serve.mjs
```

它会打印两个地址：

```
http://127.0.0.1:5173          ← 本机
http://192.168.x.x:5173        ← 同一个 WiFi 下手机/别人电脑用这个
```

手机浏览器输入第二个地址即可。关掉窗口就没了，适合临时展示。

---

## 上线前的检查清单

- [ ] **图片版权**：确认每张图你都有权公开。别人的同人作品要署名并在 `author` 填名字，
      有原帖就填 `link`（灯箱里会出现「查看原帖」按钮）
- [ ] **联系方式**：改 `index.html` 里「关于这个画廊」的版权说明，加上你的联系方式，
      方便作者找你要求下架
- [ ] **作者署名**：`data/works.js` 里 `author: ""` 的都还是空的，填上署名
- [ ] **作品名**：现在是从文件名自动生成的（`Luka 01` 这种），可以改成中文名字
- [ ] **首屏主视觉**：默认取最新的一张。想固定某张，告诉我，我给数据加一个 `featured` 标记
- [ ] **不要上传的东西**：`assets/samples/`（示例插画）、`tools/`、`data/works.example.js`
      在正式站点里没作用。想精简可以把它们删掉，页面照样跑。

## 关于访问统计

这个站**故意不带任何统计脚本**（没有 Google Analytics、没有追踪像素），
隐私上更干净，但也就看不到有多少人访问。

如果需要知道访问量，最轻的做法是 Cloudflare 自带的 Web Analytics
（在 Cloudflare 后台开启，免费，无需在页面里插脚本）。

## 目录里哪些是「网站本体」

上传时必须包含：

```
index.html
data/works.js
assets/css/style.css
assets/js/main.js
assets/works/          ← 原图
assets/thumbnails/     ← 列表缩略图
assets/hero/           ← 首屏主视觉图
```

可选（不影响运行）：

```
assets/samples/        示例插画，可删
tools/                 本地工具，线上用不到，可删
data/works.example.js  扫描示例，可删
netlify.toml / vercel.json / .nojekyll   各平台配置文件
```
