-- ============================================================================
--  巡音流歌画廊 · 互动后端（点赞 / 收藏 / 五星评分 / 文字短评）
--  Supabase 版 · 匿名访客方案（无账号，靠浏览器生成的 visitor_id 去重）
-- ============================================================================
--
--  怎么用：
--    1. 打开 Supabase 项目 → 左侧 SQL Editor → New query
--    2. 把本文件全部内容粘贴进去 → Run
--    3. 应该一次跑通，无报错（首次执行、空项目）
--
--  设计前提（很重要）：
--    * publishable / anon 密钥会公开在浏览器里，任何人都能直接调 API。
--      → 所以「数据是否合理」必须由数据库约束（CHECK / UNIQUE / 触发器）保证，
--        RLS 只负责「哪些行能被读写」。
--    * 访客没有账号，visitor_id 由前端生成并存在 localStorage。
--      → 它只能防「同一个人重复点赞」，**不能防伪造**（清 localStorage 即可重置）。
--        这是无账号方案的固有上限，详见 docs/supabase-setup.md 的安全章节。
--    * 作品本身（图片、标题）仍在前端 data/works.js，数据库只存互动数据。
--
--  幂等性说明：
--    本脚本**不**使用 IF NOT EXISTS，故意如此 —— 它在空项目上一次跑通，
--    重复执行会明确报「已存在」，避免你误以为重跑会重置数据。
--    要彻底重来请执行文件末尾的「清理」段（会删数据）。
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 前置
-- ---------------------------------------------------------------------------

-- gen_random_uuid()：Postgres 13+ 已内置（Supabase 全系满足），无需扩展。
-- 这里刻意不引用 pgcrypto / uuid-ossp，避免「扩展不存在」的报错。

create schema if not exists private;


-- ---------------------------------------------------------------------------
-- 1. 通用小工具：updated_at 自动维护
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 2. 点赞
--    一行 = 一个访客对一张图的一次赞。取消赞 = 删除该行。
-- ---------------------------------------------------------------------------

create table public.luka_likes (
  id          bigint      generated always as identity primary key,
  work_id     text        not null,
  visitor_id  uuid        not null,
  created_at  timestamptz not null default now(),

  constraint luka_likes_work_id_format
    check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),

  -- 同一个人对同一张图只能有一个赞（重复点赞 = 409 冲突，前端据此判断已赞）
  constraint luka_likes_unique_per_visitor
    unique (work_id, visitor_id)
);

comment on table public.luka_likes is
  '每行 = 一个匿名访客对一张作品的点赞。取消赞 = 删除行。';

create index luka_likes_work_id_idx on public.luka_likes (work_id);


-- ---------------------------------------------------------------------------
-- 3. 收藏（语义同点赞，但用途是「我的书签」）
-- ---------------------------------------------------------------------------

create table public.luka_favorites (
  id          bigint      generated always as identity primary key,
  work_id     text        not null,
  visitor_id  uuid        not null,
  created_at  timestamptz not null default now(),

  constraint luka_favorites_work_id_format
    check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),

  constraint luka_favorites_unique_per_visitor
    unique (work_id, visitor_id)
);

comment on table public.luka_favorites is
  '每行 = 一个匿名访客收藏了一张作品。用于「我的收藏」筛选。';

create index luka_favorites_work_id_idx on public.luka_favorites (work_id);
create index luka_favorites_visitor_idx  on public.luka_favorites (visitor_id);


-- ---------------------------------------------------------------------------
-- 4. 五星评分
--    主键就是 (work_id, visitor_id)，天然保证「一人一图一评分」，可改分。
-- ---------------------------------------------------------------------------

create table public.luka_ratings (
  work_id     text        not null,
  visitor_id  uuid        not null,
  score       smallint    not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint luka_ratings_pkey
    primary key (work_id, visitor_id),

  constraint luka_ratings_work_id_format
    check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),

  -- 评分只能是 1~5 的整数
  constraint luka_ratings_score_range
    check (score between 1 and 5)
);

comment on table public.luka_ratings is
  '每行 = 一个匿名访客对一张作品的评分（1~5）。改分走 upsert。';

create trigger luka_ratings_touch
  before update on public.luka_ratings
  for each row execute function private.touch_updated_at();

