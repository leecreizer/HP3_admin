import { Box3, BoxGeometry, BufferGeometry, Euler, ExtrudeGeometry, Float32BufferAttribute, Matrix4, Path, Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { elementDef, type ElementDef } from './defs';
import { bounds, expandNumPath, offsetPolygon, signedArea, type V2 } from './path';
import type { NumPathOut, PmEval, V3 } from './resolve';
import type { PmNode } from './types';

/**
 * 계산 결과 → 그릴 것(쿠지알러 좌표 mm).
 *  변환: 위치 · 회전(X→Y→Z 순서, 월드 축 기준) · 호출 방식(원점 / 좌후하 / 사용자 기준점) — 회전·위치는 호출점 기준.
 *  확인 근거: 교육 문서 2.1.21 (문짝 판재 윤곽 (0,0)(0,#W)(#H,#W)(#H,0) + 회전 X90 Y-90 → W×D×H 세움),
 *            2.1.21 격자 문짝 4장(회전·위치 조합)이 이 규칙으로 정확히 맞물림.
 */

export interface RenderPart {
  /** 최상위 기준 경로 키 (하위 모델 안이면 부모 id/자식 id) */
  key: string;
  /** 선택 대상(최상위 노드) id */
  nodeId: string;
  name: string;
  kind: 'solid' | 'mesh' | 'aux';
  geometry?: BufferGeometry;
  /** 보조 구조 — 선분 목록(xyz xyz …) */
  lines?: number[];
  /** 보조 구조 면(반투명) */
  fill?: BufferGeometry;
  mesh?: { asset?: string; size: V3 };
  matrix: Matrix4;
  color: string;
  texture?: string;
  /** 숨김 조건 참 — 설계 툴에서 안 보임(에디터는 ‘숨김 보기’ 켜면 흐리게) */
  hidden: boolean;
  /** 구조 탐색 눈 끔 */
  viewHidden: boolean;
  auxKind?: string;
  faces: number;
}

export interface BuildResult {
  parts: RenderPart[];
  /** 보이는 부품 경계 */
  bbox: Box3;
  /** 모델 외곽 틀 */
  frame: Box3;
}

const DEG = Math.PI / 180;
export const DEFAULT_COLOR = '#d8c5a8';

/** 회전 — 쿠지알러 ‘XYZ’ = X 먼저, 그다음 Y, Z (월드 축) = three.js Euler 'ZYX' */
export function rotationMatrix(r: V3, order: 'XYZ' | 'ZYX' = 'XYZ'): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, order === 'XYZ' ? 'ZYX' : 'XYZ'));
}

/** 위치 · 회전 · 호출점 → 행렬 (로컬 좌표 → 모델 좌표) */
export function placeMatrix(pos: V3, rot: V3, pivot: V3, order: 'XYZ' | 'ZYX' = 'XYZ'): Matrix4 {
  return new Matrix4().makeTranslation(pos[0], pos[1], pos[2])
    .multiply(rotationMatrix(rot, order))
    .multiply(new Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
}

/** 호출점 — 0 원점 · 2 좌후하(왼쪽 X 최소 · 뒤 Y 최대 · 아래 Z 최소) · 12 사용자 기준점 */
export function pivotOf(type: number, box: Box3, custom?: V3): V3 {
  if (type === 2) return [box.min.x, box.max.y, box.min.z];
  if (type === 12 && custom) return custom;
  return [0, 0, 0];
}

/* ───────────── 요소 형상 ───────────── */

export function polyOf(p: NumPathOut): V2[] {
  let pts = expandNumPath(p.points, p.lines, p.closed);
  if (p.closed && p.offset) pts = offsetPolygon(pts, p.offset);
  return pts;
}

/** 평면 판재 — XY 윤곽(+구멍)을 +Z 로 두께만큼 */
export function plankGeometry(outline: V2[], holes: V2[][], thickness: number): BufferGeometry {
  if (outline.length < 3 || !(thickness > 0) || Math.abs(signedArea(outline)) < 1e-6) return new BufferGeometry();
  const shape = new Shape(outline.map(([x, y]) => new Vector2(x, y)));
  for (const h of holes) if (h.length >= 3) shape.holes.push(new Path(h.map(([x, y]) => new Vector2(x, y))));
  return new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
}

/** 판 면의 홈 — 윤곽 안쪽에 깊이만큼 (표시용: 홈 바닥판 + 옆면) */
export function slotGeometry(poly: V2[], depth: number, thickness: number, face: 'top' | 'bottom'): BufferGeometry {
  if (poly.length < 3 || !(depth > 0)) return new BufferGeometry();
  const shape = new Shape(poly.map(([x, y]) => new Vector2(x, y)));
  const g = new ExtrudeGeometry(shape, { depth: Math.min(depth, thickness), bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, face === 'top' ? thickness - Math.min(depth, thickness) + 0.05 : -0.05);
  return g;
}

/** 단면 높이 자르기(截断高度) — v ≤ h 쪽만 남김 */
export function clipProfile(pts: V2[], h: number): V2[] {
  if (!(h > 0)) return pts;
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ina = a[1] <= h, inb = b[1] <= h;
    if (ina) out.push(a);
    if (ina !== inb) { const t = (h - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, h]); }
  }
  return out;
}

