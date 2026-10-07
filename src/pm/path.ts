import type { PathLine, PathPoint, PlankShape, PmPath, PmSlot } from './types';

/**
 * 쿠지알러 경로 문자열 ↔ 편집용 경로.
 *  plankPath  : {"path":{"paramPoints":[…],"paramPathLines":[…],"name","ignore"},"holes":[…],"slots":[…],"arrays":{}}
 *  loftPath   : {"paramPoints":[…],"paramPathLines":[…],"close":false}
 *  paramPoints: {"position":"{\"x\":\"-#W/2\",\"y\":\"-#D/2\"}","type":0,"radius":"2",…}
 * 그리고 수식 계산이 끝난 숫자 경로 → 꺾은선(둥근 모서리 · 모따기 · 원호 · 오프셋 반영).
 */

type RawPoint = { position?: string | { x?: unknown; y?: unknown }; type?: number; radius?: unknown; [k: string]: unknown };
type RawLine = { type?: number; [k: string]: unknown };
type RawPath = { paramPoints?: RawPoint[]; paramPathLines?: RawLine[]; close?: boolean; name?: string; [k: string]: unknown };

const s = (v: unknown) => (v == null ? '' : String(v));

function readPoint(p: RawPoint): PathPoint {
  let pos: { x?: unknown; y?: unknown } = {};
  try { pos = typeof p.position === 'string' ? JSON.parse(p.position) : p.position ?? {}; } catch { /* 깨진 좌표는 0 */ }
  const { position: _pos, type, radius, chamferA, chamferB, ...extra } = p;
  void _pos;
  const t = type === 1 ? 1 : type === 2 ? 2 : 0;
  const out: PathPoint = { x: s(pos.x) || '0', y: s(pos.y) || '0', type: t };
  if (radius != null && radius !== '') out.radius = s(radius);
  if (chamferA != null) out.chamferA = s(chamferA);
  if (chamferB != null) out.chamferB = s(chamferB);
  if (Object.keys(extra).length) out.extra = extra;
  return out;
}
function readLine(l: RawLine | undefined): PathLine {
  if (!l) return { type: 0 };
  const { type, radius, clockwise, minor, ...extra } = l;
  const out: PathLine = { type: type === 1 ? 1 : 0 };
  if (radius != null) out.radius = s(radius);
  if (clockwise != null) out.clockwise = !!clockwise;
  if (minor != null) out.minor = !!minor;
  if (Object.keys(extra).length) out.extra = extra;
  return out;
}
function readPath(raw: RawPath | undefined, closedDefault: boolean): PmPath {
  const points = (raw?.paramPoints ?? []).map(readPoint);
  const closed = typeof raw?.close === 'boolean' ? raw.close : closedDefault;
  const n = closed ? points.length : Math.max(0, points.length - 1);
  const lines = Array.from({ length: n }, (_, i) => readLine(raw?.paramPathLines?.[i]));
  const out: PmPath = { points, lines, closed };
  if (raw?.name && raw.name.trim() && raw.name.trim() !== '-') out.name = raw.name;
  if (raw && typeof raw.offset === 'string' && raw.offset) out.offset = raw.offset;
  return out;
}

function writePoint(p: PathPoint): RawPoint {
  const o: RawPoint = { position: JSON.stringify({ x: p.x, y: p.y }), type: p.type, ...(p.extra ?? {}) };
  if (p.type === 1) o.radius = p.radius ?? '0';
  if (p.type === 2) { o.chamferA = p.chamferA ?? '0'; o.chamferB = p.chamferB ?? '0'; }
  return o;
}
function writeLine(l: PathLine): RawLine {
  const o: RawLine = { type: l.type, ...(l.extra ?? {}) };
  if (l.type === 1) { o.radius = l.radius ?? '0'; o.clockwise = !!l.clockwise; o.minor = l.minor !== false; }
  return o;
}
function writePath(p: PmPath, withClose: boolean): RawPath {
  const o: RawPath = { paramPoints: p.points.map(writePoint), paramPathLines: p.lines.map(writeLine) };
  if (withClose) o.close = p.closed;
  if (p.name) o.name = p.name;
  if (p.offset) o.offset = p.offset;
  return o;
}