create index luka_ratings_work_id_idx on public.luka_ratings (work_id);


-- ---------------------------------------------------------------------------
-- 5. 文字短评
--    * 长度：正文 1~200 字，昵称 1~24 字（空字符串会被规整成 NULL）
--    * hidden：留给站长的软删除开关（用 secret key / SQL Editor 设置）
--    * 频率限制：见下方触发器
--
--    刻意使用 POSIX 字符类（[[:cntrl:]]）而不是 \uXXXX 转义：
--    Postgres 正则对 \u 的支持跨版本不稳，[[:cntrl:]] 在所有版本都可靠。
-- ---------------------------------------------------------------------------

create table public.luka_comments (
  id          bigint      generated always as identity primary key,
  work_id     text        not null,
  visitor_id  uuid        not null,
  nickname    text,
  body        text        not null,
  hidden      boolean     not null default false,
  created_at  timestamptz not null default now(),

  constraint luka_comments_work_id_format
    check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),

  -- 正文：去掉首尾空白后 1~200 字符
  constraint luka_comments_body_length
    check (char_length(btrim(body)) between 1 and 200),

  -- 只允许换行与制表符，其余控制字符拒绝（防显示错乱 / 注入花样）
  constraint luka_comments_body_printable
    check (replace(replace(body, E'\n', ''), E'\t', '') !~ '[[:cntrl:]]'),

  -- 昵称可空；非空则 1~24 字符
  constraint luka_comments_nickname_length
    check (nickname is null or char_length(btrim(nickname)) between 1 and 24),

  constraint luka_comments_nickname_printable
    check (nickname is null or nickname !~ '[[:cntrl:]]')
);

comment on table public.luka_comments is
  '每行 = 一条匿名短评。hidden=true 表示站长已隐藏（软删除）。';

create index luka_comments_work_created_idx
  on public.luka_comments (work_id, created_at desc);
create index luka_comments_visitor_created_idx
  on public.luka_comments (visitor_id, created_at desc);

-- 昵称留空时存 NULL，避免出现一堆空字符串
create or replace function private.normalize_comment()
returns trigger
language plpgsql
as $$
begin
  new.body := btrim(new.body);
  new.nickname := nullif(btrim(coalesce(new.nickname, '')), '');
  return new;
end;
$$;

create trigger luka_comments_normalize
  before insert or update on public.luka_comments
  for each row execute function private.normalize_comment();

-- 频率限制：同一访客 10 分钟内最多 10 条短评；全局 1 小时内最多 500 条。
-- 因为前端可用的角色只有 anon，这一层是「唯一」能挡住单个脚本连发的防线。
-- 触发器在 anon 权限下执行，而 anon 已有 select 权限，所以计数读得到。
create or replace function private.luka_comments_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_visitor int;
  recent_total   int;
begin
  select count(*) into recent_visitor
    from public.luka_comments
   where visitor_id = new.visitor_id
     and created_at > now() - interval '10 minutes';

  if recent_visitor >= 10 then
    raise exception '短评太频繁了，请稍后再试（10 分钟内最多 10 条）'
      using errcode = 'P0001';
  end if;

  select count(*) into recent_total
    from public.luka_comments
   where created_at > now() - interval '1 hour';

  if recent_total >= 500 then
    raise exception '短评区暂时繁忙，请稍后再试'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger luka_comments_rate_limit
  before insert on public.luka_comments
  for each row execute function private.luka_comments_rate_limit();


-- ---------------------------------------------------------------------------
-- 6. 站长设置（封禁名单 / 全站开关）
--    * 只有 service_role（后端 / SQL Editor）能读写，匿名角色读不到
--    * 前端每次请求带上 X-Visitor-Id，被封的访客会被前置钩子挡掉（见第 10 节）
-- ---------------------------------------------------------------------------

create table public.luka_app_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),

  constraint luka_app_settings_key_format
    check (key ~ '^[a-z0-9_]{1,64}$')
);

comment on table public.luka_app_settings is
  '站长配置。banned_visitors = {"ids":["<uuid>"]}；'
  'interactions_enabled = {"enabled":true|false}。';

create trigger luka_app_settings_touch
  before update on public.luka_app_settings
  for each row execute function private.touch_updated_at();

