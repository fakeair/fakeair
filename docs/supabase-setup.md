# Supabase 互动后端接入指南

> **本项目的实现已经写好**：共享存储的代码在 `assets/js/store.js`（`SharedStore` 类），
> 存储开关在 `data/config.js`。你**只需要建库 + 填两个值**，前端代码不用动。
>
> 本文档第 3 节列出的原生 fetch 写法是**接口参考**（说明每个操作对应的准确请求），
> 不是让你照抄进项目 —— 项目里已经按这套协议实现好了。
> 唯一区别：项目里的全局变量是 `window.GALLERY_BACKEND`（不是 `window.LUKA_SUPABASE`），
> 字段是 `{ url, anonKey }`。

给巡音流歌画廊站（纯静态 / GitHub Pages）加**点赞、收藏、五星评分、文字短评**。
访客无账号，靠浏览器生成的 `visitor_id` 去重。

- SQL 全文：[`supabase-schema.sql`](./supabase-schema.sql) ← 直接粘到 SQL Editor 执行
- 本文档：配置步骤、前端调用、安全边界、自检清单

> **本文档的 API 细节已对照官方文档核实**（2026-09），来源在文末「参考来源」。
> 特别提示两处容易踩的过期信息：
> 1. Supabase 正在**弃用** `anon` / `service_role` 密钥，新密钥是
>    `sb_publishable_…` / `sb_secret_…`，**且不是 JWT**（不再以 `eyJ` 开头）。
> 2. Dashboard 里**已经没有 `Settings > API` 这个页面**了，密钥统一在
>    **`Settings > API Keys`**，或项目顶部 **Connect** 对话框。

---

## 目录