/** 평면 판재 plankPath 문자열 → 외곽 + 구멍 + 홈 */
export function parsePlankPath(json: string | undefined): PlankShape {
  let raw: { path?: RawPath; holes?: RawPath[]; slots?: unknown[]; [k: string]: unknown } = {};
  try { raw = json ? JSON.parse(json) : {}; } catch { /* 빈 경로 */ }
  const { path, holes, slots, ...rest } = raw;
  const outline = readPath(path, true);
  outline.closed = true;
  const slotList: PmSlot[] = (slots ?? []).map((x) => {
    const r = x as RawPath & { depth?: unknown; face?: unknown; path?: RawPath };
    const p = readPath(r.path ?? r, true);
    p.closed = true;
    return { path: p, depth: s(r.depth) || '5', face: r.face === 'bottom' ? 'bottom' : 'top' };
  });
  return {
    outline,
    holes: (holes ?? []).map((h) => { const p = readPath(h, true); p.closed = true; return p; }),
    slots: slotList,
    rest: Object.keys(rest).length ? rest : undefined,
  };
}

export function stringifyPlankPath(sh: PlankShape): string {
  const out: Record<string, unknown> = {
    path: { ...writePath(sh.outline, false), name: sh.outline.name ?? '- ', ignore: '' },
    holes: sh.holes.map((h) => writePath(h, false)),
    slots: sh.slots.map((x) => ({ path: writePath(x.path, false), depth: x.depth, face: x.face })),
    arrays: {},
    ...(sh.rest ?? {}),
  };
  return JSON.stringify(out);
}

/** 로프트·스윕 경로(loftPath) · 윤곽 제한(profile) 문자열 → 경로 */
export function parseLinePath(json: string | undefined, closedDefault = false): PmPath {
  let raw: RawPath = {};
  try { raw = json ? JSON.parse(json) : {}; } catch { /* 빈 경로 */ }
  return readPath(raw, closedDefault);
}
export const stringifyLinePath = (p: PmPath) => JSON.stringify(writePath(p, true));

/** 점 추가 시 선 배열 길이 맞추기 */
export function syncLines(p: PmPath): PmPath {
  const n = p.closed ? p.points.length : Math.max(0, p.points.length - 1);
  const lines = Array.from({ length: n }, (_, i) => p.lines[i] ?? { type: 0 as const });
  return { ...p, lines };
}

/* ───────────── 숫자 경로 → 꺾은선 ───────────── */

export type V2 = [number, number];
export interface NumPoint { x: number; y: number; type: 0 | 1 | 2; radius: number; a: number; b: number }
export interface NumLine { type: 0 | 1; radius: number; clockwise: boolean; minor: boolean }

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const norm = (a: V2): V2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** 원호(현 a→b, 반지름 r) 위 점들 — a 제외 b 포함 */
function arcPoints(a: V2, b: V2, r: number, clockwise: boolean, minor: boolean): V2[] {
  const c = len(sub(b, a));
  if (!(c > 1e-9) || !(r > 0)) return [b];
  const R = Math.max(r, c / 2);
  const h = Math.sqrt(Math.max(0, R * R - (c * c) / 4));
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const nx = -(b[1] - a[1]) / c, ny = (b[0] - a[0]) / c; // 진행 방향 왼쪽
  // 시계 방향 짧은 호: 중심은 진행 방향 오른쪽. 긴 호면 반대쪽
  const side = (clockwise ? -1 : 1) * (minor ? 1 : -1);
  const cx = mx + nx * h * side, cy = my + ny * h * side;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  let d = Math.atan2(b[1] - cy, b[0] - cx) - a0;
  if (clockwise) { while (d > 0) d -= 2 * Math.PI; } else { while (d < 0) d += 2 * Math.PI; }
  const steps = Math.max(4, Math.ceil(Math.abs(d) / (Math.PI / 36)));
  const out: V2[] = [];
  for (let k = 1; k <= steps; k++) { const t = a0 + (d * k) / steps; out.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); }
  out[out.length - 1] = b;
  return out;
}

/** 원호 휨값 — bulge = tan(중심각/4), 반시계 + (DXF 와 같은 표기). arcPoints 와 같은 원호 */
function arcBulge(a: V2, b: V2, r: number, clockwise: boolean, minor: boolean): number {
  const c = len(sub(b, a));
  if (!(c > 1e-9) || !(r > 0)) return 0;
  const half = Math.asin(Math.min(1, c / (2 * Math.max(r, c / 2))));
  const sweep = minor ? 2 * half : 2 * Math.PI - 2 * half;
  return Math.tan(((clockwise ? -1 : 1) * sweep) / 4);
}

type Corner = { inEnd: V2; outStart: V2; fill: V2[]; bulge: number };
const lineOf = (lines: NumLine[], i: number, n: number): NumLine => lines[(i + n) % n] ?? { type: 0, radius: 0, clockwise: false, minor: true };

/**
 * 꼭짓점마다 들어오는 끝·나가는 시작 (둥근 모서리·모따기로 깎인 위치)과 그 사이 — fill 은 펼친 점, bulge 는 그 사이 원호 휨(모따기 0).
 * 둥근 모서리·모따기는 그 꼭짓점에 닿는 두 선이 직선일 때만 적용한다.
 */
