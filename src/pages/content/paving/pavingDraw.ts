import type { PvScheme } from '../../../data/paving';
import { bounds, layoutScheme, num, type Layout, type Placed, type V2 } from './pavingGeom';

/**
 * 파라메트릭 방안 그리기 — 캔버스 2D. 월드 mm·y 위 → 화면 px·y 아래.
 * 쿠지알러 화면처럼: 회색 바탕 · 캔버스(점선)·참조선 격자 · 원점 축(빨강 세로·초록 가로) · 선택 파랑 · 포설 방식 u·v 화살표
 */

export type View = { cx: number; cy: number; scale: number };
export type ImgEntry = { img: HTMLImageElement; pattern: CanvasPattern | null; avg: string };
export type ImgCache = Map<string, ImgEntry | 'loading' | 'error'>;

export const toScreen = (v: View, W: number, H: number) => ([x, y]: V2): V2 => [(x - v.cx) * v.scale + W / 2, H / 2 - (y - v.cy) * v.scale];
export const toWorld = (v: View, W: number, H: number) => ([px, py]: V2): V2 => [(px - W / 2) / v.scale + v.cx, v.cy - (py - H / 2) / v.scale];

/** 캔버스 전체가 보이게 */
export function fitView(canvas: { w: number; h: number }, W: number, H: number, pad = 60): View {
  const scale = Math.max(1e-4, Math.min((W - pad * 2) / canvas.w, (H - pad * 2) / canvas.h));
  return { cx: canvas.w / 2, cy: canvas.h / 2, scale };
}

