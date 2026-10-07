/**
 * 몰딩/벽판 업로드 (쿠지알러 线条/墙板 · /vc/commodity/upload/fdprofile) — 계산.
 * 2026-10-07 쿠지알러 화면·번들로 확인(확인 업로드는 누르지 않음).
 * 쿠지알러는 CAD(dxf·dwg)를 서버(profile/parse/task)에서 단면으로 해석하지만 HP3 는 DXF 를 화면에서 읽는다.
 * 단면은 선분·원호 ‘구간’을 그대로 남긴다 — 덧붙임 재질을 구간마다 붙이기 때문(쿠지알러 curvesWithTexture = 구간 번호 범위).
 */

export type LwPt = [number, number];
/** 구간 — 점 번호 a → b, bulge = tan(사잇각/4) (0·없음 = 직선, 양수 = 반시계로 휨) */
export type LwSeg = { a: number; b: number; bulge?: number };
/** 단면 — 왼쪽 아래 (0,0) mm, 반시계 */
export type LwShape = { points: LwPt[]; segs: LwSeg[]; w: number; h: number };
export type LwMode = 'fit' | 'tile';
/** 덧붙임 재질 — 구간 번호 범위 [start, end] (쿠지알러 needStretch: 맞춤 0 · 평붙임 1) */
export type LwAttach = { start: number; end: number; mat: { id: string; name: string; img: string }; mode: LwMode };

/** 제품 유형 — 쿠지알러 g_profileCats (화면 순서). 벽판만 wallboard, 나머지는 molding */
export const LW_TYPES: { code: number; name: string; zh: string }[] = [
  { code: 260, name: '걸레받이', zh: '踢脚线' },
  { code: 401, name: '코너 몰딩', zh: '角线' },
  { code: 615, name: '장식 몰딩', zh: '装饰线条' },
  { code: 613, name: '일체형 벽판', zh: '集成墙板' },
  { code: 3196, name: '외부 모서리 몰딩', zh: '阳角线' },
];
export const LW_WALLBOARD = 613;
export const LW_EXPOSED = 3196;
export const isWallboard = (code: number | null | undefined) => code === LW_WALLBOARD;

/** 쿠지알러 해석 실패 창의 ‘파일 요건’ */
export const LW_FILE_RULES = ['단일 닫힌 윤곽만 지원합니다', '원호와 직선만 지원합니다', '선 길이는 1mm 보다 길어야 합니다', '선 길이는 20m 보다 짧아야 합니다'];
/** 업로드 상자 ? 설명 (쿠지알러 그대로) */
export const LW_UPLOAD_TIPS = [
  '1. 조형의 CAD 단면도를 주세요 — 바깥 닫힌 윤곽선만, 안쪽 구조는 필요 없습니다.',
  '2. 직선과 원호로 그린 닫힌 도형.',
  '3. 선 하나의 길이는 1mm 보다 작으면 안 됩니다.',
  '4. 덧붙임 재질이 필요한 단면 선분의 시작점과 끝점에 끊는 점을 넣으세요.',
];

/* ───────────────────────── DXF → 구간 ───────────────────────── */

