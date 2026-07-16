import { Shape, Path } from 'three';
import type { Profile, Contour, Vec2, WorkPlane } from './types';

/** 작업 평면별 회전(오일러). 기본 압출 +Z를 해당 축에 맞춘다. 3D 미리보기·조립 공용. */
export function planeEuler(plane?: WorkPlane): [number, number, number] {
  if (plane === 'XZ') return [-Math.PI / 2, 0, 0];
  if (plane === 'YZ') return [0, Math.PI / 2, 0];
  return [0, 0, 0];
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (v: Vec2): number => Math.hypot(v[0], v[1]);

/**
 * 한 꼭지점 V(이웃 prev·next)를 반지름 r로 필렛(라운드)한 경계점들을 반환한다.
 * r이 없거나 0, 또는 기하학적으로 불가하면 [V](각진 모서리) 반환.
 * 반환: [T1, ...호 샘플..., T2] — 두 인접 변에 접하는 접점 사이의 원호.
 * r이 인접 변 절반을 넘으면 접점 거리(t)를 절반으로 클램프하고 그에 맞춰 반지름을 낮춘다.
 */
export function filletCorner(prev: Vec2, V: Vec2, next: Vec2, r?: number): Vec2[] {
  if (!r || r <= 0) return [V];
  const v1 = sub(prev, V), v2 = sub(next, V);
  const l1 = len(v1), l2 = len(v2);
  if (l1 < 1e-6 || l2 < 1e-6) return [V];
  const u1: Vec2 = [v1[0] / l1, v1[1] / l1];
  const u2: Vec2 = [v2[0] / l2, v2[1] / l2];
  let dot = u1[0] * u2[0] + u1[1] * u2[1];
  dot = Math.max(-1, Math.min(1, dot));
  const phi = Math.acos(dot); // 꼭지점 내각(두 변 방향 사이 각)
  if (phi < 1e-3 || Math.PI - phi < 1e-3) return [V]; // 일직선/역행 → 필렛 불가
  const half = phi / 2;
  let t = r / Math.tan(half); // V로부터 접점까지 거리
  let rr = r;
  const maxT = Math.min(l1, l2) / 2; // 인접 변 절반 넘지 않게 클램프
  if (t > maxT) { t = maxT; rr = t * Math.tan(half); }
  const T1: Vec2 = [V[0] + u1[0] * t, V[1] + u1[1] * t];
  const T2: Vec2 = [V[0] + u2[0] * t, V[1] + u2[1] * t];
  const bis: Vec2 = [u1[0] + u2[0], u1[1] + u2[1]];
  const bl = len(bis);
  if (bl < 1e-6) return [V];
  const ub: Vec2 = [bis[0] / bl, bis[1] / bl];
  const C: Vec2 = [V[0] + ub[0] * (rr / Math.sin(half)), V[1] + ub[1] * (rr / Math.sin(half))];
  const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
  const a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
  let d = a2 - a1; // 최소호 방향으로 정규화
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(d) / (Math.PI / 48)));
  const out: Vec2[] = [T1];
  for (let k = 1; k <= steps; k++) {
    const a = a1 + (d * k) / steps;
    out.push([C[0] + rr * Math.cos(a), C[1] + rr * Math.sin(a)]);
  }
  return out;
}

/** 꼭지점+필렛을 전개해 닫힌 다각형의 조밀한 경계점 목록을 만든다(3D·미리보기 공용). */
export function outlinePoints(c: Contour): Vec2[] {
  const cs = c.corners;
  const n = cs.length;
  if (n === 0) return [];
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = cs[(i - 1 + n) % n].pt;
    const V = cs[i].pt;
    const next = cs[(i + 1) % n].pt;
    out.push(...filletCorner(prev, V, next, cs[i].r));
  }
  return out;
}

function applyContour(target: Shape | Path, c: Contour): void {
  const pts = outlinePoints(c);
  if (pts.length === 0) return;
  target.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) target.lineTo(pts[i][0], pts[i][1]);
  if (c.closed) target.closePath();
}

export function buildShape(profile: Profile): Shape {
  const [outer, ...holes] = profile.contours;
  const shape = new Shape();
  applyContour(shape, outer);
  for (const h of holes) {
    const path = new Path();
    applyContour(path, h);
    shape.holes.push(path);
  }
  return shape;
}

export function computeBBox(profile: Profile, depth: number): { w: number; h: number; d: number } {
  // 필렛 전개 후 경계점 기준(라운드 모서리까지 정확히 반영)
  const pts = outlinePoints(profile.contours[0] ?? { closed: true, corners: [] });
  if (pts.length === 0) return { w: 0, h: 0, d: Math.round(depth) };
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    w: Math.round(Math.max(...xs) - Math.min(...xs)),
    h: Math.round(Math.max(...ys) - Math.min(...ys)),
    d: Math.round(depth),
  };
}

/** 단면 외곽을 축소해 SVG 썸네일(data URL)로 만든다. 라이브러리 카드용. */
export function profileThumb(profile: Profile, color = '#d8c5a8', size = 72): string {
  const pts = outlinePoints(profile.contours[0] ?? { closed: true, corners: [] });
  if (pts.length < 3) return '';
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const PAD = 6;
  const sc = Math.min((size - PAD * 2) / w, (size - PAD * 2) / h);
  const ox = (size - w * sc) / 2, oy = (size - h * sc) / 2;
  // SVG y축은 아래로 증가 → maxY 기준으로 뒤집어 그린다
  const poly = pts
    .map(([x, y]) => `${(ox + (x - minX) * sc).toFixed(1)},${(oy + (maxY - y) * sc).toFixed(1)}`)
    .join(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="#f5f5f2"/>`
    + `<polygon points="${poly}" fill="${color}" stroke="#3a6" stroke-width="1"/></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function validateProfile(profile: Profile): string[] {
  const errs: string[] = [];
  const outer = profile.contours[0];
  if (!outer) { errs.push('외곽 단면이 없습니다.'); return errs; }
  if (outer.corners.length < 3) errs.push('외곽 단면은 꼭지점이 3개 이상이어야 합니다.');
  if (!outer.closed) errs.push('외곽 단면이 닫히지 않았습니다.');
  return errs;
}