import type { V2 } from './path';

/**
 * 2D 윤곽 편집 — 점 끌기 스냅(직각 가이드).
 *  1) 수평·수직 정렬: 이웃 점(앞·뒤) → 끌기 전 자기 위치 → 다른 점 순으로, 같은 X/Y 에 붙는다.
 *     붙은 축은 그 점의 좌표 ‘수식’을 그대로 이어받아(예: #W/2) 파라메트릭 관계를 지킨다.
 *  2) 정렬이 없으면: 이웃 점에서 그 이웃의 다른 변에 수직인 선(이웃 꼭짓점이 직각) · 앞뒤 점을 지름으로 하는 원(이 점이 직각) 에 붙는다.
 *  결과에는 가이드 선과 직각 표시(꼭짓점에 작은 ㄱ)를 함께 돌려준다. 단위 mm.
 */

export interface SnapInput {
  /** 경로 점 숫자 좌표 (i 번째는 무시) */
  pts: V2[];
  /** 경로 점 좌표 수식 */
  exprs: { x: string; y: string }[];
  i: number;
  closed: boolean;
  /** 커서 위치 */
  m: V2;
  /** 스냅 거리(mm) — 화면 px / 축척 */
  tol: number;
  /** 끌기 전 이 점의 위치·수식 */
  start: { pos: V2; x: string; y: string };
}
export interface SnapOut {
  pos: V2;
  /** 이어받은 수식 (없으면 숫자로) */
  x?: string;
  y?: string;
  guides: [V2, V2][];
  /** 직각 표시 꺾은선 */
  marks: V2[][];
}

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len = (a: V2) => Math.hypot(a[0], a[1]);

export function neighbors(n: number, i: number, closed: boolean): { prev: number; next: number } {
  const prev = closed || i > 0 ? (i - 1 + n) % n : -1;
  const next = closed || i < n - 1 ? (i + 1) % n : -1;
  return { prev: prev === i ? -1 : prev, next: next === i ? -1 : next };
}

/** 꼭짓점 v 에서 a·b 로 가는 두 변이 직각이면 작은 ㄱ 표시 */
export function rightMark(v: V2, a: V2, b: V2, size: number): V2[] | null {
  const da = sub(a, v), db = sub(b, v);
  const la = len(da), lb = len(db);
  if (la < 1e-6 || lb < 1e-6) return null;
  if (Math.abs(dot(da, db)) / (la * lb) > 2e-3) return null;
  const s = Math.min(size, la * 0.4, lb * 0.4);
  const ua: V2 = [da[0] / la * s, da[1] / la * s], ub: V2 = [db[0] / lb * s, db[1] / lb * s];
  return [[v[0] + ua[0], v[1] + ua[1]], [v[0] + ua[0] + ub[0], v[1] + ua[1] + ub[1]], [v[0] + ub[0], v[1] + ub[1]]];
}

