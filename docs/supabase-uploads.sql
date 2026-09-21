-- ===========================================================================
--  上传功能 · 增量迁移
--  在已经跑过 supabase-schema-min.sql 的项目上，再跑这一份即可。
--
--  它做三件事：
--    1. 建一个公开的 Storage 桶 luka-uploads（存访客上传的原图与缩略图）
--    2. 给 storage.objects 加匿名上传策略（只允许传进这个桶）
--    3. 建 luka_uploads 表记录投稿信息（作品名、署名、分类、隐藏开关）
--
--  期望结果：Success. No rows returned
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Storage 桶
--    public = true：读文件不需要任何策略（公开 CDN 直接可读），
--    所以我们只需要为「写入」建策略，读的部分交给公开桶。
--
--    限制：只允许图片类型，单文件最大 20MB
--    （免费版全局上限是 50MB，这里收紧一些更稳）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'luka-uploads',
  'luka-uploads',
  true,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 2. Storage 策略：允许匿名访客上传
--
--    重要：只有 SELECT 策略是不够的 —— 上传必须单独有 INSERT 策略，
--    否则会报「new row violates row-level security policy」。
--
--    这里刻意写死桶名，并且**不给 DELETE 策略**：
--    普通访客无法删掉桶里的任何文件（包括自己的），删除只能由站长
--    在 Dashboard 或 SQL Editor 里做。这是防「上传后又清空」的保险。
-- ---------------------------------------------------------------------------
drop policy if exists luka_uploads_insert on storage.objects;
create policy luka_uploads_insert
  on storage.objects
  for insert
  to anon, authenticated
  with check (bucket_id = 'luka-uploads');

-- 允许列出对象（前端上传后要能校验）
drop policy if exists luka_uploads_select on storage.objects;
create policy luka_uploads_select
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'luka-uploads');


-- ---------------------------------------------------------------------------
-- 3. 投稿记录表
--    work_id 用 'up-' 前缀，和站内固定作品（luka-01 / collab-01）区分开，
--    这样互动数据（点赞/收藏/评分/短评）天然复用同一张表，不用改任何逻辑。
-- ---------------------------------------------------------------------------
create table if not exists public.luka_uploads (
  work_id     text        primary key,
  title       text        not null,
  author      text,
  tags        text[]      not null default '{}',
  src         text        not null,          -- 原图公开地址
  thumb       text,                          -- 缩略图公开地址
  w           integer     not null,
  h           integer     not null,
  hidden      boolean     not null default false,
  visitor_id  uuid,
  created_at  timestamptz not null default now(),

  constraint luka_uploads_work_id_format
    check (work_id ~ '^up-[a-z0-9][a-z0-9_-]{0,60}$'),

  constraint luka_uploads_title_length
    check (char_length(btrim(title)) between 1 and 60),

  constraint luka_uploads_author_length
    check (author is null or char_length(btrim(author)) between 1 and 24),

  constraint luka_uploads_size_range
    check (w between 1 and 20000 and h between 1 and 20000),

  -- 只允许换行与制表符之外的可见字符，防止把控制字符塞进标题
  constraint luka_uploads_title_printable
    check (replace(replace(title, E'\n', ''), E'\t', '') !~ '[[:cntrl:]]'),

  constraint luka_uploads_author_printable
    check (author is null or author !~ '[[:cntrl:]]'),

  -- 地址必须是本站 Storage 的路径，避免被塞进任意外链（防钓鱼/挂马）
  constraint luka_uploads_src_is_ours
    check (src like 'https://%/storage/v1/object/public/luka-uploads/%'),
  constraint luka_uploads_thumb_is_ours
    check (thumb is null or thumb like 'https://%/storage/v1/object/public/luka-uploads/%')
);

create index if not exists luka_uploads_created_idx
  on public.luka_uploads (created_at desc);

create index if not exists luka_uploads_visible_idx
  on public.luka_uploads (hidden, created_at desc);


-- ---------------------------------------------------------------------------
-- 4. 频率限制：同一个访客 1 小时内最多上传 10 张。
--    没有账号体系，这是唯一能挡住「一个人刷满存储」的防线。
-- ---------------------------------------------------------------------------
create or replace function private.luka_uploads_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent int;
begin
  if new.visitor_id is not null then
    select count(*) into recent
      from public.luka_uploads
     where visitor_id = new.visitor_id
       and created_at > now() - interval '1 hour';

    if recent >= 10 then
      raise exception '上传太频繁了，1 小时内最多 10 张，请稍后再试'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists luka_uploads_rate_limit on public.luka_uploads;
create trigger luka_uploads_rate_limit
  before insert on public.luka_uploads
  for each row execute function private.luka_uploads_rate_limit();


-- ---------------------------------------------------------------------------
-- 5. 权限与行级安全
-- ---------------------------------------------------------------------------
revoke all on public.luka_uploads from anon, authenticated;

-- 匿名可读（但读不到 hidden 的，见下面策略）、可插入
grant select, insert on public.luka_uploads to anon, authenticated;

alter table public.luka_uploads enable row level security;

-- 读：只能看到未隐藏的投稿
drop policy if exists luka_uploads_read on public.luka_uploads;
create policy luka_uploads_read
  on public.luka_uploads
  for select
  to anon, authenticated
  using (hidden = false);

-- 写：只能插入未隐藏的记录
drop policy if exists luka_uploads_insert_row on public.luka_uploads;
create policy luka_uploads_insert_row
  on public.luka_uploads
  for insert
  to anon, authenticated
  with check (hidden = false);

-- 刻意不建 update / delete 策略：
-- 匿名访客无法改删任何投稿记录，包括自己的。
-- 下架走站长在 SQL Editor 里执行 update ... set hidden = true。


-- ---------------------------------------------------------------------------
-- 6. 统计视图：把投稿也纳入互动统计
--    原来 luka_work_stats 只从点赞/收藏/评分/短评表聚合，
--    投稿的 work_id 也会自动出现在里面（因为互动表的 work_id 是自由文本），
--    所以这里不需要改动，前端把两份数据合并即可。
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 站长速查（在 SQL Editor 里执行）
-- ---------------------------------------------------------------------------
-- 看最新投稿：
--   select created_at, work_id, title, author, hidden
--     from public.luka_uploads order by created_at desc limit 50;
--
-- 下架某一张（画廊里立刻消失，但文件和点赞记录都保留，可随时恢复）：
--   update public.luka_uploads set hidden = true where work_id = 'up-xxxxxxxx';
--
-- 恢复：
--   update public.luka_uploads set hidden = false where work_id = 'up-xxxxxxxx';
--
-- 彻底删除一条投稿记录（文件仍留在 Storage，需要另外去 Storage 页面删）：
--   delete from public.luka_uploads where work_id = 'up-xxxxxxxx';
--
-- 找出刷子（一小时传了 10 张以上）：
--   select visitor_id, count(*) from public.luka_uploads
--    group by visitor_id having count(*) > 9 order by 2 desc;
--
-- 清空某个刷子的所有投稿：
--   update public.luka_uploads set hidden = true
--    where visitor_id = '00000000-0000-0000-0000-000000000000';
