// 상세기획서 화면정의 — 브라우저 열람용 HTML 생성 (PPT와 동일 데이터)
import { writeFileSync, mkdirSync } from 'node:fs';
import { SCREENS } from './screens-data.mjs';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function descHtml(desc) {
  let n = 0; let polDone = false; const out = [];
  for (const it of desc) {
    if (it && it.h) { n += 1; out.push(`<div class="d-h"><span class="num">${CIRCLED[n - 1]}</span>${esc(it.h)}</div>`); }
    else if (it && it.cond) out.push(`<div class="d-cond">→ ${esc(it.cond)}</div>`);
    else if (it && it.pol) {
      if (!polDone) { polDone = true; out.push(`<div class="pol-h">■ 페이지 정책</div>`); }
      out.push(`<div class="d-pol">· ${esc(it.pol.replace(/^\[정책\]\s*/, ''))}</div>`);
    }
    else out.push(`<div class="d-sub">· ${esc(it)}</div>`);
  }
  return out.join('');
}

const toc = SCREENS.map((p, i) => `<a href="#s${i}">${esc(p.path.replace('어드민 > ', ''))}</a>`).join('');

const sections = SCREENS.map((p, i) => `
<section class="screen" id="s${i}">
  <div class="bar">
    <span class="bl">화면명/위치</span><span class="bv strong">HomePlanner3 어드민</span>
    <span class="bl">상세</span><span class="bv">${esc(p.path)}</span>
    <span class="bl">구분</span><span class="bv ${p.gubun === '공통' ? '' : 'red'}">${esc(p.gubun)}</span>
  </div>
  <div class="body">
    <div class="shot">
      ${p.img ? `<span class="mk">1</span><img src="/captures/${p.img}" alt="${esc(p.name)}"/>` : `<div class="ph">${esc(p.name)}<br/><small>화면 캡처 별도 첨부</small></div>`}
    </div>
    <div class="desc"><div class="desc-h">Description</div>${descHtml(p.desc)}</div>
  </div>
</section>`).join('');

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>HomePlanner3 어드민 — 상세기획서 화면정의</title>
<style>
  :root{--ink:#1e2a3a;--text:#2a3646;--mute:#5d6c7e;--line:#d7dde3;--gray:#eceef1;--red:#e8543a;--bg:#eef2f6;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:"Pretendard Variable",Pretendard,-apple-system,"Malgun Gothic",sans-serif;color:var(--text);background:var(--bg);}
  header.top{background:var(--ink);color:#fff;padding:18px 24px;position:sticky;top:0;z-index:5;}
  header.top h1{font-size:1.15rem;font-weight:700;}
  header.top p{font-size:.8rem;color:#aebccb;margin-top:2px;}
  nav.toc{position:sticky;top:62px;z-index:4;background:#fff;border-bottom:1px solid var(--line);padding:10px 24px;display:flex;flex-wrap:wrap;gap:6px 14px;}
  nav.toc a{font-size:.82rem;color:#3a6ea5;text-decoration:none;font-weight:600;}
  nav.toc a:hover{text-decoration:underline;}
  .wrap{max-width:1180px;margin:0 auto;padding:24px;}
  .screen{background:#fff;border:1px solid var(--line);border-radius:12px;margin-bottom:22px;overflow:hidden;scroll-margin-top:120px;box-shadow:0 8px 22px -16px rgba(30,42,58,.4);}
  .bar{display:flex;align-items:stretch;border-bottom:1px solid var(--line);font-size:.86rem;flex-wrap:wrap;}
  .bar .bl{background:var(--gray);font-weight:700;color:var(--ink);padding:9px 12px;display:flex;align-items:center;white-space:nowrap;}
  .bar .bv{padding:9px 14px;display:flex;align-items:center;color:var(--text);border-right:1px solid var(--line);}
  .bar .bv.strong{font-weight:700;color:var(--ink);}
  .bar .bv.red{color:var(--red);font-weight:700;}
  .body{display:grid;grid-template-columns:1.55fr 1fr;gap:0;}
  @media(max-width:900px){.body{grid-template-columns:1fr;}}
  .shot{position:relative;padding:16px;border-right:1px solid var(--line);background:#fafcfd;}
  .shot img{width:100%;display:block;border:1px dashed var(--red);border-radius:6px;}
  .shot .mk{position:absolute;left:8px;top:8px;width:24px;height:24px;border-radius:4px;background:var(--red);color:#fff;font-weight:700;display:grid;place-items:center;font-size:.85rem;z-index:2;}
  .shot .ph{border:1px dashed var(--red);border-radius:6px;min-height:240px;display:grid;place-items:center;text-align:center;color:var(--mute);font-weight:700;}
  .desc{padding:16px 18px;}
  .desc-h{font-weight:700;color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:6px;margin-bottom:10px;}
  .d-h{font-weight:700;color:var(--ink);margin:12px 0 4px;font-size:.92rem;}
  .d-h .num{color:var(--red);margin-right:5px;}
  .d-sub{font-size:.85rem;color:var(--text);line-height:1.5;padding-left:6px;}
  .d-cond{font-size:.84rem;color:var(--red);font-weight:600;line-height:1.5;}
  .pol-h{margin:12px 0 4px;font-weight:700;color:var(--red);font-size:.86rem;border-top:1px dashed var(--red);padding-top:8px;}
  .d-pol{font-size:.84rem;color:var(--red);line-height:1.5;padding-left:6px;}
  @media print{body{background:#fff;} nav.toc{display:none;} header.top{position:static;}}
</style></head><body>
<header class="top"><h1>HomePlanner3 어드민 — 상세기획서 (화면정의)</h1><p>v1.1 · 전 화면 기능 전수 · 브라우저 열람용</p></header>
<nav class="toc">${toc}</nav>
<div class="wrap">${sections}</div>
</body></html>`;

for (const dir of ['c:/workspace/HP3_admin/public/spec-screens', 'c:/workspace/HP3_admin/docs']) {
  mkdirSync(dir, { recursive: true });
  const out = dir.endsWith('docs') ? dir + '/상세기획서_화면정의.html' : dir + '/index.html';
  writeFileSync(out, html, 'utf8');
  console.log('wrote', out);
}