-- on conflict do nothing：让这一段可以重复执行而不报错
insert into public.luka_app_settings (key, value) values
  ('banned_visitors',      '{"ids": []}'::jsonb),
  ('interactions_enabled', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 7. 聚合视图：一次查出所有作品的互动统计
--    前端只调一次这个视图就能渲染全部卡片上的数字。
--
--    security_invoker = true（Postgres 15+，Supabase 支持）：
--    视图以调用者权限执行，基础表的 RLS 照常生效，不会绕过。
-- ---------------------------------------------------------------------------

create view public.luka_work_stats
with (security_invoker = true) as
with ids as (
  select work_id from public.luka_likes
  union
  select work_id from public.luka_favorites
  union
  select work_id from public.luka_ratings
  union
  select work_id from public.luka_comments where hidden = false
)
select
  ids.work_id,
  (select count(*) from public.luka_likes l
     where l.work_id = ids.work_id)                                   as like_count,
  (select count(*) from public.luka_favorites f
     where f.work_id = ids.work_id)                                   as favorite_count,
  (select count(*) from public.luka_ratings r
     where r.work_id = ids.work_id)                                   as rating_count,
  (select round(avg(r.score)::numeric, 2) from public.luka_ratings r
     where r.work_id = ids.work_id)                                   as rating_avg,
  (select count(*) from public.luka_comments c
     where c.work_id = ids.work_id and c.hidden = false)              as comment_count
from ids;

comment on view public.luka_work_stats is
  '每张作品的赞数 / 收藏数 / 评分人数 / 平均分 / 短评数。'
  '没有任何互动的作品不会出现在结果里，前端按默认值处理即可。';


-- ---------------------------------------------------------------------------
-- 8. 访客自己的互动：一次查出「我赞过什么 / 收藏过什么 / 我给过几分」
--
--    ⚠️⚠️ 这个视图有缺陷，本项目的前端**不使用它**（见下方说明）。
--        保留定义只是为了让历史 SQL 能重复执行，以及记录这个坑。
--
--    实测发现的两个问题（2026-09 在真实项目上验证）：
--      1. 视图**没有暴露 visitor_id 列**，所以
--         GET /luka_my_state?visitor_id=eq.<uuid>
--         会被 PostgREST 拒绝：42703 column luka_my_state.visitor_id does not exist
--         → 按访客过滤根本无法工作。
--      2. 下面三个 left join 只按 work_id 关联，**没有带 visitor_id 条件**，
--         且 with 里也没有按访客过滤。结果是：不带过滤查询会返回
--         **所有访客**的互动记录混在一起 —— 每个人都能看到别人的点赞/收藏。
--
--    前端 assets/js/store.js 的做法：绕开这个视图，直接并行查三张基础表：
--         GET /luka_likes?select=work_id&visitor_id=eq.<uuid>
--         GET /luka_favorites?select=work_id&visitor_id=eq.<uuid>
--         GET /luka_ratings?select=work_id,score&visitor_id=eq.<uuid>
--    三个请求换来正确性与隔离，对一个小站完全划算。
--
--    想修好这个视图的话，把 with 里的 mine 改成带访客参数的集合，
--    并在 join 上补 visitor_id 条件；但 PostgREST 不能把查询参数传进视图，
--    所以更现实的方案是写成 RPC 函数（接收 p_visitor uuid）：
--
--      create function public.luka_my_state_for(p_visitor uuid) ...
--
--    本项目没做这一步，因为直接查基础表已经够用且更直观。
-- ---------------------------------------------------------------------------

create view public.luka_my_state
with (security_invoker = true) as
with mine as (
  select work_id from public.luka_likes     where visitor_id is not null
  union
  select work_id from public.luka_favorites where visitor_id is not null
  union
  select work_id from public.luka_ratings   where visitor_id is not null
)
select
  m.work_id,
  (l.visitor_id is not null) as liked,
  (f.visitor_id is not null) as favorited,
  r.score                    as my_score
from mine m
left join public.luka_likes     l on l.work_id = m.work_id
left join public.luka_favorites f on f.work_id = m.work_id
left join public.luka_ratings   r on r.work_id = m.work_id;

comment on view public.luka_my_state is
  '【有缺陷，前端不使用】未暴露 visitor_id、也未按访客过滤，'
  '不带过滤查询会返回所有访客的数据。前端改为直接查三张基础表。';


-- ============================================================================
--  9. 权限（GRANT）与行级安全（RLS）
--     两件事必须都做：
--       GRANT 决定「这个角色能不能碰这张表」
--       RLS   决定「能碰哪些行」
--     平台默认权限正从「自动授权」改为「不授权」，所以这里显式写清楚。
-- ============================================================================

-- 9.1 先全部收回，再按需授予（清掉旧项目可能存在的默认宽松授权）
revoke all on public.luka_likes        from anon, authenticated;
revoke all on public.luka_favorites    from anon, authenticated;
revoke all on public.luka_ratings      from anon, authenticated;
revoke all on public.luka_comments     from anon, authenticated;
revoke all on public.luka_app_settings from anon, authenticated;
revoke all on public.luka_work_stats   from anon, authenticated;
revoke all on public.luka_my_state     from anon, authenticated;

-- 9.2 按需授予匿名访客
--     点赞：可读、可写、可取消（不给 update —— 点赞没有可改的字段）
grant select, insert, delete on public.luka_likes to anon, authenticated;
-- 收藏：同上
grant select, insert, delete on public.luka_favorites to anon, authenticated;
-- 评分：需要 update（改分），也允许 delete（撤销评分）
grant select, insert, update, delete on public.luka_ratings to anon, authenticated;
-- 短评：可读、可发；**不给 update / delete**
--   （否则任何人都能改别人的话、删别人的话；管理走 SQL Editor / secret key）
grant select, insert on public.luka_comments to anon, authenticated;
-- 设置表：不给任何匿名权限
-- 视图：只读
grant select on public.luka_work_stats to anon, authenticated;
grant select on public.luka_my_state   to anon, authenticated;

-- 9.3 打开 RLS
alter table public.luka_likes        enable row level security;
alter table public.luka_favorites    enable row level security;
alter table public.luka_ratings      enable row level security;
alter table public.luka_comments     enable row level security;
alter table public.luka_app_settings enable row level security;

-- 9.4 策略
--     策略同时写给 anon 与 authenticated：
--     用 publishable/anon 密钥调用时角色是 anon；
--     但若访客带上过用户 JWT，角色会变成 authenticated，只写 anon 会被拒。

-- 点赞
create policy luka_likes_read
  on public.luka_likes for select
  to anon, authenticated
  using (true);

create policy luka_likes_insert
  on public.luka_likes for insert
  to anon, authenticated
  with check (true);

create policy luka_likes_delete
  on public.luka_likes for delete
  to anon, authenticated
  using (true);

-- 收藏
create policy luka_favorites_read
  on public.luka_favorites for select
  to anon, authenticated
  using (true);

create policy luka_favorites_insert
  on public.luka_favorites for insert
  to anon, authenticated
  with check (true);

create policy luka_favorites_delete
  on public.luka_favorites for delete
  to anon, authenticated
  using (true);

-- 评分
create policy luka_ratings_read
  on public.luka_ratings for select
  to anon, authenticated
  using (true);

create policy luka_ratings_insert
  on public.luka_ratings for insert
  to anon, authenticated
  with check (true);

create policy luka_ratings_update
  on public.luka_ratings for update
  to anon, authenticated
  using (true)
  with check (true);

create policy luka_ratings_delete
  on public.luka_ratings for delete
  to anon, authenticated
  using (true);

-- 短评：读只给未隐藏的；写只能写 hidden = false
create policy luka_comments_read
  on public.luka_comments for select
  to anon, authenticated
  using (hidden = false);

create policy luka_comments_insert
  on public.luka_comments for insert
  to anon, authenticated
  with check (hidden = false);

-- 设置表：不建任何策略 = 匿名角色什么都读不到（RLS 默认拒绝）


-- ============================================================================
--  10.（可选，默认不开）请求前置校验：全站开关 + 封禁名单
--
--      PostgREST 的 pre-request 钩子，在每次 /rest/v1 请求真正执行前调用一次。
--      为什么用钩子而不是写进 RLS 策略：写进策略会对「每一行」求值一遍，
--      行多了明显变慢；钩子每次请求只跑一次。
--
--      启用：
--        alter role authenticator set pgrst.db_pre_request = 'public.luka_pre_request';
--        notify pgrst, 'reload config';
--
--      关闭：
--        alter role authenticator reset pgrst.db_pre_request;
--        notify pgrst, 'reload config';
--
--      已知取舍：settings 读不到时 fail-open（放行）。这是为「小站可用性」做的
--      选择，不是漏洞；详见文档安全章节。
-- ============================================================================

create or replace function public.luka_pre_request()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_visitor text;
  v_enabled boolean;
  v_banned  jsonb;
begin
  -- 1) 全站开关
  select (value ->> 'enabled')::boolean into v_enabled
    from public.luka_app_settings where key = 'interactions_enabled';

  if v_enabled is false then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'code', 'INTERACTIONS_DISABLED',
        'message', '互动功能已暂时关闭',
        'details', '站长关闭了点赞 / 评分 / 短评',
        'hint', '请稍后再试'
      )::text,
      detail = json_build_object('status', 503)::text;
  end if;

  -- 2) 封禁名单（前端把 visitor_id 放在 X-Visitor-Id 头里）
  v_visitor := current_setting('request.headers', true)::json ->> 'x-visitor-id';

  if v_visitor is not null and v_visitor <> '' then
    select value into v_banned
      from public.luka_app_settings where key = 'banned_visitors';

    if v_banned is not null and (v_banned -> 'ids') ? v_visitor then
      raise sqlstate 'PGRST' using
        message = json_build_object(
          'code', 'VISITOR_BANNED',
          'message', '这个访客标识已被封禁',
          'details', '可能因为刷数据或发布垃圾内容',
          'hint', '清空网站数据会生成新标识，但请勿滥用'
        )::text,
        detail = json_build_object('status', 403)::text;
    end if;
  end if;