/** 단면을 목표 폭·높이로 (轮廓宽度/高度) */
export function scaleProfile(profile: V2[], w?: number, h?: number): V2[] {
  if (!(w! > 0) && !(h! > 0)) return profile;
  const b = bounds(profile);
  const pw = b.x1 - b.x0 || 1, ph = b.y1 - b.y0 || 1;
  const sx = w! > 0 ? w! / pw : 1, sy = h! > 0 ? h! / ph : 1;
  return profile.map(([x, y]) => [b.x0 + (x - b.x0) * sx, b.y0 + (y - b.y0) * sy]);
}

export const rotateProfile = (pts: V2[], deg: number): V2[] => {
  if (!deg) return pts;
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

/**
 * 스윕 · 로프트 — 단면(u = 진행 방향 왼쪽, v = 위 +Z)을 XY 경로 따라. 모서리는 마이터 접합.
 * startTilt/endTilt(도): 경사 절단 스윕의 시작·끝 면 기울기
 */
export function sweepGeometry(profile: V2[], rawPath: V2[], closed: boolean, startTilt = 0, endTilt = 0): BufferGeometry {
  const geo = new BufferGeometry();
  const path = rawPath.filter((p, i) => i === 0 || Math.abs(p[0] - rawPath[i - 1][0]) > 1e-9 || Math.abs(p[1] - rawPath[i - 1][1]) > 1e-9);
  if (closed && path.length > 2) { const a = path[0], z = path[path.length - 1]; if (Math.abs(a[0] - z[0]) < 1e-9 && Math.abs(a[1] - z[1]) < 1e-9) path.pop(); }
  const isClosed = closed && path.length >= 3;
  if (path.length < 2 || profile.length < 3) return geo;
  const prof = signedArea(profile) < 0 ? [...profile].reverse() : profile;
  const n = path.length, m = prof.length;
  const dir = (a: V2, b: V2): V2 => { const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const left = (d: V2): V2 => [-d[1], d[0]];
  const rings: number[][] = [];
  for (let i = 0; i < n; i++) {
    const hasPrev = isClosed || i > 0, hasNext = isClosed || i < n - 1;
    const prev = path[(i - 1 + n) % n], cur = path[i], next = path[(i + 1) % n];
    const tPrev = hasPrev ? dir(prev, cur) : null, tNext = hasNext ? dir(cur, next) : null;
    const nPrev = tPrev ? left(tPrev) : null, nNext = tNext ? left(tNext) : null;
    let mx: number, my: number, scale = 1;
    if (nPrev && nNext) {
      mx = nPrev[0] + nNext[0]; my = nPrev[1] + nNext[1];
      const l = Math.hypot(mx, my);
      if (l < 1e-6) { mx = nNext[0]; my = nNext[1]; } else { mx /= l; my /= l; }
      scale = Math.min(4, 1 / Math.max(0.25, mx * nNext[0] + my * nNext[1]));
    } else { const nn = (nPrev ?? nNext)!; mx = nn[0]; my = nn[1]; }
    const tilt = !isClosed && i === 0 ? startTilt : !isClosed && i === n - 1 ? endTilt : 0;
    const tan = tilt ? Math.tan(tilt * DEG) : 0;
    const t = (tNext ?? tPrev)!;
    const ring: number[] = [];
    for (const [u, v] of prof) {
      const shear = u * tan * (i === 0 ? 1 : -1);
      ring.push(cur[0] + mx * u * scale + t[0] * shear, cur[1] + my * u * scale + t[1] * shear, v);
    }
    rings.push(ring);
  }
  const pos: number[] = [];
  const P = (r: number[], k: number) => [r[k * 3], r[k * 3 + 1], r[k * 3 + 2]];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const segs = isClosed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const r0 = rings[i], r1 = rings[(i + 1) % n];
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      tri(P(r0, k), P(r1, k2), P(r1, k));
      tri(P(r0, k), P(r0, k2), P(r1, k2));
    }
  }
  if (!isClosed) {
    const faces = ShapeUtils.triangulateShape(prof.map(([x, y]) => new Vector2(x, y)), []);
    const first = rings[0], last = rings[n - 1];
    for (const [a, b, c] of faces) { tri(P(first, a), P(first, c), P(first, b)); tri(P(last, a), P(last, b), P(last, c)); }
  }
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** 격자(网格) — length×width 틀 + gridLength 간격 살, 살 두께 plankThickness, 높이 thickness. X 0..length, Y 0..width */
export function gridGeometry(length: number, width: number, thickness: number, gridLength: number, bar: number): BufferGeometry {
  if (!(length > 0 && width > 0 && thickness > 0)) return new BufferGeometry();
  const b = Math.max(1, Math.min(bar || 18, length / 2, width / 2));
  const parts: BufferGeometry[] = [];
  const box = (w: number, d: number, cx: number, cy: number) => { const g = new BoxGeometry(w, d, thickness); g.translate(cx, cy, thickness / 2); parts.push(g); };
  box(length, b, length / 2, b / 2); box(length, b, length / 2, width - b / 2);
  box(b, width - 2 * b, b / 2, width / 2); box(b, width - 2 * b, length - b / 2, width / 2);
  const step = Math.max(b * 2, gridLength || length);
  for (let x = step; x < length - b; x += step) box(b, width - 2 * b, x, width / 2);
  for (let y = step; y < width - b; y += step) box(length - 2 * b, b, length / 2, y);
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  parts.forEach((g) => g.dispose());
  return merged ?? new BufferGeometry();
}

const boxLines = (min: V3, max: V3): number[] => {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return e.flatMap(([a, b]) => [...c[a], ...c[b]]);
};
const polyLines = (pts: V3[], closed: boolean): number[] => {
  const out: number[] = [];
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) out.push(...pts[i], ...pts[(i + 1) % pts.length]);
  return out;
};