/** 이미지 평균색 (1×1 축소) — 아주 작게 보일 때 채움색 */
function avgColor(img: HTMLImageElement): string {
  try {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${r},${gg},${b})`;
  } catch { return '#d6d6d6'; }
}

/** 소재 이미지 불러오기 (CORS → 실패하면 일반) — 끝나면 onLoad */
export function ensureImage(cache: ImgCache, src: string, onLoad: () => void) {
  if (!src || cache.has(src)) return;
  cache.set(src, 'loading');
  const tryLoad = (cors: boolean) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => { cache.set(src, { img, pattern: null, avg: avgColor(img) }); onLoad(); };
    img.onerror = () => { if (cors && !src.startsWith('data:')) tryLoad(false); else { cache.set(src, 'error'); onLoad(); } };
    img.src = src;
  };
  tryLoad(!src.startsWith('data:'));
}

const path = (g: CanvasRenderingContext2D, pts: V2[]) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };

export type DrawOpts = {
  images: ImgCache;
  /** 포설 방식 편집 중 — 그 단위(0,0)만 또렷하게 */
  editId?: string | null;
  selIds: string[];
  /** 선택 표시를 그릴 노드 id (편집 중이면 단위 안 타일) */
  showSel?: boolean;
  grid?: boolean;
  /** 원점 축·캔버스 점선 (썸네일·미리보기 캡처에서는 끔) */
  guides?: boolean;
};

/** 타일 하나 채우기 — 재질 틀(왼쪽 아래 o, 각도 a)에 상품 이미지(w×h mm)를 반복 패턴으로 */
function fillTile(g: CanvasRenderingContext2D, p: Placed, scr: V2[], v: View, W: number, H: number, images: ImgCache) {
  path(g, scr);
  const sp = p.sprite;
  const e = sp ? images.get(sp.img) : undefined;
  if (!sp || !e || e === 'loading' || e === 'error') { g.fillStyle = '#d9d9d9'; g.fill(); return; }
  const tiny = Math.min(sp.w, sp.h) * v.scale < 3;
  if (tiny) { g.fillStyle = e.avg; g.fill(); return; }
  if (!e.pattern) e.pattern = g.createPattern(e.img, 'repeat');
  if (!e.pattern) { g.fillStyle = e.avg; g.fill(); return; }
  const k = v.scale, a = (p.tex.a * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const sx = sp.w / e.img.naturalWidth, sy = sp.h / e.img.naturalHeight;
  const [ox, oy] = p.tex.o;
  // 이미지 픽셀(u,v 아래) → 상품 좌표(px = u·sx, py = h − v·sy) → 월드(o + R·p) → 화면
  e.pattern.setTransform(new DOMMatrix([k * ca * sx, -k * sa * sx, k * sa * sy, k * ca * sy, k * (ox - sa * sp.h - v.cx) + W / 2, H / 2 - k * (oy + ca * sp.h - v.cy)]));
  g.fillStyle = e.pattern;
  g.fill();
}

/** 방안 그리기 */
export function drawScheme(g: CanvasRenderingContext2D, W: number, H: number, s: PvScheme, L: Layout, v: View, o: DrawOpts) {
  const T = toScreen(v, W, H);
  const { w: cw, h: ch } = L.canvas;
  g.fillStyle = '#ececec'; g.fillRect(0, 0, W, H);
  const c0 = T([0, 0]), c1 = T([cw, ch]);
  const rx = c0[0], ry = c1[1], rw = c1[0] - c0[0], rh = c0[1] - c1[1];
  g.fillStyle = s.color || '#fafafa'; g.fillRect(rx, ry, rw, rh);
  // 참조선 격자
  if (o.grid !== false && s.guideW > 0 && s.guideH > 0) {
    const gw = s.guideW * v.scale, gh = s.guideH * v.scale;
    if (gw >= 6 && gh >= 6) {
      g.strokeStyle = '#ebebeb'; g.lineWidth = 1; g.beginPath();
      for (let x = s.guideW; x < cw; x += s.guideW) { const X = Math.round(T([x, 0])[0]) + 0.5; g.moveTo(X, ry); g.lineTo(X, ry + rh); }
      for (let y = s.guideH; y < ch; y += s.guideH) { const Y = Math.round(T([0, y])[1]) + 0.5; g.moveTo(rx, Y); g.lineTo(rx + rw, Y); }
      g.stroke();
    }
  }
  // 타일 (캔버스 안으로 자른 뒤라 그대로)
  g.save();
  g.beginPath(); g.rect(rx, ry, rw, rh); g.clip();
  const faded = (p: Placed) => !!o.editId && (p.node !== o.editId || p.i !== 0 || p.j !== 0);
  for (const p of L.placed) {
    const scr = p.poly.map(T);
    g.globalAlpha = faded(p) ? 0.35 : 1;
    fillTile(g, p, scr, v, W, H, o.images);
    // 줄눈 — 경계 가운데 선(폭 = 줄눈), 없으면 얇은 윤곽
    path(g, scr);
    if (p.gap > 0) { g.strokeStyle = p.gapColor; g.lineWidth = Math.max(0.6, p.gap * v.scale); g.lineJoin = 'miter'; g.stroke(); }
    else { g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 0.6; g.stroke(); }
    if (o.editId && p.node === o.editId && p.i === 0 && p.j === 0) { path(g, scr); g.fillStyle = 'rgba(64,128,230,0.28)'; g.fill(); }
  }
  g.globalAlpha = 1;
  g.restore();
  if (o.guides === false) return;
  // 캔버스 점선
  g.save(); g.setLineDash([6, 4]); g.strokeStyle = '#a8a8a8'; g.lineWidth = 1; g.strokeRect(rx + 0.5, ry + 0.5, rw, rh); g.restore();
  // 원점 축 — 편집 중이면 포설 방식 시작점·각도 기준
  const ep = o.editId ? s.nodes.find((n) => n.id === o.editId && n.kind === 'paving') : undefined;
  const sc = L.scope;
  const org: V2 = ep && ep.kind === 'paving' ? [num(ep.sx, sc), num(ep.sy, sc)] : [0, 0];
  const ang = ep && ep.kind === 'paving' ? (num(ep.angle, sc) * Math.PI) / 180 : 0;
  const O = T(org), big = Math.max(W, H) * 2;
  // 화면 방향: 월드 x축 (cos, sin) → (cos, −sin), 월드 y축 (−sin, cos) → (−sin, −cos)
  const ax: V2 = [Math.cos(ang), -Math.sin(ang)], ay: V2 = [-Math.sin(ang), -Math.cos(ang)];
  g.lineWidth = 1.2;
  g.strokeStyle = '#3cb371'; g.beginPath(); g.moveTo(O[0], O[1]); g.lineTo(O[0] + ax[0] * big, O[1] + ax[1] * big); g.stroke();
  g.save(); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(O[0], O[1]); g.lineTo(O[0] - ax[0] * big, O[1] - ax[1] * big); g.stroke(); g.restore();
  g.strokeStyle = '#e8553d'; g.beginPath(); g.moveTo(O[0], O[1]); g.lineTo(O[0] + ay[0] * big, O[1] + ay[1] * big); g.stroke();
  g.save(); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(O[0], O[1]); g.lineTo(O[0] - ay[0] * big, O[1] - ay[1] * big); g.stroke(); g.restore();
  if (o.showSel !== false) drawSelection(g, s, L, v, W, H, o);
}

/** 선택 표시 — 타일은 외곽선, 포설 방식은 둘레 사각형 + 시작점 원 + u·v 화살표 */
function drawSelection(g: CanvasRenderingContext2D, s: PvScheme, L: Layout, v: View, W: number, H: number, o: DrawOpts) {
  const T = toScreen(v, W, H), sc = L.scope;
  for (const id of o.selIds) {
    const top = s.nodes.find((n) => n.id === id);
    const mine = L.placed.filter((p) => (top ? p.node === id : p.tile === id && p.i === 0 && p.j === 0));
    g.strokeStyle = '#2f80ed'; g.lineWidth = 1.6;
    if (top?.kind === 'paving') {
      if (mine.length) {
        const b = bounds(mine.flatMap((p) => p.poly));
        const a = T([b.x0, b.y1]), c = T([b.x1, b.y0]);
        g.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]);
      }
      const S: V2 = [num(top.sx, sc), num(top.sy, sc)], ang = num(top.angle, sc);
      const rotv = ([x, y]: V2): V2 => { const r = (ang * Math.PI) / 180; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; };
      const U = rotv([num(top.u.x, sc), num(top.u.y, sc)]), Vv = rotv([num(top.v.x, sc), num(top.v.y, sc)]);
      const arrow = (D: V2, label: string) => {
        if (Math.hypot(D[0], D[1]) < 1e-9) return;
        const A = T(S), B = T([S[0] + D[0], S[1] + D[1]]);
        g.save(); g.setLineDash([4, 3]); g.strokeStyle = '#333'; g.lineWidth = 1; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); g.restore();
        const ang2 = Math.atan2(B[1] - A[1], B[0] - A[0]);
        g.fillStyle = '#fff'; g.strokeStyle = '#333'; g.beginPath();
        g.moveTo(B[0], B[1]); g.lineTo(B[0] - 9 * Math.cos(ang2 - 0.4), B[1] - 9 * Math.sin(ang2 - 0.4)); g.lineTo(B[0] - 9 * Math.cos(ang2 + 0.4), B[1] - 9 * Math.sin(ang2 + 0.4)); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#333'; g.font = '12px sans-serif'; g.fillText(label, (A[0] + B[0]) / 2 + 4, (A[1] + B[1]) / 2 - 4);
      };
      arrow(U, 'u'); arrow(Vv, 'v');
      const A = T(S); g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 1.5; g.beginPath(); g.arc(A[0], A[1], 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
    } else {
      for (const p of mine) { path(g, p.poly.map(T)); g.stroke(); }
      const t = top?.kind === 'tile' ? top : undefined;
      if (t) { const A = T([num(t.x, sc), num(t.y, sc)]); g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 1.5; g.beginPath(); g.arc(A[0], A[1], 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); }
    }
  }
}

/** 노드의 화면 둘레 사각형 (떠 있는 메뉴 자리) — 포설 방식은 시작 단위(0,0) 기준(쿠지알러처럼 시작점 옆에 메뉴) */
export function nodeScreenBox(L: Layout, id: string, isTop: boolean, v: View, W: number, H: number) {
  const unit = L.placed.filter((p) => p.node === id && p.i === 0 && p.j === 0);
  const mine = isTop ? (unit.length ? unit : L.placed.filter((p) => p.node === id)) : L.placed.filter((p) => p.tile === id && p.i === 0 && p.j === 0);
  if (!mine.length) return null;
  const b = bounds(mine.flatMap((p) => p.poly));
  const T = toScreen(v, W, H), a = T([b.x0, b.y1]), c = T([b.x1, b.y0]);
  return { x0: a[0], y0: a[1], x1: c[0], y1: c[1] };
}

/** 이미지가 다 불려 올 때까지 기다린 뒤 썸네일(JPEG dataURL) — 캔버스 전체, 긴 변 px */
export async function renderThumb(s: PvScheme, images: ImgCache, px = 480, opt?: { grid?: boolean; view?: View; w?: number; h?: number }): Promise<string> {
  const L = layoutScheme(s);
  const srcs = [...new Set(L.placed.map((p) => p.sprite?.img).filter((x): x is string => !!x))];
  await Promise.all(srcs.map((src) => new Promise<void>((res) => {
    const e = images.get(src);
    if (e && e !== 'loading') { res(); return; }
    let left = 200;
    const tick = () => { const x = images.get(src); if ((x && x !== 'loading') || --left < 0) res(); else setTimeout(tick, 50); };
    if (!e) ensureImage(images, src, () => {});
    tick();
  })));
  const ratio = L.canvas.w / L.canvas.h;
  const W = opt?.w ?? (ratio >= 1 ? px : Math.round(px * ratio)), H = opt?.h ?? (ratio >= 1 ? Math.round(px / ratio) : px);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const v = opt?.view ?? fitView(L.canvas, W, H, 0);
  // 썸네일은 패턴 변환을 새 캔버스 기준으로 다시 만든다
  const local: ImgCache = new Map();
  for (const [k, e] of images) if (e !== 'loading' && e !== 'error') local.set(k, { img: e.img, pattern: null, avg: e.avg });
  drawScheme(g, W, H, s, L, v, { images: local, selIds: [], showSel: false, grid: opt?.grid ?? false, guides: false });
  try { return c.toDataURL('image/jpeg', 0.86); } catch {
    // 다른 출처 이미지로 캔버스가 막히면(CORS) 이미지 없이 회색으로 다시
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    drawScheme(c2.getContext('2d')!, W, H, s, L, v, { images: new Map(), selIds: [], showSel: false, grid: false, guides: false });
    return c2.toDataURL('image/jpeg', 0.86);
  }
}