end;
$$;


-- ============================================================================
--  11. 站长日常操作速查（用 SQL Editor 执行；这些都不需要改 SQL 结构）
-- ============================================================================
--
-- 隐藏一条垃圾短评：
--   update public.luka_comments set hidden = true where id = 123;
--
-- 删除一条短评：
--   delete from public.luka_comments where id = 123;
--
-- 查看某张图最近的短评：
--   select created_at, nickname, body
--     from public.luka_comments
--    where work_id = 'luka-01' and hidden = false
--    order by created_at desc limit 50;
--
-- 清空某个刷子的所有数据（把 uuid 换成他的 visitor_id）：
--   delete from public.luka_likes     where visitor_id = '00000000-0000-0000-0000-000000000000';
--   delete from public.luka_favorites where visitor_id = '00000000-0000-0000-0000-000000000000';
--   delete from public.luka_ratings   where visitor_id = '00000000-0000-0000-0000-000000000000';
--   delete from public.luka_comments  where visitor_id = '00000000-0000-0000-0000-000000000000';
--
-- 封禁一个访客（需要先启用第 10 节的钩子）：
--   update public.luka_app_settings
--      set value = jsonb_set(value, '{ids}',
--            (value -> 'ids') || to_jsonb('00000000-0000-0000-0000-000000000000'::text))
--    where key = 'banned_visitors';
--
-- 一键关闭所有互动（前端会收到 503）：
--   update public.luka_app_settings
--      set value = '{"enabled": false}'::jsonb
--    where key = 'interactions_enabled';
--
-- 找出异常访客（一个 visitor 赞了超过 20 张图，正常访客不可能）：
--   select visitor_id, count(*) as likes
--     from public.luka_likes group by visitor_id having count(*) > 20
--    order by likes desc;


-- ============================================================================
--  12. 清理（危险！只在你想彻底重来时执行；会删除全部互动数据）
-- ============================================================================
--
-- drop view  if exists public.luka_my_state;
-- drop view  if exists public.luka_work_stats;
-- drop table if exists public.luka_comments;
-- drop table if exists public.luka_ratings;
-- drop table if exists public.luka_favorites;
-- drop table if exists public.luka_likes;
-- drop table if exists public.luka_app_settings;
-- drop function if exists public.luka_pre_request();
-- drop function if exists private.luka_comments_rate_limit();
-- drop function if exists private.normalize_comment();
-- drop function if exists private.touch_updated_at();
-- drop schema if exists private;