/* ───────────── 재질 ───────────── */

const PALETTE = ['#d8c5a8', '#c9a77c', '#e6dccb', '#a9a39b', '#7a5434', '#efece6', '#b9bcbf', '#d8c7a6'];
export function colorOf(id: string, product?: (id: string) => { color?: string; texture?: string } | undefined): { color: string; texture?: string } {
  const s = id.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return { color: s };
  if (/^c:[0-9a-f]{6}$/i.test(s)) return { color: `#${s.slice(2)}` };
  if (!s) return { color: DEFAULT_COLOR };
  const p = product?.(s);
  if (p?.color || p?.texture) return { color: p.color ?? '#ffffff', texture: p.texture };
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { color: PALETTE[h % PALETTE.length] };
}

/* ───────────── 조립 ───────────── */

function localBox(g: BufferGeometry): Box3 {
  g.computeBoundingBox();
  return g.boundingBox?.clone() ?? new Box3(new Vector3(), new Vector3());
}

/** 모델 외곽 틀 상자 (호출 방식 1 원점=가운데 · 2 좌후하) */
export function frameBox(ev: PmEval): Box3 {
  const f = ev.model.frame;
  const size = ev.frameVec('size', f.size ?? '{"x":"#W","y":"#D","z":"#H"}');
  const c = ev.frameVec('center', f.center ?? '{"x":"0","y":"0","z":"0"}');
  return boxAt(size, c, Number(f.invokedPosType ?? '2'));
}
/** 상자형(외곽 틀·내부 공간·간섭 영역) — 위치가 좌후하 모서리(2) 또는 가운데(1·0) */
export function boxAt(size: V3, at: V3, type: number): Box3 {
  if (type === 2) return new Box3(new Vector3(at[0], at[1] - size[1], at[2]), new Vector3(at[0] + size[0], at[1], at[2] + size[2]));
  return new Box3(new Vector3(at[0] - size[0] / 2, at[1] - size[1] / 2, at[2] - size[2] / 2), new Vector3(at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + size[2] / 2));
}