function cornersOf(pts: NumPoint[], lines: NumLine[], closed: boolean): Corner[] {
  const n = pts.length;
  const P = (i: number): V2 => [pts[(i + n) % n].x, pts[(i + n) % n].y];
  const lineAt = (i: number) => lineOf(lines, i, n);
  const corner: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const cur = P(i);
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const p = pts[i];
    const straightIn = hasPrev && lineAt(i - 1).type === 0, straightOut = hasNext && lineAt(i).type === 0;
    if (p.type !== 0 && hasPrev && hasNext && straightIn && straightOut) {
      const prev = P(i - 1), next = P(i + 1);
      const u1 = norm(sub(prev, cur)), u2 = norm(sub(next, cur));
      const l1 = len(sub(prev, cur)), l2 = len(sub(next, cur));
      if (p.type === 2 && (p.a > 0 || p.b > 0)) {
        const da = Math.min(p.a, l1), db = Math.min(p.b, l2);
        corner.push({ inEnd: [cur[0] + u1[0] * da, cur[1] + u1[1] * da], outStart: [cur[0] + u2[0] * db, cur[1] + u2[1] * db], fill: [], bulge: 0 });
        continue;
      }
      if (p.type === 1 && p.radius > 0) {
        const cosT = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
        const theta = Math.acos(cosT);
        if (theta > 1e-6 && theta < Math.PI - 1e-6) {
          let t = p.radius / Math.tan(theta / 2);
          const lim = Math.min(l1, l2) / 2;
          let r = p.radius;
          if (t > lim) { t = lim; r = t * Math.tan(theta / 2); }
          const A: V2 = [cur[0] + u1[0] * t, cur[1] + u1[1] * t], B: V2 = [cur[0] + u2[0] * t, cur[1] + u2[1] * t];
          const cross = u1[0] * u2[1] - u1[1] * u2[0];
          // A→B 방향으로 볼 때 모서리 쪽이 오른쪽이면 반시계… 꼭짓점이 바깥쪽에 오도록 짧은 호
          const cw = cross > 0;
          corner.push({ inEnd: A, outStart: B, fill: arcPoints(A, B, r, cw, true).slice(0, -1), bulge: arcBulge(A, B, r, cw, true) });
          continue;
        }
      }
    }
    corner.push({ inEnd: cur, outStart: cur, fill: [], bulge: 0 });
  }
  return corner;
}

/** 꼭짓점 처리(둥근 모서리 · 모따기)와 원호 선을 펼친 꺾은선 */
export function expandNumPath(pts: NumPoint[], lines: NumLine[], closed: boolean): V2[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => [p.x, p.y]);
  const lineAt = (i: number) => lineOf(lines, i, n);
  const corner = cornersOf(pts, lines, closed);
  const out: V2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const c = corner[i];
    if (!closed && i === 0) out.push(c.outStart);
    else { out.push(c.inEnd); out.push(...c.fill); if (c.outStart !== c.inEnd) out.push(c.outStart); }
    if (i >= segs) continue;
    const ln = lineAt(i);
    const end = corner[(i + 1) % n].inEnd;
    const start = corner[i].outStart;
    if (ln.type === 1 && ln.radius > 0) out.push(...arcPoints(start, end, ln.radius, ln.clockwise, ln.minor).slice(0, -1));
  }
  // 중복 점 제거
  const clean: V2[] = [];
  for (const p of out) { const q = clean[clean.length - 1]; if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) clean.push(p); }
  if (closed && clean.length > 2) { const a = clean[0], z = clean[clean.length - 1]; if (Math.abs(a[0] - z[0]) < 1e-7 && Math.abs(a[1] - z[1]) < 1e-7) clean.pop(); }
  return clean;
}

/**
 * expandNumPath 와 같은 닫힌 윤곽을 ‘구간’으로 — 점과, 각 점에서 다음 점까지의 휨(bulge, 직선 0).
 * 원호 선·둥근 모서리는 펼치지 않고 원호 한 구간으로 남긴다 (몰딩 단면은 구간 = 면).
 */
export function expandNumArcs(pts: NumPoint[], lines: NumLine[]): { pts: V2[]; bulges: number[] } {
  const n = pts.length;
  if (n < 2) return { pts: pts.map((p) => [p.x, p.y]), bulges: pts.map(() => 0) };
  const corner = cornersOf(pts, lines, true);
  const P: V2[] = [], B: number[] = [];
  const same = (a: V2, b: V2) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  // 같은 자리 점이 이어지면 길이 0 구간 — 앞 점에 다음 구간의 휨을 넘긴다
  const push = (p: V2, b: number) => { const q = P[P.length - 1]; if (q && same(q, p)) { B[B.length - 1] = b; return; } P.push(p); B.push(b); };
  for (let i = 0; i < n; i++) {
    const c = corner[i], ln = lineOf(lines, i, n);
    const lb = ln.type === 1 && ln.radius > 0 ? arcBulge(c.outStart, corner[(i + 1) % n].inEnd, ln.radius, ln.clockwise, ln.minor) : 0;
    if (c.outStart !== c.inEnd) push(c.inEnd, c.bulge);
    push(c.outStart, lb);
  }
  while (P.length > 2 && same(P[0], P[P.length - 1])) { P.pop(); B.pop(); }
  return { pts: P, bulges: B };
}

