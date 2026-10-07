import { evalExpr } from '../../../parts/formula';
import { PV_INF, PV_TILE_LIMIT, type PvClipParam, type PvMachine, type PvNode, type PvPaving, type PvScheme, type PvSprite, type PvTile } from '../../../data/paving';

/**
 * 파라메트릭 방안 계산 — 쿠지알러는 calculate API(서버)로 계산하지만 HP3 는 화면에서 계산한다.
 * 규칙(2026-10-07 쿠지알러 화면 확인):
 *  - 좌표 mm, y 위. 타일 기준점 = 왼쪽 아래, 각도 양수 = 반시계
 *  - 포설 방식: 단위(타일 묶음)를 U·V 이동 벡터로 반복. 정방향 개수 n → 0..n-1, 역방향 m → -1..-m, 무한 → 캔버스 끝까지
 *  - 결과는 캔버스(0,0)-(BBW,BBH) 로 자르고, 모서리 따기(去角砖)면 잘린 타일을 뺀다
 *  - 줄눈은 반복 간격을 바꾸지 않고 타일 경계에 그린다(그리기 쪽)
 */

export type V2 = [number, number];
export type Scope = Record<string, number>;

/** 시스템 매개변수(BBW·BBH·POSX·POSY) + 사용자 숫자·불리언 매개변수 (앞 매개변수를 뒤에서 참조 가능) */
export function schemeScope(s: PvScheme): Scope {
  const sc: Scope = { POSX: 0, POSY: 0 };
  sc.BBW = clampN(evalExpr(s.bbw, sc) ?? 10000, 1000, 100000);
  sc.BBH = clampN(evalExpr(s.bbh, sc) ?? 10000, 1000, 100000);
  for (const p of s.params) {
    if (p.type === 'NUMERIC') { const v = evalExpr(p.value, sc); if (v != null) sc[p.ref] = v; }
    else if (p.type === 'BOOL') sc[p.ref] = p.value === 'true' ? 1 : 0;
  }
  return sc;
}

const clampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** 수식 값 (실패하면 기본값) */
export const num = (expr: string | undefined, sc: Scope, dflt = 0) => evalExpr(expr, sc) ?? dflt;
const rad = (d: number) => (d * Math.PI) / 180;
/** 반시계 회전 (도) */
export const rot = ([x, y]: V2, deg: number): V2 => { const a = rad(deg), c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);

