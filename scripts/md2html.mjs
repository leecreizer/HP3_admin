// 의존성 없는 간단 Markdown → HTML 변환기 (지시서 전용)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 인자: node md2html.mjs <src.md> <out1> [out2 ...]  (없으면 개발지시서 기본)
const argv = process.argv.slice(2);
const SRC = argv[0] ?? 'docs/개발지시서.md';
const OUTS = argv.length > 1 ? argv.slice(1) : ['docs/개발지시서.html', 'public/개발지시서.html'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const md = readFileSync(SRC, 'utf8').split(/\r?\n/);
const out = [];
let i = 0;
let listStack = []; // {type:'ul'|'ol'}

const closeLists = (toDepth = 0) => {
  while (listStack.length > toDepth) out.push(`</${listStack.pop().type}>`);
};

while (i < md.length) {
  let line = md[i];

  // 코드 블록
  if (/^```/.test(line)) {
    closeLists();
    const buf = [];
    i++;
    while (i < md.length && !/^```/.test(md[i])) buf.push(esc(md[i++]));
    i++;
    out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
    continue;
  }

  // 표 (| ... | 다음 줄이 구분선)
  if (/^\s*\|/.test(line) && i + 1 < md.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(md[i + 1])) {
    closeLists();
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const header = cells(line);
    i += 2;
    const rows = [];
    while (i < md.length && /^\s*\|/.test(md[i])) rows.push(cells(md[i++]));
    out.push('<table><thead><tr>' + header.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
    for (const r of rows) out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
    out.push('</tbody></table>');
    continue;
  }

  // 제목
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) {
    closeLists();
    out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    i++;
    continue;
  }

  // 수평선
  if (/^---+\s*$/.test(line)) {
    closeLists();
    out.push('<hr/>');
    i++;
    continue;
  }

  // 인용
  if (/^>\s?/.test(line)) {
    closeLists();
    const buf = [];
    while (i < md.length && /^>\s?/.test(md[i])) buf.push(inline(md[i++].replace(/^>\s?/, '')));
    out.push(`<blockquote>${buf.join('<br/>')}</blockquote>`);
    continue;
  }

  // 리스트 (들여쓰기 깊이 지원)
  const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
  if (li) {
    const depth = Math.floor(li[1].length / 2) + 1;
    const type = /\d+\./.test(li[2]) ? 'ol' : 'ul';
    while (listStack.length < depth) {
      out.push(`<${type}>`);
      listStack.push({ type });
    }
    closeLists(depth);
    out.push(`<li>${inline(li[3])}</li>`);
    i++;
    continue;
  }

  // 빈 줄
  if (/^\s*$/.test(line)) {
    closeLists();
    i++;
    continue;
  }

  // 일반 문단
  closeLists();
  out.push(`<p>${inline(line)}</p>`);
  i++;
}
closeLists();

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${(md.find((l) => /^#\s+/.test(l)) ?? '# HomePlanner3 Admin').replace(/^#\s+/, '')}</title>
<style>
  :root{--ink:#1e2a3a;--text:#2a3646;--text2:#5d6c7e;--line:#e3e8ee;--bg:#f4f7f9;--accent:#3a6ea5;}
  *{box-sizing:border-box;}
  body{font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic",sans-serif;color:var(--text);
    line-height:1.7;max-width:960px;margin:0 auto;padding:48px 28px 120px;background:#fff;}
  h1{font-size:2rem;color:var(--ink);border-bottom:3px solid var(--ink);padding-bottom:.4em;margin-top:1.6em;}
  h2{font-size:1.4rem;color:var(--ink);margin-top:1.8em;border-bottom:1px solid var(--line);padding-bottom:.3em;}
  h3{font-size:1.12rem;color:var(--ink);margin-top:1.4em;}
  h4{font-size:1rem;color:var(--text2);margin-top:1.2em;}
  p{margin:.6em 0;}
  code{font-family:"Space Grotesk",Consolas,monospace;background:#eef2f6;padding:1px 6px;border-radius:5px;font-size:.9em;}
  pre{background:#1e2a3a;color:#e6edf3;padding:16px 18px;border-radius:12px;overflow-x:auto;}
  pre code{background:none;color:inherit;padding:0;}
  table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.92rem;}
  th,td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top;}
  th{background:var(--bg);color:var(--ink);}
  tr:nth-child(even) td{background:#fafcfd;}
  blockquote{margin:1em 0;padding:10px 16px;background:var(--bg);border-left:4px solid var(--accent);color:var(--text2);border-radius:0 8px 8px 0;}
  hr{border:none;border-top:1px solid var(--line);margin:2.2em 0;}
  ul,ol{margin:.5em 0 .8em;padding-left:1.6em;}
  li{margin:.2em 0;}
  a{color:var(--accent);}
  @media print{body{padding:0;max-width:none;} pre{white-space:pre-wrap;}}
</style></head><body>
${out.join('\n')}
</body></html>`;

for (const o of OUTS) {
  mkdirSync(dirname(o), { recursive: true });
  writeFileSync(o, html, 'utf8');
  console.log('wrote', o);
}
