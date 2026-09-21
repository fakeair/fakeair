-- ===========================================================================
--  巡音流歌图片集 · 互动后端 · 纯执行版
--  由 docs/supabase-schema.sql 自动生成（去掉了注释里的示例代码与清理段）
--  直接全选复制 → 粘进 Supabase SQL Editor → Run
--  期望结果：Success. No rows returned
--
--  完整版（带详细说明、站长速查 SQL、安全边界）见 docs/supabase-schema.sql
-- ===========================================================================

create schema if not exists private;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.luka_likes (
  id          bigint      generated always as identity primary key,
  work_id     text        not null,
  visitor_id  uuid        not null,
  created_at  timestamptz not null default now(),
  constraint luka_likes_work_id_format
    check (work_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint luka_likes_unique_per_visitor
    unique (work_id, visitor_id)
);

comment on table public.luka_likes is
  '每行 = 一个匿名访客对一张作品的点赞。取消赞 = 删除行。';

create index luka_likes_work_id_idx on public.luka_likes (work_id);

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
  constraint luka_ratings_score_range
    check (score between 1 and 5)
);

comment on table public.luka_ratings is
  '每行 = 一个匿名访客对一张作品的评分（1~5）。改分走 upsert。';

create trigger luka_ratings_touch
  before update on public.luka_ratings
  for each row execute function private.touch_updated_at();

create index luka_ratings_work_id_idx on public.luka_ratings (work_id);

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
  constraint luka_comments_body_length
    check (char_length(btrim(body)) between 1 and 200),
  constraint luka_comments_body_printable
    check (replace(replace(body, E'\n', ''), E'\t', '') !~ '[[:cntrl:]]'),
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

insert into public.luka_app_settings (key, value) values
  ('banned_visitors',      '{"ids": []}'::jsonb),
  ('interactions_enabled', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;

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

revoke all on public.luka_likes        from anon, authenticated;

revoke all on public.luka_favorites    from anon, authenticated;

revoke all on public.luka_ratings      from anon, authenticated;

revoke all on public.luka_comments     from anon, authenticated;

revoke all on public.luka_app_settings from anon, authenticated;

revoke all on public.luka_work_stats   from anon, authenticated;

revoke all on public.luka_my_state     from anon, authenticated;

grant select, insert, delete on public.luka_likes to anon, authenticated;

grant select, insert, delete on public.luka_favorites to anon, authenticated;

grant select, insert, update, delete on public.luka_ratings to anon, authenticated;

grant select, insert on public.luka_comments to anon, authenticated;

grant select on public.luka_work_stats to anon, authenticated;

grant select on public.luka_my_state   to anon, authenticated;

alter table public.luka_likes        enable row level security;

alter table public.luka_favorites    enable row level security;

alter table public.luka_ratings      enable row level security;

alter table public.luka_comments     enable row level security;

alter table public.luka_app_settings enable row level security;

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

create policy luka_comments_read
  on public.luka_comments for select
  to anon, authenticated
  using (hidden = false);

create policy luka_comments_insert
  on public.luka_comments for insert
  to anon, authenticated
  with check (hidden = false);

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
