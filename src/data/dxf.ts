import type { ProfileShape } from './contentLibrary';

/**
 * DXF → 몰딩 프로파일 단면 (쿠지알러 ‘线条轮廓’ 업로드: DXF 파일, 5MB 이하).
 * ENTITIES 의 LWPOLYLINE·POLYLINE(VERTEX)·LINE·ARC·CIRCLE 을 읽어 닫힌 윤곽을 만들고,
 * 그중 면적이 가장 큰 윤곽을 단면으로 쓴다. 원호(bulge·ARC)는 10° 간격으로 나눈다.
 * 결과는 좌하단 (0,0) 기준 mm, 반시계 방향.
 */

type Pt = [number, number];
type Pair = [number, string];

/** $INSUNITS → mm 배율 (0 = 단위 없음은 mm 로 본다) */
const UNIT_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
const STEP = Math.PI / 18;

function pairs(text: string): Pair[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

/** p1 → p2 구간을 bulge(= tan(사잇각/4))만큼 휜 원호로 나눈 점들 (p1 제외, p2 포함) */
function bulgePoints(p1: Pt, p2: Pt, bulge: number): Pt[] {
  if (!bulge) return [p2];
  const theta = 4 * Math.atan(bulge);
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const c = Math.hypot(dx, dy);
  if (c < 1e-9) return [p2];
  const r = c / (2 * Math.sin(Math.abs(theta) / 2));
  // 현의 중점에서 중심까지 (bulge 양수 = 반시계로 휨 → 중심은 진행 방향 왼쪽)
  const h = r * Math.cos(theta / 2) * Math.sign(bulge);
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const cx = mx - (dy / c) * h, cy = my + (dx / c) * h;
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const n = Math.max(1, Math.ceil(Math.abs(theta) / STEP));
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    const a = a0 + (theta * k) / n;
    out.push(k === n ? p2 : [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function arcPoints(cx: number, cy: number, r: number, startDeg: number, endDeg: number): Pt[] {
  const a0 = (startDeg * Math.PI) / 180;
  let a1 = (endDeg * Math.PI) / 180;
  while (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(1, Math.ceil((a1 - a0) / STEP));
  return Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos(a0 + ((a1 - a0) * k) / n), cy + r * Math.sin(a0 + ((a1 - a0) * k) / n)] as Pt);
}

function polyline(vs: { p: Pt; bulge: number }[], closed: boolean): Pt[] {
  if (!vs.length) return [];
  const out: Pt[] = [vs[0].p];
  for (let i = 0; i < vs.length - (closed ? 0 : 1); i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    out.push(...bulgePoints(a.p, b.p, a.bulge));
  }
  if (closed) out.pop(); // 마지막 점 = 첫 점
  return out;
}

const area = (pts: Pt[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const near = (a: Pt, b: Pt, tol: number) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

/** 낱개 선·호를 끝점끼리 이어 닫힌 고리로 */
function chain(segs: Pt[][], tol: number): Pt[][] {
  const left = segs.slice();
  const loops: Pt[][] = [];
  while (left.length) {
    let cur = left.shift()!.slice();
    let grown = true;
    while (grown && !near(cur[0], cur[cur.length - 1], tol)) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const end = cur[cur.length - 1];
        if (near(end, s[0], tol)) cur = [...cur, ...s.slice(1)];
        else if (near(end, s[s.length - 1], tol)) cur = [...cur, ...s.slice(0, -1).reverse()];
        else continue;
        left.splice(i, 1); grown = true; break;
      }
    }
    if (cur.length > 3 && near(cur[0], cur[cur.length - 1], tol)) loops.push(cur.slice(0, -1));
  }
  return loops;
}

export function parseDxfProfile(text: string): ProfileShape {
  const ps = pairs(text);
  let scale = 1;
  const unit = ps.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (unit >= 0) scale = UNIT_MM[Number(ps[unit + 1]?.[1])] ?? 1;

  const start = ps.findIndex(([c, v], i) => c === 0 && v === 'SECTION' && ps[i + 1]?.[0] === 2 && ps[i + 1][1] === 'ENTITIES');
  if (start < 0) throw new Error('DXF 에 ENTITIES 구역이 없습니다');
  const loops: Pt[][] = [];
  const segs: Pt[][] = [];
  let i = start + 2;
  const num = (v: string) => Number(v) * scale;
  while (i < ps.length && !(ps[i][0] === 0 && ps[i][1] === 'ENDSEC')) {
    const type = ps[i][1];
    const body: Pair[] = [];
    i++;
    while (i < ps.length && ps[i][0] !== 0) body.push(ps[i++]);
    const get = (code: number) => body.find(([c]) => c === code)?.[1];
    if (type === 'LWPOLYLINE') {
      const closed = (Number(get(70) ?? 0) & 1) === 1;
      const vs: { p: Pt; bulge: number }[] = [];
      for (const [c, v] of body) {
        if (c === 10) vs.push({ p: [num(v), 0], bulge: 0 });
        else if (c === 20 && vs.length) vs[vs.length - 1].p[1] = num(v);
        else if (c === 42 && vs.length) vs[vs.length - 1].bulge = Number(v);
      }
      const pts = polyline(vs, closed);
      if (closed || (pts.length > 2 && near(pts[0], pts[pts.length - 1], 1e-6))) loops.push(closed ? pts : pts.slice(0, -1));
      else segs.push(pts);
    } else if (type === 'POLYLINE') {
      const closed = (Number(get(70) ?? 0) & 1) === 1;
      const vs: { p: Pt; bulge: number }[] = [];
      while (i < ps.length && ps[i][1] === 'VERTEX') {
        i++;
        const vb: Pair[] = [];
        while (i < ps.length && ps[i][0] !== 0) vb.push(ps[i++]);
        const vget = (code: number) => vb.find(([c]) => c === code)?.[1];
        vs.push({ p: [num(vget(10) ?? '0'), num(vget(20) ?? '0')], bulge: Number(vget(42) ?? 0) });
      }
      if (ps[i]?.[1] === 'SEQEND') { i++; while (i < ps.length && ps[i][0] !== 0) i++; }
      const pts = polyline(vs, closed);
      if (closed) loops.push(pts); else segs.push(pts);
    } else if (type === 'LINE') {
      segs.push([[num(get(10) ?? '0'), num(get(20) ?? '0')], [num(get(11) ?? '0'), num(get(21) ?? '0')]]);
    } else if (type === 'ARC') {
      segs.push(arcPoints(num(get(10) ?? '0'), num(get(20) ?? '0'), num(get(40) ?? '0'), Number(get(50) ?? 0), Number(get(51) ?? 0)));
    } else if (type === 'CIRCLE') {
      loops.push(arcPoints(num(get(10) ?? '0'), num(get(20) ?? '0'), num(get(40) ?? '0'), 0, 360).slice(0, -1));
    }
  }
  const all = [...loops, ...chain(segs, 0.01 * Math.max(1, scale))].filter((l) => l.length >= 3 && Math.abs(area(l)) > 1e-6);
  if (!all.length) throw new Error('닫힌 윤곽을 찾지 못했습니다 — 단면을 닫힌 폴리선(또는 이어진 선·호)으로 그려 주세요');
  let best = all.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  if (area(best) < 0) best = best.slice().reverse();
  const minX = Math.min(...best.map((p) => p[0])), minY = Math.min(...best.map((p) => p[1]));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const points = best.map(([x, y]) => [r2(x - minX), r2(y - minY)] as Pt);
  return { w: r2(Math.max(...points.map((p) => p[0]))), h: r2(Math.max(...points.map((p) => p[1]))), points };
}

/** 단면 미리보기 이미지 (PNG dataURL) */
export function profileThumb(s: ProfileShape, px = 240): string {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, px, px);
  const pad = px * 0.12;
  const k = (px - pad * 2) / Math.max(s.w, s.h, 1);
  const ox = (px - s.w * k) / 2, oy = (px + s.h * k) / 2;
  g.beginPath();
  s.points.forEach(([x, y], i) => (i ? g.lineTo(ox + x * k, oy - y * k) : g.moveTo(ox + x * k, oy - y * k)));
  g.closePath();
  g.fillStyle = '#c9d3e3'; g.fill();
  g.lineWidth = 2; g.strokeStyle = '#2f5aa8'; g.stroke();
  return c.toDataURL('image/png');
}