1. [数据模型](#1-数据模型)
2. [配置步骤（从注册到拿到密钥）](#2-配置步骤从注册到拿到密钥)
3. [前端调用（原生 fetch）](#3-前端调用原生-fetch)
4. [自检清单](#4-自检清单)
5. [安全说明：能防住什么、防不住什么](#5-安全说明能防住什么防不住什么)
6. [应急手册](#6-应急手册)
7. [免费额度与项目暂停](#7-免费额度与项目暂停)
8. [常见错误对照表](#8-常见错误对照表)
9. [参考来源](#9-参考来源)

---

## 1. 数据模型

五张表 + 两个视图，全部以 `luka_` 前缀命名。

| 对象 | 类型 | 一行代表什么 | 关键约束 |
| --- | --- | --- | --- |
| `luka_likes` | 表 | 某访客赞了某图 | `unique(work_id, visitor_id)` — 同一人同一图只有一个赞 |
| `luka_favorites` | 表 | 某访客收藏了某图 | `unique(work_id, visitor_id)` |
| `luka_ratings` | 表 | 某访客给某图的评分 | **主键 `(work_id, visitor_id)`** — 一人一图一评分，可改分；`score between 1 and 5` |
| `luka_comments` | 表 | 一条短评 | 正文 `1~200` 字、昵称 `1~24` 字（空则存 NULL）、无控制字符、`hidden` 软删除位、**频率限制触发器** |
| `luka_app_settings` | 表 | 站长配置 | 封禁名单 / 全站开关；匿名角色**完全读不到** |
| `luka_work_stats` | 视图 | 每张图的聚合数字 | `like_count` / `favorite_count` / `rating_count` / `rating_avg` / `comment_count` |
| `luka_my_state` | 视图 | 某访客的互动明细 | `liked` / `favorited` / `my_score`，**必须带 `visitor_id` 过滤** |

几个刻意的设计决定：

- **作品主键用 `text` 而不是外键。** 作品在 `data/works.js` 里（`luka-01`、`collab-02`…），
  数据库只存 `work_id` 字符串，并用 `check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$')` 挡住
  格式错误和超长值。这样加减图片不需要动数据库。
- **评分表不用代理主键。** 用自然主键 `(work_id, visitor_id)` 直接拿到「一人一图一评分」，
  而且 PostgREST 的 upsert 默认就按主键冲突处理，前端不用写 `on_conflict`。
- **短评不给匿名角色 `update` / `delete` 权限。** 否则任何人都能改别人的话、删别人的话。
  管理操作走 SQL Editor 或 secret key。
- **没有任何互动的作品不会出现在 `luka_work_stats` 里。** 前端按默认值（0 赞、0 人评分）处理即可。

---

## 2. 配置步骤（从注册到拿到密钥）

### 2.1 注册并建项目

1. 打开 <https://supabase.com> → **Start your project** → 用 GitHub 账号登录最省事
2. 进入 Dashboard → **New project**
3. 填写：
   - **Organization**：默认的即可
   - **Name**：`luka-gallery`
   - **Database Password**：点 **Generate a password** 并**存到密码管理器**。
     这个密码是给直连数据库用的，前端完全不需要它。
   - **Region**：选离你访客近的。国内访客建议 **Southeast Asia (Singapore)**
     或 **Northeast Asia (Tokyo / Seoul)**
   - **Pricing Plan**：Free
4. 点 **Create new project**，等 1~2 分钟初始化完成

### 2.2 建表

1. 左侧栏 → **SQL Editor** → **New query**
2. 打开 `docs/supabase-schema.sql`，**全部复制**，粘贴进去
3. 点 **Run**（或 `Ctrl+Enter`）
4. 期望结果：`Success. No rows returned`，没有红色报错

> 如果报「已存在」，说明你之前跑过一次。要彻底重来请先跑 SQL 文件末尾的「清理」段。

### 2.3 拿到 Project URL 和密钥

**推荐路径（新界面）：**

1. 项目页面顶部点 **Connect** 按钮（或直接打开 `https://supabase.com/dashboard/project/_?showConnect=true`）
2. 对话框里会显示 **Project URL** 和 **Publishable key**，可直接复制

**完整路径（能看到所有密钥）：**

1. 左侧栏底部 → **Project Settings**（齿轮图标）
2. → **API Keys**

你会看到两组密钥，**任选一组**：

| 密钥类型 | 长相 | 角色 | 用哪个 |
| --- | --- | --- | --- |
| **Publishable key**（新） | `sb_publishable_xxxxxxxx` | `anon` | ✅ **推荐**，短字符串 |
| `anon` public（旧，将弃用） | `eyJhbGciOi...`（很长的 JWT） | `anon` | 也能用，2026 年底前弃用 |
| **Secret key**（新） | `sb_secret_xxxxxxxx` | `service_role` | ❌ **绝对不要放进前端** |
| `service_role`（旧） | `eyJhbGciOi...` | `service_role` | ❌ 同上，绕过一切 RLS |

**Project URL** 形如 `https://abcdefghijklmn.supabase.co`（在 **Settings > API** 或 Connect 对话框里）。
REST 端点就是它加 `/rest/v1/`。

### 2.4 存进前端

本项目**已经内置**了共享存储的开关，就在 **`data/config.js`** 里（这个文件已经建好，默认是空的）：

```js
window.GALLERY_BACKEND = {
  url: '',       // ← 填 Project URL，例如 https://abcdefghijklmn.supabase.co
  anonKey: '',   // ← 填 Publishable key（sb_publishable_...）
};
```

填好保存、刷新页面，页面会自动从「本机存储」切到「共享存储」（顶部的青色提示会消失）。
**代码一行都不用改。**

> 变量名叫 `anonKey` 是沿用习惯叫法，实际填**新的 publishable key** 最好
> （旧的 `anon` JWT 也能用，但 2026 年底弃用）。
>
> 这两个值会被公开在浏览器里，这是设计如此 —— 安全性靠数据库的 RLS + 约束。
> **绝对不要**把 `sb_secret_...` / `service_role` 填进这里，那等于把管理员钥匙交给所有人。
>
> 本项目是公开仓库，这两个值会进 Git 历史 —— **这没问题**，
> publishable 密钥本来就是给前端用的，公开是预期行为。
>
> 想让页面在检查前先自己确认「本机存储还是共享存储」：看顶部有没有那条青色提示，
> 有就是本机存储（没配置或配置没生效）。

### 2.5（可选）开启前置钩子

只有当你需要「封禁名单 / 全站开关」时才做。在 SQL Editor 执行：

```sql
alter role authenticator set pgrst.db_pre_request = 'public.luka_pre_request';
notify pgrst, 'reload config';
```

关闭：

```sql
alter role authenticator reset pgrst.db_pre_request;
notify pgrst, 'reload config';
```

---

## 3. 前端调用（原生 fetch）

### 3.0 公共部分

```js
const SB = window.LUKA_SUPABASE;
const BASE = SB.url + '/rest/v1';

/** 每个访客一个稳定 ID。crypto.randomUUID 需要安全上下文（HTTPS / localhost），
 *  所以保留一个降级实现，避免 http 访问时直接崩掉。 */
function getVisitorId() {
  const KEY = 'luka.visitor_id';
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* 隐私模式 */ }

  if (!id) {
    if (crypto && typeof crypto.randomUUID === 'function') {
      id = crypto.randomUUID();
    } else {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
      });
    }
    try { localStorage.setItem(KEY, id); } catch { /* 存不下就每次新 ID */ }
  }
  return id;
}

const VISITOR_ID = getVisitorId();

/** 统一请求封装：带上两个必需的头，并给出可读的错误。 */
async function sb(path, { method = 'GET', body, prefer, extraHeaders } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      apikey: SB.key,
      Authorization: 'Bearer ' + SB.key,
      'Content-Type': 'application/json',
      'X-Visitor-Id': VISITOR_ID,          // 给前置钩子（封禁检查）用，可选
      ...(prefer ? { Prefer: prefer } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;      // 无内容（例如删除成功）

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error((data && data.message) || res.statusText);
    err.status = res.status;
    err.code = data && data.code;           // Postgres / PostgREST 错误码
    err.details = data && data.details;
    err.hint = data && data.hint;
    throw err;
  }
  return data;
}

const q = (s) => encodeURIComponent(s);
```

**关于 `Prefer` 头的说明**：PostgREST 用它控制返回内容和冲突处理。

| 值 | 作用 |
| --- | --- |
| `return=representation` | 写入后把受影响的行返回（否则默认 201 无 body） |
| `return=minimal` | 只要状态码，不要 body |
| `resolution=merge-duplicates` | upsert：冲突时**更新**已有行 |
| `resolution=ignore-duplicates` | upsert：冲突时**忽略** |
| `count=exact` | 让响应头 `Content-Range` 带精确总数（HEAD 请求也可以用） |

多个值用逗号连接，例如 `Prefer: return=representation, resolution=merge-duplicates`。

---

### 3.1 读取所有作品的统计（一次请求）

```js
// GET /rest/v1/luka_work_stats?select=*
const stats = await sb('/luka_work_stats?select=*');
// → [{ work_id:'luka-01', like_count:3, favorite_count:1, rating_count:2,
//      rating_avg:4.50, comment_count:0 }, ...]

// 建议：转成 map 方便查
const statMap = Object.fromEntries(stats.map((s) => [s.work_id, s]));

// 拿某张图的数字（注意视图里不存在的图 = 还没人互动）
function statsOf(workId) {
  return statMap[workId] || {
    work_id: workId, like_count: 0, favorite_count: 0,
    rating_count: 0, rating_avg: null, comment_count: 0,
  };
}
```

只查指定的几张图（减少流量）：

```js
// GET /rest/v1/luka_work_stats?select=*&work_id=in.(luka-01,luka-02)
const ids = ['luka-01', 'luka-02'].join(',');
const some = await sb(`/luka_work_stats?select=*&work_id=in.(${ids})`);
```

> `rating_avg` 在没人评分时是 `null`，前端要判空（别直接 `toFixed`）。

---

### 3.2 读取「我」的互动状态

```js
// GET /rest/v1/luka_my_state?select=*&visitor_id=eq.<uuid>
const mine = await sb(`/luka_my_state?select=*&visitor_id=eq.${q(VISITOR_ID)}`);

const myMap = Object.fromEntries(mine.map((m) => [m.work_id, m]));
// myMap['luka-01'] → { work_id, liked: true, favorited: false, my_score: 5 }

// 「我的收藏」列表（用于筛选）
const favIds = mine.filter((m) => m.favorited).map((m) => m.work_id);
```

> ⚠️ **必须带 `visitor_id=eq.…`**。视图本身不按访客过滤，不加过滤会拿到所有人的行。

---

### 3.3 点赞 / 取消赞

```js
// 点赞：POST /rest/v1/luka_likes
await sb('/luka_likes', {
  method: 'POST',
  prefer: 'return=minimal',
  body: { work_id: 'luka-01', visitor_id: VISITOR_ID },
});

// 已经赞过会返回 409（唯一约束冲突）—— 视为「已赞」，不要报错给用户
try {
  await sb('/luka_likes', { method: 'POST', prefer: 'return=minimal',
    body: { work_id: 'luka-01', visitor_id: VISITOR_ID } });
} catch (e) {
  if (e.status !== 409) throw e;   // 409 = 已经赞过了
}

// 取消赞：DELETE /rest/v1/luka_likes?work_id=eq.luka-01&visitor_id=eq.<uuid>
await sb(`/luka_likes?work_id=eq.${q('luka-01')}&visitor_id=eq.${q(VISITOR_ID)}`, {
  method: 'DELETE',
  prefer: 'return=minimal',
});
```

**更省事的替代方案**：用 upsert 的 `ignore-duplicates` 让点赞幂等 ——

```js
// 重复点赞不报错，直接 201/200，前端不用 try/catch
await sb('/luka_likes', {
  method: 'POST',
  prefer: 'return=minimal, resolution=ignore-duplicates',
  body: { work_id: 'luka-01', visitor_id: VISITOR_ID },
});
```

> 注意：`on_conflict` 只在冲突列**不是主键**时才需要写。
> `luka_likes` 的冲突列是 `unique(work_id, visitor_id)`（不是主键），
> 所以严格来说要加 `?on_conflict=work_id,visitor_id`：
> ```js
> await sb('/luka_likes?on_conflict=work_id,visitor_id', { ... });
> ```
> 但只用 `resolution=ignore-duplicates` 时，PostgREST 会退回按主键冲突处理，
> 而 `luka_likes` 主键是 `id`（自增），永远不冲突 → 结果仍然插入成功。
> **为了语义明确，建议统一带上 `?on_conflict=work_id,visitor_id`。**

---

### 3.4 收藏 / 取消收藏

和点赞完全同构，换表名即可：

```js
// 收藏
await sb('/luka_favorites?on_conflict=work_id,visitor_id', {
  method: 'POST',
  prefer: 'return=minimal, resolution=ignore-duplicates',
  body: { work_id: 'luka-01', visitor_id: VISITOR_ID },
});

// 取消收藏
await sb(`/luka_favorites?work_id=eq.${q('luka-01')}&visitor_id=eq.${q(VISITOR_ID)}`, {
  method: 'DELETE',
  prefer: 'return=minimal',
});
```

---

### 3.5 提交 / 修改评分

评分表主键就是 `(work_id, visitor_id)`，所以 **upsert 不需要 `on_conflict`** ——
PostgREST 默认按主键判断冲突。

```js
// POST /rest/v1/luka_ratings
// Prefer: resolution=merge-duplicates  → 已存在就改分
await sb('/luka_ratings', {
  method: 'POST',
  prefer: 'return=representation, resolution=merge-duplicates',
  body: { work_id: 'luka-01', visitor_id: VISITOR_ID, score: 5 },
});
// → [{ work_id:'luka-01', visitor_id:'...', score:5, created_at:'...', updated_at:'...' }]
```

撤销评分（如果 UI 需要）：

```js
await sb(`/luka_ratings?work_id=eq.${q('luka-01')}&visitor_id=eq.${q(VISITOR_ID)}`, {
  method: 'DELETE',
  prefer: 'return=minimal',
});
```

`score` 不在 1~5 会返回 **400**，错误里带 `luka_ratings_score_range`：

```js
try {
  await sb('/luka_ratings', { method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: { work_id: 'luka-01', visitor_id: VISITOR_ID, score: 9 } });
} catch (e) {
  // e.status === 400, e.code === '23514'（check_violation）
  // e.message 里会提到 luka_ratings_score_range
}
```

---

### 3.6 提交短评

```js
// POST /rest/v1/luka_comments
const [created] = await sb('/luka_comments', {
  method: 'POST',
  prefer: 'return=representation',
  body: {
    work_id: 'luka-01',
    visitor_id: VISITOR_ID,
    nickname: '路过的听众',     // 可省略或传 null / ''（空会被规整成 NULL）
    body: '这张的光影太漂亮了',
  },
});
```

可能收到的错误：

| 情况 | HTTP | code | 处理建议 |
| --- | --- | --- | --- |
| 正文空 / 超 200 字 | 400 | `23514` | 前端先做字数校验，提示「1~200 字」 |
| 昵称超 24 字 | 400 | `23514` | 提示「昵称最多 24 字」 |
| 10 分钟内发了 10 条 | 400 | `P0001` | 提示 `e.message`（触发器给的中文提示） |
| 短评区全局 500 条/小时已满 | 400 | `P0001` | 提示稍后再试 |

```js
try {
  const [created] = await sb('/luka_comments', { method: 'POST',
    prefer: 'return=representation',
    body: { work_id, visitor_id: VISITOR_ID, nickname, body: text } });
  // 成功：把 created 插到列表最前面即可，不用重新拉全量
} catch (e) {
  if (e.code === 'P0001') toast(e.message);                 // 频率 / 容量
  else if (e.code === '23514') toast('内容长度不符合要求');   // 约束
  else toast('提交失败，请稍后再试');
}
```

---

### 3.7 读取某张图的短评列表

```js
// GET /rest/v1/luka_comments
//   ?work_id=eq.luka-01
//   &hidden=eq.false          ← 其实可以省，RLS 已经过滤掉 hidden=true
//   &select=id,nickname,body,created_at
//   &order=created_at.desc
//   &limit=50
const comments = await sb(
  '/luka_comments?work_id=eq.' + q('luka-01') +
  '&select=id,nickname,body,created_at&order=created_at.desc&limit=50'
);
// → [{ id:12, nickname:'路过的听众', body:'...', created_at:'2026-09-21T…Z' }, ...]
```

分页（「加载更多」）：

```js
// 第二页：用 offset
const page2 = await sb(
  '/luka_comments?work_id=eq.' + q('luka-01') +
  '&select=id,nickname,body,created_at&order=created_at.desc&limit=50&offset=50'
);
```

只要总数（不取数据，省流量）：

```js
// HEAD 请求 + Prefer: count=exact，总数在 Content-Range 响应头里
const res = await fetch(
  BASE + '/luka_comments?work_id=eq.' + q('luka-01') + '&select=id',
  { method: 'HEAD', headers: {
      apikey: SB.key, Authorization: 'Bearer ' + SB.key,
      Prefer: 'count=exact' } }
);
const range = res.headers.get('Content-Range');   // 例如 "0-49/137"
const total = range ? Number(range.split('/')[1]) : null;
```

> 也可以用 `GET` + `Prefer: count=exact`，但那样会传回数据；只要总数就用 `HEAD`。

---

## 4. 自检清单

建完库后**逐条**验证。把 `$URL` 和 `$KEY` 换成你的值。

### 4.0 准备环境变量

**PowerShell：**

```powershell
$URL = "https://你的项目ID.supabase.co"
$KEY = "sb_publishable_你的密钥"
$H = @{ apikey = $KEY; Authorization = "Bearer $KEY"; "Content-Type" = "application/json" }
$V = [guid]::NewGuid().ToString()     # 模拟一个访客 ID
```

**bash / Git Bash：**

```bash
URL="https://你的项目ID.supabase.co"
KEY="sb_publishable_你的密钥"
V=$(uuidgen 2>/dev/null || python -c "import uuid;print(uuid.uuid4())")
```

### 4.1 读权限（匿名可读）

```powershell
Invoke-RestMethod "$URL/rest/v1/luka_work_stats?select=*" -Headers $H
```

- ✅ 期望：返回 `[]`（还没人互动），**不报错**
- ❌ 报 `401` / `42501` → grant 没给上，回看 SQL 第 9.2 节

### 4.2 写入点赞（匿名可写）

```powershell
$body = @{ work_id = "luka-01"; visitor_id = $V } | ConvertTo-Json
Invoke-RestMethod "$URL/rest/v1/luka_likes" -Method Post -Headers $H -Body $body
```

- ✅ 期望：`201 Created`，无 body（没加 `Prefer: return=representation` 时）
- ❌ 报 `401` → RLS 的 insert 策略没建，或 grant 没给

### 4.3 唯一约束生效（重复点赞必须失败）

再执行一次 4.2，**必须报错**：

```
409 Conflict
"code": "23505"
"message": "duplicate key value violates unique constraint \"luka_likes_unique_per_visitor\""
```

- ✅ 期望就是失败。**如果第二次也成功，说明唯一约束没生效** → 回看 SQL 第 2 节
- 前端就靠这个 409 判断「已赞」，所以这条一定要对

### 4.4 读取刚写的赞

```powershell
$r = Invoke-RestMethod "$URL/rest/v1/luka_likes?select=work_id,visitor_id&visitor_id=eq.$V" -Headers $H
$r.Count    # 应该是 1
```

### 4.5 评分范围约束（关键！）

```powershell
# 合法：4 分
Invoke-RestMethod "$URL/rest/v1/luka_ratings" -Method Post -Headers $H `
  -Body (@{ work_id="luka-01"; visitor_id=$V; score=4 } | ConvertTo-Json)

# 非法：9 分 —— 必须 400
try {
  Invoke-RestMethod "$URL/rest/v1/luka_ratings" -Method Post -Headers $H `
    -Body (@{ work_id="luka-01"; visitor_id=$V; score=9 } | ConvertTo-Json)
  Write-Host "❌ 约束没生效！9 分被接受了" -ForegroundColor Red
} catch {
  Write-Host "✅ 约束生效：" ($_.ErrorDetails.Message)
}
```

- ✅ 期望：`400`，`code: 23514`，message 含 `luka_ratings_score_range`

### 4.6 一人一图一评分 + 改分（upsert）

```powershell
# 改成 5 分，用 merge-duplicates → 应该是更新，不是插入新行
Invoke-RestMethod "$URL/rest/v1/luka_ratings" -Method Post `
  -Headers ($H + @{ Prefer = "resolution=merge-duplicates" }) `
  -Body (@{ work_id="luka-01"; visitor_id=$V; score=5 } | ConvertTo-Json)

# 检查：应该只有 1 行，且 score = 5
$r = Invoke-RestMethod "$URL/rest/v1/luka_ratings?select=score&visitor_id=eq.$V" -Headers $H
Write-Host "行数=$($r.Count) 分数=$($r[0].score)"   # 期望 行数=1 分数=5
```

- ❌ 如果行数是 2 → 主键约束没建成

### 4.7 聚合视图正确

```powershell
Invoke-RestMethod "$URL/rest/v1/luka_work_stats?select=*&work_id=eq.luka-01" -Headers $H |
  Format-List
```

- ✅ 期望：`like_count=1, rating_count=1, rating_avg=5.00, favorite_count=0, comment_count=0`

### 4.8 短评长度约束

```powershell
# 超长正文（250 字）—— 必须 400
$long = "啊" * 250
try {
  Invoke-RestMethod "$URL/rest/v1/luka_comments" -Method Post -Headers $H `
    -Body (@{ work_id="luka-01"; visitor_id=$V; body=$long } | ConvertTo-Json)
  Write-Host "❌ 长度约束没生效" -ForegroundColor Red
} catch {
  Write-Host "✅ 长度约束生效：" ($_.ErrorDetails.Message)
}
```

### 4.9 短评正常提交 + 读取

```powershell
Invoke-RestMethod "$URL/rest/v1/luka_comments" -Method Post `
  -Headers ($H + @{ Prefer = "return=representation" }) `
  -Body (@{ work_id="luka-01"; visitor_id=$V; nickname="测试"; body="自检用的短评" } | ConvertTo-Json) |
  Format-List

Invoke-RestMethod "$URL/rest/v1/luka_comments?work_id=eq.luka-01&select=nickname,body&order=created_at.desc" -Headers $H
```

### 4.10 频率限制生效

连续发 11 条短评，**第 11 条必须被拒**：

```powershell
1..11 | ForEach-Object {
  try {
    Invoke-RestMethod "$URL/rest/v1/luka_comments" -Method Post -Headers $H `
      -Body (@{ work_id="luka-01"; visitor_id=$V; body="刷屏测试 $_" } | ConvertTo-Json) | Out-Null
    Write-Host "第 $_ 条：通过"
  } catch {
    Write-Host "第 $_ 条：被拒 ✅" -ForegroundColor Yellow
    Write-Host ($_.ErrorDetails.Message)
  }
}
```

- ✅ 期望：前 10 条通过，第 11 条 `400` + `code: P0001` + message「短评太频繁了…」

### 4.11 设置表对匿名不可读（重要安全项）

```powershell
Invoke-RestMethod "$URL/rest/v1/luka_app_settings?select=*" -Headers $H
```

- ✅ 期望：**空数组 `[]`** 或 `401` / `42501`
- ❌ **如果返回了封禁名单，说明权限配错了** → 检查 SQL 第 9.1/9.2 节是否执行

### 4.12 短评不可改、不可删（重要安全项）

```powershell
# 尝试改别人的评论 —— 必须失败
try {
  Invoke-RestMethod "$URL/rest/v1/luka_comments?id=eq.1" -Method Patch -Headers $H `
    -Body (@{ body = "我改了" } | ConvertTo-Json)
  Write-Host "❌ 严重问题：匿名角色能改短评！" -ForegroundColor Red
} catch { Write-Host "✅ 改不了：$($_.Exception.Response.StatusCode)" }

# 尝试删除 —— 必须失败
try {
  Invoke-RestMethod "$URL/rest/v1/luka_comments?id=eq.1" -Method Delete -Headers $H
  Write-Host "❌ 严重问题：匿名角色能删短评！" -ForegroundColor Red
} catch { Write-Host "✅ 删不了：$($_.Exception.Response.StatusCode)" }
```

- ✅ 期望：两次都失败（`401` / `403` / 或返回空但由于没有 delete grant 会报权限错）

### 4.13 清理自检数据

自检会留下测试数据。在 **SQL Editor** 里执行（把 uuid 换成你的 `$V`）：

```sql
delete from public.luka_likes     where visitor_id = '你的-测试-uuid';
delete from public.luka_favorites where visitor_id = '你的-测试-uuid';
delete from public.luka_ratings   where visitor_id = '你的-测试-uuid';
delete from public.luka_comments  where visitor_id = '你的-测试-uuid';
```

### 4.14 核对 RLS 是否真的开着（一劳永逸的检查）

在 SQL Editor 执行：

```sql
select c.relname as 表名,
       c.relrowsecurity as rls已开启,
       count(p.policyname) as 策略数
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p on p.tablename = c.relname and p.schemaname = n.nspname
 where n.nspname = 'public' and c.relname like 'luka\_%'
 group by 1, 2
 order by 1;
```

- ✅ 期望：`luka_likes` / `luka_favorites` / `luka_ratings` / `luka_comments` / `luka_app_settings`
  的 `rls已开启` 全是 `true`，且前四张策略数 ≥ 2（点赞/收藏 3 条，评分 4 条，短评 2 条）
- ❌ 任何一张 `rls已开启 = false` → 立刻执行 `alter table ... enable row level security;`

---

## 5. 安全说明：能防住什么、防不住什么

**这一节请务必读完。** anon 密钥公开在浏览器里，任何人都能打开 DevTools 复制它，
然后用 curl / Postman 直接对着你的数据库发请求。下面诚实列出边界。

### 5.1 ✅ 能防住的（数据库层面的硬约束，绕不过去）

| 威胁 | 靠什么防住 |
| --- | --- |
| 同一个人重复点赞刷赞数 | `unique(work_id, visitor_id)` — 直接 409 |
| 一个人给多张图刷大量赞 | 前端限制「一图一赞」，加上下面 5.3 的缓解手段 |
| 评分超出 1~5（比如提交 999 分把均分拉爆） | `check (score between 1 and 5)` |
| 超长垃圾短评塞爆数据库 | `check (char_length(btrim(body)) between 1 and 200)` |
| 控制字符 / 畸形文本 | `[[:cntrl:]]` 约束 |
| 一个人改/删别人的短评 | 匿名角色**没有** `update` / `delete` grant |
| 匿名角色读取站长配置（封禁名单） | `luka_app_settings` 零策略 + 零 grant |
| 直接 `SELECT` 绕过策略 | RLS 已开启，策略显式声明 |
| 单个脚本无限连发短评 | 频率限制触发器（同一访客 10 分钟 10 条 / 全局 1 小时 500 条） |
| 伪造 `work_id` 往不存在的图写数据 | `check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$')` 至少挡住畸形值和超长值 |
| 已知刷子继续写 | 前置钩子 + 封禁名单（需手动启用，见 2.5） |

### 5.2 ❌ 防不住的（架构决定的，不要自欺）

| 威胁 | 为什么防不住 | 严重程度 |
| --- | --- | --- |
| **脚本批量伪造 visitor_id** | 清 localStorage / 直接调 API 生成新 UUID，每次都是「新访客」。`unique` 约束形同虚设。 | 🔴 高 |
| **批量刷点赞 / 收藏** | 每次用新 UUID，可以无限刷。表会变大、数字会失真。 | 🔴 高 |
| **批量刷评分** | 同上，一人 5 分刷 100 次就把均分拉到 5.0。 | 🔴 高 |
| **伪造任意 `work_id`** | 格式合法就能写。可以给不存在的图刷数据，或给未来才存在的图预刷。 | 🟡 中 |
| **IP 层封禁** | 前端方案拿不到可靠 IP（PostgREST 的前置钩子能读 `X-Forwarded-For`，但普通 RLS 策略里拿不到）。 | 🟡 中 |
| **短评内容本身是垃圾/广告/辱骂** | 内容质量判断需要人（或 AI），数据库做不到。 | 🟡 中 |
| **`visitor_id` 被替换成别人的** | 无账号，无法验证归属。理论上能删掉别人的赞（`delete` 策略是 `using(true)`）。 | 🟡 中 |
| **读取到所有人的 visitor_id** | 表对所有匿名可读，所以能列出「谁赞了什么」。虽然只是随机 UUID，但可用于追踪。 | 🟢 低 |
| **误删全部数据** | 有 `delete using(true)` 策略的人（任何人）可以 `DELETE /luka_likes?id=gt.0` 清空点赞表。 | 🟡 中 |
| **DoS / 流量耗尽** | 大量请求会吃掉 5GB egress 额度，或让免费项目超限。 | 🟡 中 |

> **最后一条特别提醒**：`luka_likes` / `luka_favorites` / `luka_ratings` 的删除策略是
> `using (true)`，意味着**任何拿到 anon 密钥的人都能清空这三张表**（或者至少能删除任意行）。
> 这是「无账号 + 只能删自己的行」这一需求不可兼得的结果 —— 因为数据库无法验证你是谁。
> 如果你觉得这个风险不可接受，见 5.4 的 Edge Function 方案。

### 5.3 务实缓解手段（按性价比排序）

对小站来说，下面这些**足够挡掉 99% 的随手破坏**，但请记住：**它们都是缓解，不是根治**。
真正在意的数据必须靠 5.4 的方案。

#### ① 前端限速（最便宜，只挡得住顺手点几下）

```js
const last = Number(localStorage.getItem('luka.lastLike') || 0);
if (Date.now() - last < 1500) return;         // 1.5 秒内只允许一次
localStorage.setItem('luka.lastLike', Date.now());
```

- ✅ 挡住：手抖连点、简单的循环脚本（如果它不绕过前端）
- ❌ 挡不住：任何人直接 curl。**只是缓解。**

#### ② 前端校验输入（改善体验 + 减轻后端错误）

```js
const body = text.trim();
if (body.length < 1 || body.length > 200) return toast('短评请控制在 1~200 字');
if (nickname && nickname.trim().length > 24) return toast('昵称最多 24 字');
```

- ✅ 挡住：99% 的误操作，用户看到友好提示而不是 400
- ❌ 挡不住：直接调 API 的人（但数据库约束会兜住）

#### ③ 短评频率限制（已内置在 SQL 里）

同一访客 10 分钟 10 条、全局 1 小时 500 条。

- ✅ 挡住：单个 UUID 连发刷屏；全局上限能防止短时间被灌爆
- ❌ 挡不住：伪造 UUID + 分布式慢速刷（每次低于阈值）

#### ④ 每日巡检（5 分钟，性价比很高）

在 SQL Editor 存几条查询，每周跑一次：

```sql
-- 异常访客（一个 UUID 赞了超过 20 张图，正常访客不可能）
select visitor_id, count(*) as likes from public.luka_likes
 group by visitor_id having count(*) > 20 order by likes desc;

-- 异常时间段（某小时短评暴增）
select date_trunc('hour', created_at) as h, count(*) from public.luka_comments
 group by 1 having count(*) > 30 order by 1 desc;

-- 最近短评抽检
select created_at, nickname, body from public.luka_comments
 where hidden = false order by created_at desc limit 30;
```

发现异常就执行 SQL 文件第 11 节的「清理 / 封禁」语句。

#### ⑤ 站长开关（一键止血）

心跳线：被刷得受不了时，一条 SQL 关掉所有互动，前端统一提示「暂时关闭」：

```sql
update public.luka_app_settings set value = '{"enabled": false}'::jsonb
 where key = 'interactions_enabled';
```

（需要先启用 2.5 的前置钩子。）

#### ⑥ 软删除代替硬删除（保留证据 + 可恢复）

短评用 `hidden = true` 而不是 `delete`，万一误伤还能恢复。

- ✅ 好处：可回复、可审计、防误操作
- ❌ 对刷数据无效（还是要真删）

#### ⑦ 换 anon 密钥（被刷后的止血动作）

在 **Settings > API Keys** 里禁用旧密钥、创建新密钥，更新前端配置并重新部署。

- ⚠️ **影响**：所有访客的 localStorage 里存的是旧数据关系（不是密钥），所以点赞/收藏**不会丢**；
  但旧密钥的**任何缓存副本会失效** —— 这正是你要的效果。
- ⚠️ **代价**：GitHub Pages 重新部署需要 1~2 分钟；如果有别的服务用了同一密钥也要一起换。
- 注意：禁用旧密钥后，任何还在用旧密钥的页面标签页会立刻 401，直到访客刷新。

### 5.4 想要根治？只有两条路

#### 路线 A：Edge Function 中转（推荐，仍是免费额度内）

把写操作从「直连数据库」改成「调用 Edge Function」，在函数里做：

1. **Turnstile / hCaptcha 验证**（需要前端集成，能挡住脚本）
2. **IP 限流**（`request.headers.get('x-forwarded-for')` + 数据库计数表）
3. **服务端校验**（长度、频率、脏词）
4. 用 **secret key** 写库（绕过 RLS，但只有你的函数有这个能力）

架构变化：

```
前端 ──→ Edge Function（校验 + Turnstile）──→ Postgres（secret key）
```

- ✅ 能挡住：脚本刷数据（Turnstile 是主要防线）、IP 级限流、服务端内容校验
- ❌ 挡不住：真人手动刷（但成本高很多）；Turnstile 也不是 100% 不可破
- 💰 免费额度：50 万次调用/月，小站完全够用

#### 路线 B：换成账号体系（Supabase Auth 匿名登录）

用 Supabase Auth 的**匿名登录**代替自制 `visitor_id`：

- 每个访客拿到一个真实 JWT，`auth.uid()` 由服务端保证，**无法伪造**
- RLS 策略从 `using(true)` 升级成 `using (auth.uid() = user_id)`
- 删除策略变成「只能删自己的」，杜绝 5.2 里的「能删别人的赞」
- ✅ 能挡住：伪造身份、替别人操作、删别人的数据
- ❌ 挡不住：一个人可以登出再注册新的匿名账号（但成本更高，且能配合 IP 限流）
- ⚠️ 代价：前端要引入 Supabase Auth（**但仍然可以用 fetch 调 REST**，
  匿名登录端点就是 `POST /auth/v1/signup` 之类的 REST 接口，不必引 supabase-js）

> 对你现在这个个人画廊的体量，**建议先用当前方案上线**（成本最低、能跑起来），
> 观察是否真的有人刷。真被刷了再上 Edge Function，那时也有真实数据支撑该防什么。

### 5.5 一张表总结

| 层 | 作用 | 强度 |
| --- | --- | --- |
| RLS 策略 | 控制哪些「行」可读写 | 硬保证（数据库级） |
| GRANT | 控制角色能不能碰表 | 硬保证（数据库级） |
| CHECK / UNIQUE / 触发器 | 保证数据合理 | 硬保证（数据库级） |
| 频率限制触发器 | 挡连发 | 硬保证，但阈值可被绕过 |
| 前端限速 / 校验 | 挡误操作、改善体验 | 软（可绕过） |
| 前置钩子 + 封禁名单 | 挡已知刷子 | 半硬（需手动维护） |
| Edge Function + Turnstile | 挡脚本 | 接近根治 |
| Supabase Auth | 挡伪造身份 | 根治（身份维度） |

---

## 6. 应急手册

### 被刷了，依次做这几件事

```sql
-- 1) 先看清楚是谁在刷
select visitor_id, count(*) as cnt, min(created_at), max(created_at)
  from public.luka_comments
 group by visitor_id order by cnt desc limit 20;

-- 2) 止血：关掉互动（需要前置钩子）
update public.luka_app_settings set value = '{"enabled": false}'::jsonb
 where key = 'interactions_enabled';

-- 3) 清掉刷子的数据
delete from public.luka_comments  where visitor_id = '刷子的-uuid';
delete from public.luka_likes     where visitor_id = '刷子的-uuid';
delete from public.luka_favorites where visitor_id = '刷子的-uuid';
delete from public.luka_ratings   where visitor_id = '刷子的-uuid';

-- 4) 封禁，然后重新打开互动
update public.luka_app_settings
   set value = jsonb_set(value, '{ids}', (value -> 'ids') || to_jsonb('刷子的-uuid'::text))
 where key = 'banned_visitors';

update public.luka_app_settings set value = '{"enabled": true}'::jsonb
 where key = 'interactions_enabled';
```

### 从根上回滚

```sql
-- 只想清空所有人的互动数据（保留表结构）
truncate public.luka_likes, public.luka_favorites, public.luka_ratings, public.luka_comments;

-- 想彻底不要这个后端了：执行 SQL 文件末尾的「清理」段，
-- 然后把前端里所有 sb(...) 调用删掉 / 用一个开关关掉。
```

### 前端加一个「降级开关」

**强烈建议**：让互动功能可以被一行代码关掉，这样后端挂了 / 被刷了，
网站主体（看图）不受影响。

```js
// assets/js/supabase-config.js
window.LUKA_SUPABASE = {
  url: '...',
  key: '...',
  enabled: true,        // ← 改成 false 就完全禁用互动，前端只展示静态画廊
};
```

```js
// 使用处
const interactionsOn = () => window.LUKA_SUPABASE && window.LUKA_SUPABASE.enabled;
if (!interactionsOn()) return;   // 静默跳过所有互动逻辑
```

这样即使 Supabase 项目被暂停、密钥被换、被刷爆，**你的画廊网站本身永远能看**。

---

## 7. 免费额度与项目暂停

### 7.1 Free 计划的额度

| 项目 | Free 额度 |
| --- | --- |
| API 请求 | **无限**（官方明确写 unlimited API requests） |
| 数据库大小 | 500 MB |
| 出网流量（egress） | 5 GB / 月 |
| 缓存出网 | 5 GB |
| 文件存储 | 1 GB（我们用不到，图片在 GitHub Pages） |
| 月活用户（MAU） | 50,000（我们用不到，访客无账号） |
| 活跃项目数 | 2 个 |
| Edge Functions | 500,000 次调用 / 月 |
| 日志保留 | 1 天 |
| 自动备份 | **不含** |

**对你这个量的实际意义**：一条短评约 200 字节，500MB 能存 250 万条；
一次互动请求的响应只有几百字节，5GB egress 够 1000 万次以上。
**额度完全不是瓶颈，暂停才是。**

### 7.2 项目暂停（这是最需要注意的一点）

**规则（官方原文核实）：**

- Free 计划项目如果**一周内用户数据库活动过低**，会被自动暂停（pause）
- 判定标准是**用户数据库请求量**，不是「你有没有登录后台」
- 官方原话：**「通常一周内每天有几个用户请求就足以避免被暂停」**
- 暂停**前一周**会发警告邮件给项目 owner；暂停后再发一封确认邮件
- 收到警告邮件后，**只要访问一次 Dashboard 或发几个 API 请求就能避免暂停**
- 付费计划（Pro 及以上）**永不因不活跃被暂停**

**暂停的影响：**

| 方面 | 影响 |
| --- | --- |
| 网站 | 所有 Supabase API 调用失败 → **互动功能不可用**（点赞/评分/短评全挂） |
| 图片浏览 | **不受影响**（图片在 GitHub Pages，不依赖 Supabase） |
| 数据 | **不会丢**。暂停只是停算力，数据保留 |
| 恢复 | 暂停后 **1 年内**都能恢复。Dashboard → 选组织 → 选项目 → **Resume project** |
| 恢复后 | 项目和暂停前完全一致（含数据与配置） |

> **重要结论：暂停不会丢数据，只会让互动功能暂时不可用。**
> 恢复窗口是 1 年，`Resume project` 一键搞定。
> 这也是为什么 6.3 的「降级开关」值得做 —— 暂停期间网站主体照常能看。

**怎么避免被暂停（三选一）：**

1. **让它有真实流量**：只要有人来点赞/评分，就有数据库活动。个人画廊如果每月有几个访客，通常足够。
2. **定期手动访问**：每周打开一次 Dashboard 项目页（几秒钟），或每周点一次网站。
3. **加个定时心跳**（免费方案）：用 GitHub Actions 定时（比如每天一次）对你的 REST 端点发一个轻量请求：

```yaml
# .github/workflows/supabase-keepalive.yml
name: supabase-keepalive
on:
  schedule:
    - cron: '17 3 * * *'      # 每天 UTC 03:17
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Supabase REST
        run: |
          curl -sS -o /dev/null -w "%{http_code}\n" \
            "${{ secrets.SUPABASE_URL }}/rest/v1/luka_work_stats?select=work_id&limit=1" \
            -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}"
```

把 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 存到仓库的 **Settings → Secrets and variables → Actions**。

> ⚠️ 诚实提示：官方说的是「**用户**数据库活动」，定时任务的请求**算不算**官方没有明确承诺。
> 它通常有效，但**别把它当成 100% 保证** —— 最保险的还是偶尔真人访问，或者哪天升级 Pro。

4. **升级 Pro**（$25/月起）：永不暂停，含 7 天自动备份。个人站没必要。

---

## 8. 常见错误对照表

| HTTP | code | 含义 | 怎么修 |
| --- | --- | --- | --- |
| 401 | `42501` | 权限不足（**grant** 没给） | 检查 SQL 第 9.2 节的 `grant` 是否执行。注意：报错发生在策略之前 |
| 401 | `PGRST301` | JWT 无效 | 检查 `Authorization` 头格式（`Bearer ` + 密钥，注意空格） |
| 403 | `42501` | 权限不足（已认证用户） | 同上 |
| 404 | `PGRST205` | 表不存在 | 表名拼写 / SQL 没跑完 / **schema cache 未刷新**（见下） |
| 404 | `PGRST202` | 函数不存在 | 同上；或 RPC 签名不匹配 |
| 400 | `23514` | CHECK 约束失败（评分超范围 / 正文超长） | 前端先校验；看 message 里的约束名 |
| 409 | `23505` | 唯一约束冲突（重复点赞） | **这是预期行为**，前端当作「已赞」处理 |
| 400 | `P0001` | 触发器 `raise exception`（频率限制） | 直接展示 `message` 给用户 |
| 400 | `PGRST100` | 查询参数解析失败 | 检查 URL 里的 `eq.` / `in.(...)` 语法、有没有忘 `encodeURIComponent` |
| 400 | `PGRST204` | `columns` 参数里有不存在的列 | 检查字段名拼写 |
| 503 | `PGRST002` | schema cache 构建失败 | 通常刚建完对象，等几秒重试 |
| — | `INTERACTIONS_DISABLED` | 全站开关被关 | 站长执行了关闭 SQL；改回 `enabled: true` |
| — | `VISITOR_BANNED` | 访客被封禁 | 预期行为；用户清 localStorage 会变新身份 |

### schema cache 问题（改了主键 / 新建表后 API 报 404）

PostgREST 会缓存表结构。新建对象后**通常几秒内自动刷新**，如果没刷到：

```sql
notify pgrst, 'reload schema';
```

也可以去 Dashboard → **Project Settings → API → Reload schema cache**（如果有这个按钮）。

> 官方特别提到：**改了表的主键后，必须刷新 schema cache，upsert 才能正常工作。**

### CORS 报错

Supabase 默认允许所有来源，正常不会遇到。如果遇到：

- 检查用的是 `https://` 而不是 `http://`
- 检查 `apikey` 头拼写（**不是** `apiKey` 或 `api-key`）
- 本地用 `file://` 打开页面时部分浏览器会限制 CORS → 用 `node tools/serve.mjs` 起本地服务器

### 中文内容显示异常

- 数据库列用 `text`（不是 `varchar(n)` 截断），连接字符集 UTF-8（Supabase 默认）
- 前端提交时用 `JSON.stringify`（fetch 会自动按 UTF-8 编码）
- 检查约束用的是 `char_length`（字符数，中文算 1 个）而不是 `length`（字节数）

---

## 9. 参考来源

本文档的 API 细节与额度政策均对照官方文档核实（2026-09）：

- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) —
  grants 与 policies 的关系、`anon` / `authenticated` 角色、缺失 grant 报 `42501`
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) —
  默认权限变化（平台正在改为「不自动授权」）、pre-request 函数、从 `request.headers` 读 `X-Forwarded-For`
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys) —
  publishable / secret 密钥、`anon` / `service_role` 弃用时间线、密钥在 Dashboard 的位置
- [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing) —
  7 天不活跃暂停、暂停前一周发警告、1 年内可恢复、数据保留
- [Supabase Pricing](https://supabase.com/pricing.md) —
  Free 计划额度（无限 API 请求、500MB、5GB egress、2 个活跃项目）
- [PostgREST: Tables and Views](https://docs.postgrest.org/en/stable/references/api/tables_views.html) —
  upsert 的 `Prefer: resolution=merge-duplicates`、`on_conflict` 查询参数、
  主键冲突默认行为、改主键后需刷新 schema cache
- [PostgREST Error Codes（Supabase 整理）](https://supabase.com/docs/guides/api/rest/postgrest-error-codes) —
  `23505`→409、`23514`→400、`P0001`→400、`42501`→401/403 的映射