type Pair = [number, string];
type RawSeg = { p0: LwPt; p1: LwPt; bulge: number };
const UNIT_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
/** 그리기 요소가 아닌 것 — 무시 (글자·치수·해치·블록 삽입 등) */
const IGNORE = new Set(['TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'INSERT', 'POINT', 'LEADER', 'MLEADER', 'ATTDEF', 'ATTRIB', 'VIEWPORT', 'SOLID', 'WIPEOUT', 'IMAGE', 'TOLERANCE', 'ACAD_TABLE', 'XLINE', 'RAY']);

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

/** 원호 구간의 반지름·사잇각 */
export function arcInfo(p0: LwPt, p1: LwPt, bulge: number) {
  const c = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const theta = 4 * Math.atan(bulge);
  const r = Math.abs(c / (2 * Math.sin(theta / 2)));
  return { c, theta, r, len: Math.abs(theta) * r };
}
/** 구간 길이 (직선 = 현, 원호 = 호 길이) */
export const segLength = (p0: LwPt, p1: LwPt, bulge?: number) => (bulge ? arcInfo(p0, p1, bulge).len : Math.hypot(p1[0] - p0[0], p1[1] - p0[1]));

/** 원호 구간을 나눈 점 (p0 제외, p1 포함) — 최대 10° 간격 */
export function bulgePts(p0: LwPt, p1: LwPt, bulge?: number, step = Math.PI / 18): LwPt[] {
  if (!bulge) return [p1];
  const { c, theta, r } = arcInfo(p0, p1, bulge);
  if (c < 1e-12) return [p1];
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
  const ux = (p1[0] - p0[0]) / c, uy = (p1[1] - p0[1]) / c;
  // 현 중점에서 중심까지 — bulge 양수(반시계로 휨)면 중심은 진행 방향 왼쪽
  const d = r * Math.cos(theta / 2) * Math.sign(bulge);
  const cx = mx - uy * d, cy = my + ux * d;
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  const n = Math.max(1, Math.ceil(Math.abs(theta) / step));
  const out: LwPt[] = [];
  for (let i = 1; i < n; i++) { const t = a0 + (theta * i) / n; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  out.push(p1);
  return out;
}

/** 단면 → 꺾은선 (원호를 나눔) — 썸네일·몰딩 단면(profile) 용 */
export function flatten(s: Pick<LwShape, 'points' | 'segs'>): LwPt[] {
  const out: LwPt[] = [];
  for (const g of s.segs) { if (!out.length) out.push(s.points[g.a]); out.push(...bulgePts(s.points[g.a], s.points[g.b], g.bulge)); }
  out.pop(); // 닫힌 윤곽 — 마지막 = 처음
  return out;
}
const areaOf = (p: LwPt[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** DXF 요소 읽기 — 직선·원호·폴리선·원. 타원·스플라인이 있으면 오류(쿠지알러: 원호와 직선만) */
function readSegs(text: string): RawSeg[] {
  const ps = pairs(text);
  let unit = 1;
  const iu = ps.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  if (iu >= 0) { const u = ps.slice(iu + 1, iu + 4).find(([c]) => c === 70); if (u) unit = UNIT_MM[Number(u[1])] ?? 1; }
  const start = ps.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
  if (start < 0) throw new Error('DXF 에 ENTITIES 구역이 없습니다');
  const segs: RawSeg[] = [];
  let i = start + 1;
  const ents: { type: string; data: Pair[] }[] = [];
  while (i < ps.length) {
    const [c, v] = ps[i];
    if (c === 0 && v === 'ENDSEC') break;
    if (c === 0) {
      const data: Pair[] = [];
      let j = i + 1;
      while (j < ps.length && ps[j][0] !== 0) data.push(ps[j++]);
      ents.push({ type: v, data });
      i = j;
    } else i++;
  }
  const get = (d: Pair[], code: number) => { const p = d.find(([c]) => c === code); return p ? Number(p[1]) : undefined; };
  const mirror = (d: Pair[]) => (get(d, 230) ?? 1) < 0;
  const pt = (x: number, y: number, m: boolean): LwPt => [(m ? -x : x) * unit, y * unit];
  for (let k = 0; k < ents.length; k++) {
    const { type, data } = ents[k];
    const m = mirror(data);
    if (type === 'LINE') segs.push({ p0: pt(get(data, 10) ?? 0, get(data, 20) ?? 0, false), p1: pt(get(data, 11) ?? 0, get(data, 21) ?? 0, false), bulge: 0 });
    else if (type === 'ARC') {
      const cx = get(data, 10) ?? 0, cy = get(data, 20) ?? 0, r = get(data, 40) ?? 0;
      const a0 = ((get(data, 50) ?? 0) * Math.PI) / 180, a1 = ((get(data, 51) ?? 0) * Math.PI) / 180;
      let sweep = a1 - a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      const p0 = pt(cx + r * Math.cos(a0), cy + r * Math.sin(a0), m), p1 = pt(cx + r * Math.cos(a1), cy + r * Math.sin(a1), m);
      // ARC 는 늘 반시계 — 거울 좌표면 도는 방향이 바뀐다
      segs.push({ p0, p1, bulge: (m ? -1 : 1) * Math.tan(sweep / 4) });
    } else if (type === 'CIRCLE') {
      const cx = get(data, 10) ?? 0, cy = get(data, 20) ?? 0, r = get(data, 40) ?? 0;
      const A = pt(cx + r, cy, m), B = pt(cx - r, cy, m);
      segs.push({ p0: A, p1: B, bulge: 1 }, { p0: B, p1: A, bulge: 1 });
    } else if (type === 'LWPOLYLINE') {
      const closed = ((get(data, 70) ?? 0) & 1) === 1;
      const vs: { p: LwPt; b: number }[] = [];
      for (const [c, v] of data) {
        if (c === 10) vs.push({ p: [Number(v), 0], b: 0 });
        else if (c === 20 && vs.length) vs[vs.length - 1].p[1] = Number(v);
        else if (c === 42 && vs.length) vs[vs.length - 1].b = Number(v);
      }
      const P = vs.map((x) => ({ p: pt(x.p[0], x.p[1], m), b: m ? -x.b : x.b }));
      for (let t = 0; t + 1 < P.length; t++) segs.push({ p0: P[t].p, p1: P[t + 1].p, bulge: P[t].b });
      if (closed && P.length > 1) segs.push({ p0: P[P.length - 1].p, p1: P[0].p, bulge: P[P.length - 1].b });
    } else if (type === 'POLYLINE') {
      const closed = ((get(data, 70) ?? 0) & 1) === 1;
      const P: { p: LwPt; b: number }[] = [];
      let q = k + 1;
      for (; q < ents.length && ents[q].type === 'VERTEX'; q++) { const d = ents[q].data; P.push({ p: pt(get(d, 10) ?? 0, get(d, 20) ?? 0, m), b: (m ? -1 : 1) * (get(d, 42) ?? 0) }); }
      if (q < ents.length && ents[q].type === 'SEQEND') q++;
      for (let t = 0; t + 1 < P.length; t++) segs.push({ p0: P[t].p, p1: P[t + 1].p, bulge: P[t].b });
      if (closed && P.length > 1) segs.push({ p0: P[P.length - 1].p, p1: P[0].p, bulge: P[P.length - 1].b });
      k = q - 1;
    } else if (type === 'ELLIPSE' || type === 'SPLINE') throw new Error(LW_FILE_RULES[1]);
    else if (!IGNORE.has(type) && type !== 'VERTEX' && type !== 'SEQEND') {
      // 그 밖의 그리기 요소는 단면으로 볼 수 없다
      throw new Error(`${LW_FILE_RULES[1]} (${type})`);
    }
  }
  return segs.filter((s) => Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]) > 1e-9 || s.bulge);
}

/** 구간들을 이어 하나의 닫힌 윤곽으로 — 남는 구간·열린 끝이 있으면 오류(쿠지알러: 단일 닫힌 윤곽만) */
function chainOne(segs: RawSeg[], tol: number): RawSeg[] {
  if (!segs.length) throw new Error('단면 윤곽을 찾지 못했습니다');
  const near = (a: LwPt, b: LwPt) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  const left = segs.slice(1);
  const loop: RawSeg[] = [segs[0]];
  while (!near(loop[loop.length - 1].p1, loop[0].p0)) {
    const end = loop[loop.length - 1].p1;
    const k = left.findIndex((s) => near(s.p0, end) || near(s.p1, end));
    if (k < 0) throw new Error(LW_FILE_RULES[0]);
    const s = left.splice(k, 1)[0];
    loop.push(near(s.p0, end) ? s : { p0: s.p1, p1: s.p0, bulge: -s.bulge });
  }
  if (left.length) throw new Error(LW_FILE_RULES[0]);
  return loop;
}

/** 단면 만들기 — 원점 (0,0) 왼쪽 아래로 옮기고 반시계로, 구간 길이 검사(1mm 초과·20m 미만) */
export function buildShape(loop: { p0: LwPt; bulge: number }[]): LwShape {
  for (let i = 0; i < loop.length; i++) {
    const p0 = loop[i].p0, p1 = loop[(i + 1) % loop.length].p0, L = segLength(p0, p1, loop[i].bulge);
    if (L <= 1) throw new Error(LW_FILE_RULES[2]);
    if (L >= 20000) throw new Error(LW_FILE_RULES[3]);
  }
  let pts = loop.map((s) => s.p0);
  let segs: LwSeg[] = loop.map((s, i) => ({ a: i, b: (i + 1) % loop.length, ...(s.bulge ? { bulge: s.bulge } : {}) }));
  if (areaOf(flatten({ points: pts, segs })) < 0) {
    // 시계 방향이면 뒤집는다 — 점 순서와 구간 순서를 거꾸로, 휨 방향도 반대로
    const n = pts.length;
    const rev: LwPt[] = pts.map((_, i) => pts[(n - i) % n]);
    const bul = loop.map((s) => s.bulge);
    segs = rev.map((_, i) => { const b = bul[(n - 1 - i + n) % n]; return { a: i, b: (i + 1) % n, ...(b ? { bulge: -b } : {}) }; });
    pts = rev;
  }
  const fl = flatten({ points: pts, segs });
  const x0 = Math.min(...fl.map((p) => p[0])), y0 = Math.min(...fl.map((p) => p[1]));
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  const points = pts.map(([x, y]) => [r2(x - x0), r2(y - y0)] as LwPt);
  const fl2 = flatten({ points, segs });
  return { points, segs, w: r2(Math.max(...fl2.map((p) => p[0]))), h: r2(Math.max(...fl2.map((p) => p[1]))) };
}

/** DXF 단면 해석 (쿠지알러 규칙: 단일 닫힌 윤곽 · 원호와 직선만 · 선 길이 1mm 초과 20m 미만) */
export function parseLineWallDxf(text: string): LwShape {
  const raw = readSegs(text);
  const ext = raw.reduce((m, s) => Math.max(m, Math.abs(s.p0[0]), Math.abs(s.p0[1]), Math.abs(s.p1[0]), Math.abs(s.p1[1])), 1);
  const loop = chainOne(raw, Math.max(0.01, ext * 1e-6));
  return buildShape(loop.map((s) => ({ p0: s.p0, bulge: s.bulge })));
}

/** 그린 단면 → 구간 — HP3 단면 직접 그리기. bulges(점마다 다음 점까지의 휨)가 있으면 원호 구간 그대로, 없으면 모두 직선 */
export function shapeFromPolygon(points: LwPt[], bulges?: number[]): LwShape {
  return buildShape(points.map((p, i) => ({ p0: p, bulge: bulges?.[i] ?? 0 })));
}

/* ───────────────────────── 덧붙임 재질 ───────────────────────── */

/** 구간별 덧붙임 → 범위 묶기 (쿠지알러 Yc: 번호 순, 이어지고 재질·방식이 같으면 하나로) */
export function mergeAttach(per: Map<number, { mat: LwAttach['mat']; mode: LwMode }>): LwAttach[] {
  const keys = [...per.keys()].sort((a, b) => a - b);
  const out: LwAttach[] = [];
  for (const k of keys) {
    const v = per.get(k)!;
    const last = out[out.length - 1];
    if (last && last.end + 1 === k && last.mat.id === v.mat.id && last.mode === v.mode) last.end = k;
    else out.push({ start: k, end: k, mat: v.mat, mode: v.mode });
  }
  return out;
}
/** 범위 → 구간별 */
export function expandAttach(list: LwAttach[]): Map<number, { mat: LwAttach['mat']; mode: LwMode }> {
  const m = new Map<number, { mat: LwAttach['mat']; mode: LwMode }>();
  for (const a of list) for (let k = a.start; k <= a.end; k++) m.set(k, { mat: a.mat, mode: a.mode });
  return m;
}

/* ───────────────────────── 크기 ───────────────────────── */

export type MoldingSize = { customized: boolean; length: string };
export type WallSize = { specific: boolean; specs: string[]; customized: boolean; customizedSize: string };
const intIn = (v: string, lo: number, hi: number) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi; };
/** 크기 검사 — 쿠지알러 문구 (请输入尺寸 / 请输入定制尺寸 / 请输入合法长度的定制规格) */
export function sizeError(code: number, mold: MoldingSize, wall: WallSize): string {
  if (isWallboard(code)) {
    if (!wall.specific && !wall.customized) return '크기를 입력하세요';
    if (wall.specific && (!wall.specs.length || wall.specs.some((s) => !intIn(s, 10, 6000)))) return '크기를 입력하세요 (규격 길이 10~6000mm)';
    if (wall.customized) {
      const max = wall.specific ? Math.max(10, ...wall.specs.map(Number)) : 10;
      if (!wall.customizedSize.trim()) return '맞춤 크기를 입력하세요';
      if (!intIn(wall.customizedSize, max, 20000)) return '올바른 길이의 맞춤 규격을 입력하세요';
    }
    return '';
  }
  if (!mold.customized && !intIn(mold.length, 10, 8000)) return '크기를 입력하세요 (길이 10~8000mm)';
  return '';
}
