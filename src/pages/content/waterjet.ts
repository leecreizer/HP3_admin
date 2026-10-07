import { loadImage } from './decoUtil';

/**
 * 워터젯 패턴(쿠지알러 水刀拼花) 형상 — DXF 닫힌 고리들을 영역으로 나누고(안쪽 고리는 구멍), 영역마다 채움을 그린다.
 * 좌표는 mm, 아래→위가 +y (DXF 그대로). 화면에 그릴 때만 y 를 뒤집는다.
 */

export type Pt = [number, number];
/** 영역 = 고리 하나에서 바로 안쪽 고리(구멍)들을 뺀 면 */
export type Region = { loop: number; holes: number[]; depth: number; area: number; w: number; h: number };
/** 영역 채움 — 상품(타일·재질 이미지를 실제 크기로 반복, 회전 0/90/180/270) 또는 구멍(镂空) */
export type WjFill = { kind: 'item'; id: string; name: string; img: string; L: number; W: number; rot: number } | { kind: 'hollow' };

const polyArea = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
function inside(pt: Pt, poly: Pt[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function buildRegions(loops: Pt[][]): Region[] {
  const meta = loops.map((l) => {
    const xs = l.map((p) => p[0]), ys = l.map((p) => p[1]);
    return { area: polyArea(l), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  });
  // 부모 = 이 고리를 품는 고리 중 가장 작은 것
  const parent = loops.map((l, i) => {
    let best = -1;
    loops.forEach((m, j) => {
      if (j === i || meta[j].area <= meta[i].area) return;
      if (inside(l[0], m) && (best < 0 || meta[j].area < meta[best].area)) best = j;
    });
    return best;
  });
  const depth = (i: number): number => (parent[i] < 0 ? 0 : 1 + depth(parent[i]));
  return loops.map((_, i) => {
    const holes = parent.map((p, j) => (p === i ? j : -1)).filter((j) => j >= 0);
    const holeArea = holes.reduce((s, j) => s + meta[j].area, 0);
    return { loop: i, holes, depth: depth(i), area: meta[i].area - holeArea, w: meta[i].w, h: meta[i].h };
  });
}

/** 형상이 같은 영역 (넓이·가로·세로가 1% 안) — 쿠지알러 ‘智能区域填充’ */
export function sameShape(a: Region, b: Region) {
  const close = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * 0.01 + 1e-6;
  return close(a.area, b.area) && ((close(a.w, b.w) && close(a.h, b.h)) || (close(a.w, b.h) && close(a.h, b.w)));
}

/** SVG path (y 뒤집음) — 영역 고리 + 구멍 고리, evenodd 로 채운다 */
export function regionD(loops: Pt[][], r: Region, h: number) {
  const ring = (l: Pt[]) => `M${l.map(([x, y]) => `${x.toFixed(2)} ${(h - y).toFixed(2)}`).join('L')}Z`;
  return [r.loop, ...r.holes].map((k) => ring(loops[k])).join('');
}

/** 채운 모양을 그린 PNG — 목록 썸네일·상품 이미지 */
export async function renderMedallion(loops: Pt[][], regions: Region[], fills: (WjFill | null)[], w: number, h: number, px = 480): Promise<string> {
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, px, px);
  const pad = px * 0.06;
  const k = (px - pad * 2) / Math.max(w, h, 1);
  const ox = (px - w * k) / 2, oy = (px - h * k) / 2;
  const imgs = new Map<string, HTMLImageElement | null>();
  for (const f of fills) if (f?.kind === 'item' && !imgs.has(f.img)) imgs.set(f.img, await loadImage(f.img, !f.img.startsWith('data:')).catch(() => null));
  const order = regions.map((_, i) => i).sort((a, b) => regions[a].depth - regions[b].depth);
  for (const i of order) {
    const r = regions[i], f = fills[i];
    const p = new Path2D();
    for (const li of [r.loop, ...r.holes]) { const l = loops[li]; l.forEach(([x, y], j) => (j ? p.lineTo(ox + x * k, oy + (h - y) * k) : p.moveTo(ox + x * k, oy + (h - y) * k))); p.closePath(); }
    g.save();
    g.clip(p, 'evenodd');
    if (f?.kind === 'item') {
      const im = imgs.get(f.img);
      if (im) {
        const tw = f.L * k, th = f.W * k;
        g.translate(ox, oy);
        g.rotate((f.rot * Math.PI) / 180);
        const span = Math.max(w, h) * k * 1.6;
        for (let y = -span; y < span; y += th) for (let x = -span; x < span; x += tw) g.drawImage(im, x, y, tw, th);
      } else { g.fillStyle = '#d9dde3'; g.fill(p, 'evenodd'); }
    } else if (f?.kind === 'hollow') {
      g.fillStyle = '#ffffff'; g.fill(p, 'evenodd');
    } else { g.fillStyle = '#eef0f3'; g.fill(p, 'evenodd'); }
    g.restore();
    g.save(); g.strokeStyle = '#7a8391'; g.lineWidth = 1; g.stroke(p); g.restore();
  }
  return c.toDataURL('image/png');
}

/** 형상 JSON 을 에셋(dataURL)으로 — 고리 좌표가 커서 상품 목록(localStorage)에는 넣지 않는다 */
export const geometryDataUrl = (loops: Pt[][]) => `data:application/json;base64,${btoa(JSON.stringify(loops))}`;