export interface BuildOptions {
  /** 단면 조회 — 로프트·스윕 profileData */
  profile?: (id: string) => { w: number; h: number; points: [number, number][] } | undefined;
  product?: (id: string) => { color?: string; texture?: string } | undefined;
}

/** 배열 복제 행렬들 */
function arrayMatrices(ev: PmEval, node: PmNode): Matrix4[] {
  const a = node.array;
  if (!a) return [new Matrix4()];
  const len = ev.num(node, '배열 길이', a.length, 0);
  const val = ev.num(node, a.mode === 'step' ? '배열 간격' : '배열 개수', a.value, 0);
  let count: number, step: number;
  if (a.mode === 'count') { count = Math.max(1, Math.min(200, Math.round(val))); step = count > 1 ? len / count : 0; }
  else { step = val; count = step > 0 ? Math.max(1, Math.min(200, Math.floor(len / step + 1e-9))) : 1; }
  const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[a.dir[0] as 'x' | 'y' | 'z'];
  const sign = a.dir[1] === '-' ? -1 : 1;
  return Array.from({ length: count }, (_, i) => new Matrix4().makeTranslation(axis[0] * step * i * sign, axis[1] * step * i * sign, axis[2] * step * i * sign));
}

export function buildModel(ev: PmEval, opts: BuildOptions = {}, prefix = '', parent?: { nodeId: string; matrix: Matrix4; hidden: boolean }): BuildResult {
  const parts: RenderPart[] = [];
  const bbox = new Box3();
  const frame = frameBox(ev);
  const product = opts.product;

  for (const node of ev.model.nodes) {
    const def = elementDef(node.def);
    if (!def) continue;
    if (ev.bool(node, 'KJL_model_suppress_param')) continue; // 억제 — 계산에서 제외
    const hidden = (parent?.hidden ?? false) || ev.bool(node, 'ignore');
    const key = prefix ? `${prefix}/${node.id}` : node.id;
    const nodeId = parent?.nodeId ?? node.id;
    const base = parent?.matrix ?? new Matrix4();
    const order = (ev.str(node, 'rotateOrder') || 'XYZ') === 'ZYX' ? 'ZYX' : 'XYZ';
    const invoked = Number(ev.str(node, 'invokedPosType') || '2');
    const pos = def.params.some((p) => p.name === 'position') ? ev.vec(node, 'position') : def.params.some((p) => p.name === 'center') ? ev.vec(node, 'center') : [0, 0, 0] as V3;
    const rotParam = def.params.some((p) => p.name === 'rotationDegree') ? 'rotationDegree' : def.params.some((p) => p.name === 'rotateDegree') ? 'rotateDegree' : null;
    const rot: V3 = rotParam ? ev.vec(node, rotParam) : [0, 0, 0];
    const customPivot = invoked === 12 ? ev.vec(node, 'invokedPos') : undefined;
    const mats = arrayMatrices(ev, node);
    const mat = ev.str(node, 'materialBrandGoodId');
    const { color, texture } = colorOf(mat, product);

    const pushSolid = (geometry: BufferGeometry, local: Box3, name = node.name) => {
      if (!geometry.getAttribute('position')) return;
      const m = placeMatrix(pos as V3, rot, pivotOf(invoked, local, customPivot), order);
      mats.forEach((am, i) => {
        const matrix = base.clone().multiply(am).multiply(m);
        const faces = (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
        parts.push({ key: mats.length > 1 ? `${key}#${i}` : key, nodeId, name, kind: 'solid', geometry, matrix, color, texture, hidden, viewHidden: !!node.viewHidden, faces });
        if (!hidden && !node.viewHidden) bbox.union(local.clone().applyMatrix4(matrix));
      });
    };
    const pushAux = (lines: number[], auxKind: string, fill?: BufferGeometry, m = new Matrix4()) => {
      parts.push({ key, nodeId, name: node.name, kind: 'aux', lines, fill, matrix: base.clone().multiply(m), color: '#2f80ed', hidden, viewHidden: !!node.viewHidden, auxKind, faces: 0 });
    };

    switch (def.fn) {
      case 'PrimitiveModel.plank':
      case 'PrimitiveModel.sideStylePlank': {
        const { shape, num } = ev.plankShape(node);
        const outline = polyOf(num(shape.outline, '윤곽점'));
        const holes = shape.holes.map((h, i) => polyOf(num(h, `구멍${i + 1}`)));
        const t = ev.numParam(node, 'thickness', 18);
        const g = plankGeometry(outline, holes, t);
        if (shape.slots.length) {
          const extra = shape.slots.map((s, i) => slotGeometry(polyOf(num(s.path, `홈${i + 1}`)), ev.num(node, `홈${i + 1} 깊이`, s.depth, 5), t, s.face))
            .filter((x) => x.getAttribute('position'));
          if (extra.length && g.getAttribute('position')) {
            const merged = mergeGeometries([g.toNonIndexed(), ...extra.map((x) => x.toNonIndexed())]);
            if (merged) { pushSolid(merged, localBox(g)); break; }
          }
        }
        pushSolid(g, localBox(g));
        break;
      }
      case 'PrimitiveModel.lofting':
      case 'PrimitiveModel.brepSweep':
      case 'PrimitiveModel.brepSweepExtend': {
        const pid = ev.str(node, 'profileData');
        const prof = opts.profile?.(pid);
        let section: V2[] = prof?.points.length ? prof.points.map(([x, y]) => [x, y] as V2) : [[-18, 0], [0, 0], [0, 18], [-18, 18]];
        section = scaleProfile(section, ev.numParam(node, 'profileScaleWidth', 0), ev.numParam(node, 'profileScaleHeight', 0));
        section = clipProfile(section, ev.numParam(node, 'height', 0));
        section = rotateProfile(section, ev.numParam(node, 'planeRotate', 0));
        const lp = ev.linePath(node, 'loftPath');
        const path = expandNumPath(lp.points, lp.lines, lp.closed);
        const g = def.fn === 'PrimitiveModel.brepSweepExtend'
          ? sweepGeometry(section, path, lp.closed, ev.numParam(node, 'startRotate', 0), ev.numParam(node, 'endRotate', 0))
          : sweepGeometry(section, path, lp.closed);
        pushSolid(g, localBox(g));
        break;
      }
      case 'PrimitiveModel.grid': {
        const g = gridGeometry(ev.numParam(node, 'length', 800), ev.numParam(node, 'width', 800), ev.numParam(node, 'thickness', 18), ev.numParam(node, 'gridLength', 100), ev.numParam(node, 'plankThickness', 18));
        pushSolid(g, localBox(g));
        break;
      }
      case 'instance': {
        if (node.sub?.kind === 'param') {
          const child = ev.child(node);
          if (!child) break;
          const cf = frameBox(child);
          const m = placeMatrix(pos as V3, rot, invoked === 2 ? [cf.min.x, cf.max.y, cf.min.z] : invoked === 12 && customPivot ? customPivot : [0, 0, 0], order);
          mats.forEach((am, i) => {
            const matrix = base.clone().multiply(am).multiply(m);
            const sub = buildModel(child, opts, `${key}${mats.length > 1 ? `#${i}` : ''}`, { nodeId, matrix, hidden });
            for (const p of sub.parts) parts.push({ ...p, viewHidden: p.viewHidden || !!node.viewHidden });
            if (!hidden && !node.viewHidden) bbox.union(sub.bbox.isEmpty() ? cf.clone().applyMatrix4(matrix) : sub.bbox);
          });
        } else if (node.sub?.kind === 'mesh') {
          const size: V3 = [ev.numParam(node, 'W', 0), ev.numParam(node, 'D', 0), ev.numParam(node, 'H', 0)];
          const local = new Box3(new Vector3(0, -size[1], 0), new Vector3(size[0], 0, size[2]));
          const m = placeMatrix(pos as V3, rot, invoked === 2 ? [0, 0, 0] : [size[0] / 2, -size[1] / 2, 0], order);
          mats.forEach((am, i) => {
            const matrix = base.clone().multiply(am).multiply(m);
            parts.push({ key: mats.length > 1 ? `${key}#${i}` : key, nodeId, name: node.name, kind: 'mesh', mesh: { asset: node.sub!.id, size }, matrix, color, texture, hidden, viewHidden: !!node.viewHidden, faces: 12 });
            if (!hidden && !node.viewHidden) bbox.union(local.clone().applyMatrix4(matrix));
          });
        }
        break;
      }
      case 'FrameInstance.positionCenterBoxInnerFrameInstance':
      case 'Intersect.intersectBox': {
        const b = boxAt(ev.vec(node, 'size'), ev.vec(node, 'center'), invoked);
        pushAux(boxLines(b.min.toArray() as V3, b.max.toArray() as V3), def.fn === 'Intersect.intersectBox' ? 'intersect' : 'inner');
        break;
      }
      case 'LinellaeInstance.cabinetWardrobeDoorHole':
      case 'LinellaeInstance.dwWindowHole': {
        const w = ev.numParam(node, 'width', 600), h = ev.numParam(node, 'height', 800);
        // 개구부 — XZ 평면 사각형(앞면을 향함). 좌후하 = 왼쪽 아래 모서리, 원점 = 가운데
        const x0 = invoked === 2 ? 0 : -w / 2, z0 = invoked === 2 ? 0 : -h / 2;
        const m = placeMatrix(pos as V3, rot, [0, 0, 0], order);
        const pts: V3[] = [[x0, 0, z0], [x0 + w, 0, z0], [x0 + w, 0, z0 + h], [x0, 0, z0 + h]];
        pushAux([...polyLines(pts, true), x0, 0, z0, x0 + w, 0, z0 + h, x0 + w, 0, z0, x0, 0, z0 + h], 'door', undefined, m);
        break;
      }
      case 'LinellaeInstance.exLinellaeInstance': {
        const lp = ev.linePath(node, 'profile', true);
        const pts = expandNumPath(lp.points, lp.lines, true).map(([x, y]) => [x + (pos as V3)[0], y + (pos as V3)[1], (pos as V3)[2]] as V3);
        pushAux(polyLines(pts, true), 'molding');
        break;
      }
      case 'AdsorbLine.adsorbLine': {
        const s = ev.vec(node, 'start'), e = ev.vec(node, 'end');
        const z = frame.max.z;
        pushAux([s[0], s[1], 0, e[0], e[1], 0, s[0], s[1], z, e[0], e[1], z, s[0], s[1], 0, s[0], s[1], z, e[0], e[1], 0, e[0], e[1], z], 'adsorb');
        break;
      }
      case 'AdsorbLine.rightAdsorbLine': {
        const s = ev.vec(node, 'start');
        const lx = ev.numParam(node, 'paramX', 0) * (ev.bool(node, 'directionX') ? 1 : -1);
        const ly = ev.numParam(node, 'paramY', 0) * (ev.bool(node, 'directionY') ? 1 : -1);
        pushAux([s[0], s[1], 0, s[0] + lx, s[1], 0, s[0], s[1], 0, s[0], s[1] + ly, 0], 'adsorb');
        break;
      }
      case 'AdsorbLine.adsorbPlane': {
        const L = ev.numParam(node, 'length', 0), H = ev.numParam(node, 'height', 0);
        const m = placeMatrix(pos as V3, rot, [0, 0, 0], order);
        pushAux(polyLines([[0, 0, 0], [L, 0, 0], [L, 0, H], [0, 0, H]], true), 'adsorb', undefined, m);
        break;
      }
      default: {
        // 연결·공정·도면 보조 구조 — 위치 점 표시 (경로 값이 있으면 선)
        const pathParam = def.params.find((p) => ['auxiliaryLinePath', 'auxiliaryPlanePath', 'connectFacePath', 'loftpath'].includes(p.type));
        const m = placeMatrix(pos as V3, rot, [0, 0, 0], order);
        if (pathParam) {
          const lp = ev.linePath(node, pathParam.name, pathParam.type === 'auxiliaryPlanePath' || pathParam.type === 'connectFacePath');
          const pts = expandNumPath(lp.points, lp.lines, lp.closed).map(([x, y]) => [x, y, 0] as V3);
          if (pts.length >= 2) { pushAux(polyLines(pts, lp.closed), 'custom', undefined, m); break; }
        }
        const r = 15;
        pushAux([-r, 0, 0, r, 0, 0, 0, -r, 0, 0, r, 0, 0, 0, -r, 0, 0, r], 'point', undefined, m);
      }
    }
  }
  if (!parent) {
    parts.push({ key: '__frame', nodeId: '__frame', name: '모델 외곽 틀', kind: 'aux', lines: boxLines(frame.min.toArray() as V3, frame.max.toArray() as V3), matrix: new Matrix4(), color: '#8a8f98', hidden: false, viewHidden: false, auxKind: 'frame', faces: 0 });
  }
  return { parts, bbox, frame };
}

/** 정의 → 패널에 보일 요소 이름 */
export const defName = (def: ElementDef | undefined, node: PmNode) => (node.sub ? node.sub.name : def?.name ?? node.def);