export function snapPoint(s: SnapInput): SnapOut {
  const { pts, exprs, i, closed, m, tol, start } = s;
  const n = pts.length;
  const { prev, next } = neighbors(n, i, closed);
  const others = pts.map((_, k) => k).filter((k) => k !== i && k !== prev && k !== next);
  type C = { v: number; expr: string; from: V2 };
  const cands = (axis: 0 | 1): C[] => {
    const key = axis === 0 ? 'x' : 'y';
    const list: C[] = [];
    for (const k of [prev, next]) if (k >= 0) list.push({ v: pts[k][axis], expr: exprs[k][key], from: pts[k] });
    list.push({ v: start.pos[axis], expr: start[key], from: start.pos });
    for (const k of others) list.push({ v: pts[k][axis], expr: exprs[k][key], from: pts[k] });
    return list;
  };
  const best = (axis: 0 | 1): C | null => {
    let b: C | null = null, bd = Infinity;
    for (const c of cands(axis)) {
      const d = Math.abs(m[axis] - c.v);
      if (d <= tol && d < bd - 1e-9) { b = c; bd = d; }
    }
    return b;
  };
  const bx = best(0), by = best(1);
  let pos: V2 = [bx ? bx.v : m[0], by ? by.v : m[1]];
  const guides: [V2, V2][] = [];
  if (bx) guides.push([bx.from, pos]);
  if (by) guides.push([by.from, pos]);

  if (!bx && !by) {
    // 이웃 꼭짓점을 직각으로: 이웃의 다른 변에 수직인 선 위로
    let bestD = Infinity, bestP: V2 | null = null, guide: [V2, V2] | null = null;
    for (const [nb, side] of [[prev, -1], [next, 1]] as const) {
      if (nb < 0) continue;
      const far = closed ? (nb + side + n) % n : nb + side;
      if (far < 0 || far >= n || far === i) continue;
      const u = sub(pts[nb], pts[far]);
      const lu = len(u);
      if (lu < 1e-6) continue;
      const un: V2 = [u[0] / lu, u[1] / lu];
      const d = dot(sub(m, pts[nb]), un);
      if (Math.abs(d) <= tol && Math.abs(d) < bestD) {
        bestD = Math.abs(d);
        bestP = [m[0] - d * un[0], m[1] - d * un[1]];
        guide = [pts[nb], bestP];
      }
    }
    // 이 점을 직각으로: 앞·뒤 점을 지름으로 하는 원 위로 (탈레스)
    if (prev >= 0 && next >= 0) {
      const c: V2 = [(pts[prev][0] + pts[next][0]) / 2, (pts[prev][1] + pts[next][1]) / 2];
      const r = len(sub(pts[next], pts[prev])) / 2;
      const dm = len(sub(m, c));
      const d = Math.abs(dm - r);
      if (r > 1e-6 && dm > 1e-6 && d <= tol && d < bestD) {
        bestP = [c[0] + (m[0] - c[0]) / dm * r, c[1] + (m[1] - c[1]) / dm * r];
        guide = null;
      }
    }
    if (bestP) { pos = bestP; if (guide) guides.push(guide); }
  }

  // 직각 표시 — 이 점 · 앞 점 · 뒤 점
  const marks: V2[][] = [];
  const size = tol * 1.6;
  const P = (k: number): V2 => (k === i ? pos : pts[k]);
  if (prev >= 0 && next >= 0) { const mk = rightMark(pos, P(prev), P(next), size); if (mk) marks.push(mk); }
  for (const [nb, side] of [[prev, -1], [next, 1]] as const) {
    if (nb < 0) continue;
    const far = closed ? (nb + side + n) % n : nb + side;
    if (far < 0 || far >= n || far === i) continue;
    const mk = rightMark(P(nb), P(far), pos, size);
    if (mk) marks.push(mk);
  }
  return { pos, x: bx?.expr, y: by?.expr, guides, marks };
}

/** 선 위 클릭 → 새 점 (선분에 투영). 수평·수직 선이면 그 축은 양 끝의 같은 수식을 이어받는다 */
export function pointOnSegment(a: V2, b: V2, ea: { x: string; y: string }, eb: { x: string; y: string }, m: V2): { pos: V2; x?: string; y?: string } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0.5 : Math.min(0.98, Math.max(0.02, dot(sub(m, a), ab) / l2));
  const pos: V2 = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  const out: { pos: V2; x?: string; y?: string } = { pos };
  if (Math.abs(ab[1]) < 1e-6 && ea.y === eb.y) { out.y = ea.y; pos[1] = a[1]; }
  if (Math.abs(ab[0]) < 1e-6 && ea.x === eb.x) { out.x = ea.x; pos[0] = a[0]; }
  return out;
}

/**
 * 좌표 수식을 d 만큼 옮기기 — 숫자면 숫자로, 수식이면 이동량을 더해 관계 유지.
 * 끝의 ±숫자는 합친다: "#W/2+30" 을 10 옮기면 "#W/2+40", 0 이 되면 "#W/2".
 * 조건식·비교식은 괄호로 감싼 뒤 더한다.
 */
export function shiftExpr(expr: string, d: number, fmt: (n: number) => string = (n) => String(Math.round(n * 10) / 10)): string {
  const s = expr.trim();
  if (Math.abs(d) < 1e-9) return expr;
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) return fmt(Number(s) + d);
  const m = /^(.*?)([+-])\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const base = m[1].trim();
    if (base && !/[?:<>=&|!]/.test(base) && !/[-+*/%^(,]$/.test(base)) {
      const v = (m[2] === '-' ? -1 : 1) * Number(m[3]) + d;
      const r = Number(fmt(Math.abs(v)));
      if (r === 0) return base;
      return `${base}${v > 0 ? '+' : '-'}${fmt(Math.abs(v))}`;
    }
  }
  const safe = /[?:<>=&|!]/.test(s) ? `(${s})` : s;
  if (Number(fmt(Math.abs(d))) === 0) return expr;
  return `${safe}${d > 0 ? '+' : '-'}${fmt(Math.abs(d))}`;
}