export const area = (p: V2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
export function bounds(pts: V2[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

/** A→B 현에 높이 sag 의 호 — toward 쪽으로 부푼다. 끝점 A 는 빼고 B 는 넣는다 */
export function arcTo(A: V2, B: V2, sag: number, toward: V2): V2[] {
  const c = len(sub(B, A));
  if (sag <= 1e-9 || c <= 1e-9) return [B];
  const M = mul(add(A, B), 0.5);
  let n: V2 = [-(B[1] - A[1]) / c, (B[0] - A[0]) / c];
  if ((toward[0] - M[0]) * n[0] + (toward[1] - M[1]) * n[1] < 0) n = mul(n, -1);
  const r = (c * c / 4 + sag * sag) / (2 * sag);
  const C = add(M, mul(n, sag - r));
  const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
  let a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
  const am = Math.atan2(M[1] + n[1] * sag - C[1], M[0] + n[0] * sag - C[0]);
  // a0→a1 사이에 꼭대기(am)가 오도록 방향을 고른다
  const norm = (x: number) => { while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
  const ccw = norm(am - a0) < norm(a1 - a0);
  let span = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  if (Math.abs(span) < 1e-9) span = ccw ? Math.PI * 2 : -Math.PI * 2;
  a1 = a0 + span;
  const seg = Math.max(4, Math.ceil(Math.abs(span) / (Math.PI / 24)));
  const out: V2[] = [];
  for (let i = 1; i <= seg; i++) { const t = a0 + ((a1 - a0) * i) / seg; out.push(i === seg ? B : [C[0] + r * Math.cos(t), C[1] + r * Math.sin(t)]); }
  return out;
}

/** 별 변 — 양 끝 직선 b, 가운데 호(높이 h, toward 쪽으로 부풂). P 는 빼고 Q 까지 */
function starSide(P: V2, Q: V2, b: number, h: number, toward: V2): V2[] {
  const L = len(sub(Q, P));
  if (L <= 1e-9) return [Q];
  const d = mul(sub(Q, P), 1 / L);
  const bb = Math.min(Math.max(0, b), L / 2);
  const A = add(P, mul(d, bb)), B = sub(Q, mul(d, bb));
  const out: V2[] = [];
  if (bb > 1e-9) out.push(A);
  out.push(...arcTo(A, B, h, toward));
  if (bb > 1e-9) out.push(Q);
  return out;
}

/**
 * 소재 가공 모양 외곽 (타일 기준점 = 외곽 사각형 왼쪽 아래, 반시계) — 쿠지알러 화면으로 확인한 정의.
 * 가공 없음·원래 모양 = 상품 크기 사각형
 */
export function clipOutline(m: PvMachine | null, size: [number, number], sc: Scope): V2[] {
  const [W, H] = size;
  const rect = (w: number, h: number): V2[] => [[0, 0], [w, 0], [w, h], [0, h]];
  if (!m || m.type === 'ORIGIN') return rect(W, H);
  const p = (k: PvClipParam, d: number) => num(m.params[k], sc, d);
  const cot = (deg: number) => { const t = Math.tan(rad(clampN(deg, 1, 179))); return Math.abs(t) < 1e-9 ? 0 : 1 / t; };
  switch (m.type) {
    case 'RECTANGLE': return rect(Math.max(0, p('width', 800)), Math.max(0, p('height', 400)));
    case 'HEXAGON': {
      const a = Math.max(0, p('width', 200)), h = Math.sqrt(3) * a;
      return [[a / 2, 0], [1.5 * a, 0], [2 * a, h / 2], [1.5 * a, h], [a / 2, h], [0, h / 2]];
    }
    case 'TRIANGLE': { const w = p('width', 800), h = p('height', 400); return [[0, 0], [w, 0], [h * cot(p('angle', 45)), h]]; }
    case 'PARALLELOGRAM': { const w = p('width', 600), h = p('height', 400), d = h * cot(p('angle', 63)); return [[0, 0], [w, 0], [w + d, h], [d, h]]; }
    case 'TRAPEZOID': { const w1 = p('topWidth', 150), w2 = p('bottomWidth', 450), h = p('height', 150), d = h * cot(p('angle', 45)); return [[0, 0], [w2, 0], [d + w1, h], [d, h]]; }
    case 'STAR': {
      const a = Math.max(0, p('size', 120)), b = p('straightEdge', 0), h = Math.min(p('arcHigh', 20), a / Math.sqrt(8));
      const c: V2[] = [[0, 0], [a, 0], [a, a], [0, a]], ctr: V2 = [a / 2, a / 2];
      const out: V2[] = [c[0]];
      for (let i = 0; i < 4; i++) out.push(...starSide(c[i], c[(i + 1) % 4], b, h, ctr));
      out.pop(); // 마지막 = 처음 점
      return out;
    }
    case 'ROUNDED_CORNER': {
      const a = Math.max(0, p('size', 800)), cs = Math.min(Math.max(0, p('smallSize', 120)), a / Math.sqrt(2));
      const b = p('straightEdge', 0), h = Math.min(p('arcHigh', 20), cs / Math.sqrt(8)), k = cs / Math.SQRT2;
      // 귀퉁이마다 45° 돌린 작은 별(변 c)의 1/4 을 따낸다 — 작은 별의 변은 그 귀퉁이 쪽으로 부푼 호
      const corners: V2[] = [[0, 0], [a, 0], [a, a], [0, a]];
      const dirs: [V2, V2][] = [[[0, 1], [1, 0]], [[-1, 0], [0, 1]], [[0, -1], [-1, 0]], [[1, 0], [0, -1]]];
      const out: V2[] = [];
      corners.forEach((C, i) => {
        const [din, dout] = dirs[i];
        const A = add(C, mul(din, k)), B = add(C, mul(dout, k));
        out.push(A, ...starSide(A, B, b, h, C));
      });
      return out;
    }
    case 'POLYGON': return m.polygon && m.polygon.length >= 3 ? m.polygon.map(([x, y]) => [x, y] as V2) : rect(W, H);
    default: return rect(W, H);
  }
}

/** 바깥으로 e 만큼 넓힌 다각형(줄눈 오프셋) — 꼭짓점 이등분선 방향, 지나친 뾰족 꼭짓점은 4e 까지 */
export function offsetPolygon(pts: V2[], e: number): V2[] {
  if (!e || pts.length < 3) return pts;
  const p = area(pts) < 0 ? [...pts].reverse() : pts;
  const n = p.length;
  const outN = (a: V2, b: V2): V2 => { const d = sub(b, a), l = len(d) || 1; return [d[1] / l, -d[0] / l]; };
  return p.map((cur, i) => {
    const prev = p[(i - 1 + n) % n], next = p[(i + 1) % n];
    const n1 = outN(prev, cur), n2 = outN(cur, next);
    const m: V2 = add(n1, n2); const ml = len(m);
    if (ml < 1e-9) return add(cur, mul(n1, e));
    const mm = mul(m, 1 / ml), cosv = mm[0] * n1[0] + mm[1] * n1[1];
    return add(cur, mul(mm, Math.min(e / Math.max(cosv, 1e-6), e * 4)));
  });
}

/** 볼록 사각 창(x0..x1, y0..y1)으로 자르기 — Sutherland–Hodgman */
export function clipRect(pts: V2[], x0: number, y0: number, x1: number, y1: number): V2[] {
  type Edge = (p: V2) => number;
  const planes: Edge[] = [(p) => p[0] - x0, (p) => x1 - p[0], (p) => p[1] - y0, (p) => y1 - p[1]];
  let out = pts;
  for (const f of planes) {
    if (!out.length) break;
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const A = inp[i], B = inp[(i + 1) % inp.length], fa = f(A), fb = f(B);
      if (fa >= 0) out.push(A);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
    }
  }
  return out;
}

/** 다각형 안의 점 (짝홀) */
export function inPoly([x, y]: V2, p: V2[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 소재 크기 — 첫 소재(또는 연결한 소재 매개변수) 기준 */
export function tileSprites(t: PvTile, s: PvScheme): PvSprite[] {
  if (t.spriteRef) { const p = s.params.find((x) => x.ref === t.spriteRef && x.type === 'MULTI_SPRITE'); if (p?.sprites?.length) return p.sprites; }
  return t.sprites;
}
const tileSize = (t: PvTile, s: PvScheme): [number, number] => { const sp = tileSprites(t, s)[0]; return sp ? [sp.w, sp.h] : [600, 600]; };

/** 타일 하나의 외곽 (타일 자리 기준, 회전 전) — 줄눈 오프셋 포함 */
export function tileLocalOutline(t: PvTile, s: PvScheme, sc: Scope): V2[] {
  const base = clipOutline(t.machine, tileSize(t, s), sc);
  const e = t.machine ? clampN(num(t.machine.params.expansion, sc, 0), 0, 10) : 0;
  return e ? offsetPolygon(base, e) : base;
}

/** 타일 자리 변환: 타일 좌표 → 부모 좌표 */
const placeTile = (t: PvTile, sc: Scope) => { const o: V2 = [num(t.x, sc), num(t.y, sc)], a = num(t.angle, sc); return (q: V2): V2 => add(o, rot(q, a)); };

/** 무게(비율)로 고르기 — 같은 자리에는 늘 같은 소재(시드 고정) */
function pickSprite(list: PvSprite[], seed: number): PvSprite | null {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const total = list.reduce((s, x) => s + Math.max(1, x.weight || 1), 0);
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  let r = ((h >>> 0) / 4294967296) * total;
  for (const x of list) { r -= Math.max(1, x.weight || 1); if (r < 0) return x; }
  return list[list.length - 1];
}
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

/** 배치된 타일 하나 */
export type Placed = {
  node: string; tile: string; i: number; j: number;
  /** 잘린 외곽 (월드) */
  poly: V2[];
  sprite: PvSprite | null;
  /** 재질 틀 — 상품 사각형의 왼쪽 아래(월드)·각도(도) */
  tex: { o: V2; a: number };
  gap: number; gapColor: string;
};
export type Layout = { placed: Placed[]; overflow: boolean; scope: Scope; canvas: { w: number; h: number } };

/** 개수 수식 → 정수 (INF = null) */
export function countOf(expr: string, sc: Scope): number | null {
  if (expr.trim().toUpperCase() === PV_INF) return null;
  return Math.max(0, Math.floor(num(expr, sc, 0)));
}

/** 포설 방식 단위 반복 범위 — 무한이면 캔버스를 덮는 데 필요한 만큼 */
export function pavingRange(pv: PvPaving, sc: Scope, unitPts: V2[], canvas: { w: number; h: number }) {
  const U: V2 = [num(pv.u.x, sc), num(pv.u.y, sc)], V: V2 = [num(pv.v.x, sc), num(pv.v.y, sc)];
  const S: V2 = [num(pv.sx, sc), num(pv.sy, sc)], ang = num(pv.angle, sc);
  const cu = { pos: countOf(pv.u.pos, sc), neg: countOf(pv.u.neg, sc) };
  const cv = { pos: countOf(pv.v.pos, sc), neg: countOf(pv.v.neg, sc) };
  // 캔버스 네 귀를 포설 좌표로 옮겨 (단위 외곽 귀를 뺀 뒤) U·V 계수 범위를 구한다
  const cornersW: V2[] = [[0, 0], [canvas.w, 0], [canvas.w, canvas.h], [0, canvas.h]];
  const cornersL = cornersW.map((c) => rot(sub(c, S), -ang));
  const ub = unitPts.length ? bounds(unitPts) : { x0: 0, y0: 0, x1: 0, y1: 0 };
  const unitC: V2[] = [[ub.x0, ub.y0], [ub.x1, ub.y0], [ub.x1, ub.y1], [ub.x0, ub.y1]];
  const det = U[0] * V[1] - U[1] * V[0];
  const uz = len(U) < 1e-9, vz = len(V) < 1e-9;
  let iMin = 0, iMax = 0, jMin = 0, jMax = 0;
  const diffs: V2[] = [];
  for (const c of cornersL) for (const u of unitC) diffs.push(sub(c, u));
  if (!uz && !vz && Math.abs(det) > 1e-9) {
    const coef = diffs.map(([x, y]) => [(x * V[1] - y * V[0]) / det, (U[0] * y - U[1] * x) / det] as V2);
    const b = bounds(coef);
    iMin = Math.floor(b.x0) - 1; iMax = Math.ceil(b.x1) + 1; jMin = Math.floor(b.y0) - 1; jMax = Math.ceil(b.y1) + 1;
  } else {
    // 한 방향만(또는 평행) — 각 벡터 방향 투영으로 범위
    const along = (D: V2) => { const l2 = D[0] * D[0] + D[1] * D[1]; const t = diffs.map(([x, y]) => (x * D[0] + y * D[1]) / l2); return [Math.floor(Math.min(...t)) - 1, Math.ceil(Math.max(...t)) + 1]; };
    if (!uz) [iMin, iMax] = along(U);
    if (!vz) [jMin, jMax] = along(V);
  }
  // 이동 벡터가 0 이면 모두 같은 자리 — 하나만
  const lim = (cnt: { pos: number | null; neg: number | null }, lo: number, hi: number, zero: boolean): [number, number] =>
    (zero ? [0, 0] : [cnt.neg == null ? lo : -cnt.neg, cnt.pos == null ? hi : cnt.pos - 1]);
  const [i0, i1] = lim(cu, iMin, iMax, uz);
  const [j0, j1] = lim(cv, jMin, jMax, vz);
  return { U, V, S, ang, i0, i1, j0, j1 };
}

/** 방안 전체 배치 — 캔버스로 자르고, 모서리 따기면 잘린 타일을 뺀다. 타일 수가 제한을 넘으면 overflow */
export function layoutScheme(s: PvScheme, opt?: { only?: string }): Layout {
  const sc = schemeScope(s);
  const canvas = { w: sc.BBW, h: sc.BBH };
  const placed: Placed[] = [];
  let overflow = false;
  const push = (node: string, t: PvTile, i: number, j: number, toWorld: (q: V2) => V2, local: V2[], texRot: number, gap: number, gapColor: string, cornerCut: boolean, seedBase: number) => {
    if (placed.length >= PV_TILE_LIMIT) { overflow = true; return; }
    const full = local.map(toWorld);
    const poly = clipRect(full, 0, 0, canvas.w, canvas.h);
    if (poly.length < 3 || Math.abs(area(poly)) < 1e-6) return;
    if (cornerCut && Math.abs(Math.abs(area(poly)) - Math.abs(area(full))) > 1e-3 * Math.max(1, Math.abs(area(full)))) return;
    const m = t.machine;
    const texO = toWorld([m ? num(m.texX, sc) : 0, m ? num(m.texY, sc) : 0]);
    // 소재 매개변수에 연결했으면 그 매개변수의 소재(여럿이면 혼합), 아니면 다중 타일 혼합일 때만 여럿
    const list = t.spriteRef ? tileSprites(t, s) : t.multi ? t.sprites : t.sprites.slice(0, 1);
    const sprite = pickSprite(list, seedBase ^ Math.imul(i, 73856093) ^ Math.imul(j, 19349663));
    placed.push({ node, tile: t.id, i, j, poly, sprite, tex: { o: texO, a: texRot + (m ? num(m.texRot, sc) : 0) }, gap, gapColor });
  };
  for (const n of s.nodes) {
    if (opt?.only && n.id !== opt.only) continue;
    if (n.kind === 'tile') {
      const toWorld = placeTile(n, sc);
      push(n.id, n, 0, 0, toWorld, tileLocalOutline(n, s, sc), num(n.angle, sc), 0, '#000000', false, hashStr(n.id));
      continue;
    }
    const pv = n;
    const unitPts: V2[] = [];
    const locals = pv.tiles.map((t) => {
      const pl = placeTile(t, sc), local = tileLocalOutline(t, s, sc);
      unitPts.push(...local.map(pl));
      return { t, pl, local, a: num(t.angle, sc), seed: hashStr(pv.id + t.id) };
    });
    if (!locals.length) continue;
    const r = pavingRange(pv, sc, unitPts, canvas);
    const gap = Math.max(0, num(pv.gap, sc, 0));
    const gapColor = colorOf(pv.gapColor, s);
    const cornerCut = boolOf(pv.cornerCut, s, sc);
    // 반복 횟수 상한 — 이동 벡터가 아주 작으면 캔버스를 덮는 데 너무 많아진다
    let budget = PV_TILE_LIMIT * 10;
    outer: for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const off = add(mul(r.U, i), mul(r.V, j));
        for (const l of locals) {
          if (--budget < 0 || placed.length >= PV_TILE_LIMIT) { overflow = true; break outer; }
          const toWorld = (q: V2) => add(r.S, rot(add(off, l.pl(q)), r.ang));
          push(pv.id, l.t, i, j, toWorld, l.local, r.ang + l.a, gap, gapColor, cornerCut, l.seed);
        }
      }
    }
  }
  return { placed, overflow, scope: sc, canvas };
}

/** 줄눈 색 — '#rrggbb' 또는 색 매개변수 참조, 미정의 = 검정 */
export function colorOf(v: string, s: PvScheme): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const p = s.params.find((x) => x.ref === v && x.type === 'GAP_MATERIAL');
  return p && /^#[0-9a-f]{6}$/i.test(p.value) ? p.value : '#000000';
}
/** 불리언 — '1'/'true' 또는 불리언 매개변수 참조 */
export function boolOf(v: string, s: PvScheme, sc: Scope): boolean {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false' || !v) return false;
  const p = s.params.find((x) => x.ref === v && x.type === 'BOOL');
  return p ? p.value === 'true' : (evalExpr(v, sc) ?? 0) !== 0;
}

/** 노드 찾기 (포설 방식 안 타일 포함) */
export function findNode(s: PvScheme, id: string): { node: PvNode; parent: PvPaving | null } | null {
  for (const n of s.nodes) {
    if (n.id === id) return { node: n, parent: null };
    if (n.kind === 'paving') { const t = n.tiles.find((x) => x.id === id); if (t) return { node: t, parent: n }; }
  }
  return null;
}

/** 수식이 참조하는 매개변수 참조명 */
export function refsIn(expr: string | undefined): string[] {
  if (!expr) return [];
  return [...new Set((expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((w) => !/^(sin|cos|tan|sqrt|abs|round|floor|ceil|pow|min|max|INF|BBW|BBH|POSX|POSY)$/i.test(w)))];
}

/** 방안 안에서 이 참조명을 쓰는 곳 수 (삭제 막기용) */
export function countRefs(s: PvScheme, ref: string): number {
  let c = 0;
  const scan = (v: string | undefined) => { if (refsIn(v).includes(ref)) c++; };
  const scanTile = (t: PvTile) => {
    if (t.spriteRef === ref) c++;
    scan(t.x); scan(t.y); scan(t.angle);
    if (t.machine) { Object.values(t.machine.params).forEach(scan); scan(t.machine.texX); scan(t.machine.texY); scan(t.machine.texRot); }
  };
  scan(s.bbw); scan(s.bbh);
  s.params.forEach((p) => { if (p.ref !== ref && p.type === 'NUMERIC') scan(p.value); });
  for (const n of s.nodes) {
    if (n.kind === 'tile') scanTile(n);
    else {
      n.tiles.forEach(scanTile);
      [n.u.x, n.u.y, n.u.pos, n.u.neg, n.v.x, n.v.y, n.v.pos, n.v.neg, n.sx, n.sy, n.angle, n.gap].forEach(scan);
      if (n.gapColor === ref) c++;
      if (n.cornerCut === ref) c++;
    }
  }
  return c;
}
