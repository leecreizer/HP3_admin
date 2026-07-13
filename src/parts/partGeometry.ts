import { Shape, Path } from 'three';
import type { Profile, Contour, Vec2 } from './types';

/** 컨투어의 모든 정점(시작점 + 각 세그먼트 도착점). arc도 근사 위해 도착점 사용. */
function contourPoints(c: Contour): Vec2[] {
  return [c.start, ...c.segments.map((s) => s.to)];
}

/**
 * 두 점(from→to)과 반지름 R로 정확한 원호 중심을 구해 최소호(minor arc) 위의 점들을 반환한다.
 * 반환 점은 from 다음 점부터 to까지(from 제외, to 포함), 전부 정확히 반지름 R 위에 있다.
 * ccw는 호가 볼록해지는 방향(진행방향 좌/우)을 뒤집는다.
 * R이 두 끝점 거리의 절반보다 작으면 기하학적으로 불가하므로 반원으로 클램프.
 * SVG 미리보기와 3D 지오메트리가 동일한 곡선을 쓰도록 공용화.
 */
export function sampleArc(from: Vec2, to: Vec2, radius: number, ccw?: boolean): Vec2[] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return [to];
  const half = d / 2;
  const r = Math.max(radius, half); // R이 너무 작으면 반원으로 클램프
  const h = Math.sqrt(Math.max(0, r * r - half * half)); // 중선~중심 거리
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const nx = -dy / d, ny = dx / d; // 현에 수직인 단위벡터(진행방향 좌측)
  const sign = ccw ? 1 : -1;
  const cx = mx + nx * h * sign, cy = my + ny * h * sign;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let delta = a1 - a0; // 최소호 방향으로 정규화 (-PI, PI]
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(delta) / (Math.PI / 48)));
  const out: Vec2[] = [];
  for (let k = 1; k <= steps; k++) {
    const a = a0 + (delta * k) / steps;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function applyContour(target: Shape | Path, c: Contour): void {
  target.moveTo(c.start[0], c.start[1]);
  let cur: Vec2 = c.start;
  for (const seg of c.segments) {
    if (seg.type === 'line') {
      target.lineTo(seg.to[0], seg.to[1]);
    } else {
      for (const [px, py] of sampleArc(cur, seg.to, seg.radius, seg.ccw)) target.lineTo(px, py);
    }
    cur = seg.to;
  }
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
  const pts = contourPoints(profile.contours[0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    w: Math.round(Math.max(...xs) - Math.min(...xs)),
    h: Math.round(Math.max(...ys) - Math.min(...ys)),
    d: Math.round(depth),
  };
}

export function validateProfile(profile: Profile): string[] {
  const errs: string[] = [];
  const outer = profile.contours[0];
  if (!outer) { errs.push('외곽 단면이 없습니다.'); return errs; }
  const ptCount = 1 + outer.segments.length;
  if (ptCount < 3) errs.push('외곽 단면은 점이 3개 이상이어야 합니다.');
  if (!outer.closed) errs.push('외곽 단면이 닫히지 않았습니다.');
  // 원호 R값 검증: R은 두 끝점 거리의 절반 이상이어야 함
  let cur: Vec2 = outer.start;
  outer.segments.forEach((seg) => {
    if (seg.type === 'arc') {
      const d = Math.hypot(seg.to[0] - cur[0], seg.to[1] - cur[1]);
      if (seg.radius < d / 2) {
        errs.push(`원호 R값이 너무 작습니다(최소 ${Math.ceil(d / 2)}mm 필요).`);
      }
    }
    cur = seg.to;
  });
  return errs;
}