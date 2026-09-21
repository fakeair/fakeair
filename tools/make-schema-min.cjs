// 从完整 schema 生成「纯执行版」：去掉整行注释与空行，只留可执行 SQL。
// 用途：用户在 Supabase SQL Editor 里粘贴时不会被大段注释和「清理（危险）」段干扰。
const fs = require('fs');

const src = fs.readFileSync('docs/supabase-schema.sql', 'utf8');
const lines = src.split(/\r?\n/);

const out = [];
let blank = false;
let inDollar = false; // 是否在 $$ ... $$ 函数体内部
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed === '') { blank = true; continue; }
  if (trimmed.startsWith('--')) continue; // 整行注释：丢掉

  out.push(line.replace(/\s+$/, ''));

  // $$ 成对出现，用来判断函数体边界（本 schema 里没有嵌套）
  const dollars = (trimmed.match(/\$\$/g) || []).length;
  if (dollars % 2 === 1) inDollar = !inDollar;

  // 只在「顶层语句」结束后留一个空行，函数体内部不插空行
  if (!inDollar && trimmed.endsWith(';')) {
    out.push('');
    blank = false;
  } else {
    blank = false;
  }
}

const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

const header = `-- ===========================================================================
--  巡音流歌图片集 · 互动后端 · 纯执行版
--  由 docs/supabase-schema.sql 自动生成（去掉了注释里的示例代码与清理段）
--  直接全选复制 → 粘进 Supabase SQL Editor → Run
--  期望结果：Success. No rows returned
--
--  完整版（带详细说明、站长速查 SQL、安全边界）见 docs/supabase-schema.sql
-- ===========================================================================

`;

fs.writeFileSync('docs/supabase-schema-min.sql', header + text);

const stmts = (text.match(/;/g) || []).length;
console.log('生成 docs/supabase-schema-min.sql');
console.log('  原文件行数 ' + lines.length + ' → 纯执行版 ' + (header + text).split('\n').length + ' 行');
console.log('  可执行语句约 ' + stmts + ' 条，体积 ' + Math.round((header + text).length / 1024) + ' KB');