export const signedArea = (pts: V2[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return a / 2;
};

/** 닫힌 꺾은선 오프셋 — 양수 = 바깥쪽 (마이터 접합, 너무 뾰족하면 제한) */
export function offsetPolygon(pts: V2[], d: number): V2[] {
  if (!d || pts.length < 3) return pts;
  const ccw = signedArea(pts) > 0;
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const e1 = norm(sub(cur, prev)), e2 = norm(sub(next, cur));
    // 바깥쪽 법선: 반시계 다각형이면 진행 방향 오른쪽
    const n1: V2 = ccw ? [e1[1], -e1[0]] : [-e1[1], e1[0]];
    const n2: V2 = ccw ? [e2[1], -e2[0]] : [-e2[1], e2[0]];
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-9) { mx = n1[0]; my = n1[1]; } else { mx /= ml; my /= ml; }
    const k = Math.min(4, 1 / Math.max(0.25, mx * n1[0] + my * n1[1]));
    out.push([cur[0] + mx * d * k, cur[1] + my * d * k]);
  }
  return out;
}

export function bounds(pts: V2[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** 사각형 형상 템플릿 — 기준점(왼쪽 아래 · 가운데 …) + 폭 · 높이 (수식 그대로 조합) */
export type RectAnchor = 'lb' | 'lt' | 'rb' | 'rt' | 'c';
export function rectPath(ax: string, ay: string, w: string, h: string, anchor: RectAnchor): PmPath {
  const numeric = [ax, ay, w, h].every((e) => /^\s*[-+]?\d+(\.\d+)?\s*$/.test(e));
  if (numeric) {
    // 모두 숫자면 좌표도 숫자로 (수식 "-50/2.0" 대신 -25)
    const [x, y, ww, hh] = [ax, ay, w, h].map(Number);
    const x0 = anchor === 'c' ? x - ww / 2 : anchor === 'rb' || anchor === 'rt' ? x - ww : x;
    const y0 = anchor === 'c' ? y - hh / 2 : anchor === 'lt' || anchor === 'rt' ? y - hh : y;
    const f = (n: number) => String(Math.round(n * 1000) / 1000);
    const pts: PathPoint[] = [[x0, y0], [x0, y0 + hh], [x0 + ww, y0 + hh], [x0 + ww, y0]].map(([a, b]) => ({ x: f(a), y: f(b), type: 0 }));
    return { points: pts, lines: pts.map(() => ({ type: 0 as const })), closed: true };
  }
  const P = (e: string) => (/^[-+]?\d+(\.\d+)?$/.test(e.trim()) || /^#?[A-Za-z_][A-Za-z0-9_]*$/.test(e.trim()) ? e.trim() : `(${e})`);
  const add = (a: string, b: string, sign: 1 | -1, half = false) => {
    const bb = half ? `${P(b)}/2.0` : P(b);
    if (a.trim() === '0') return sign > 0 ? bb : `-${bb}`;
    return `${a}${sign > 0 ? '+' : '-'}${bb}`;
  };
  let x0: string, x1: string, y0: string, y1: string;
  switch (anchor) {
    case 'c': x0 = add(ax, w, -1, true); x1 = add(ax, w, 1, true); y0 = add(ay, h, -1, true); y1 = add(ay, h, 1, true); break;
    case 'lt': x0 = ax; x1 = add(ax, w, 1); y1 = ay; y0 = add(ay, h, -1); break;
    case 'rb': x1 = ax; x0 = add(ax, w, -1); y0 = ay; y1 = add(ay, h, 1); break;
    case 'rt': x1 = ax; x0 = add(ax, w, -1); y1 = ay; y0 = add(ay, h, -1); break;
    default: x0 = ax; x1 = add(ax, w, 1); y0 = ay; y1 = add(ay, h, 1);
  }
  const pt = (x: string, y: string): PathPoint => ({ x, y, type: 0 });
  return { points: [pt(x0, y0), pt(x0, y1), pt(x1, y1), pt(x1, y0)], lines: [0, 1, 2, 3].map(() => ({ type: 0 as const })), closed: true };
}
