import { Shape, Path } from 'three';
import type { Profile, Contour, Vec2 } from './types';

/** 컨투어의 모든 정점(시작점 + 각 세그먼트 도착점). arc도 근사 위해 도착점 사용. */
function contourPoints(c: Contour): Vec2[] {
  return [c.start, ...c.segments.map((s) => s.to)];
}

function applyContour(target: Shape | Path, c: Contour): void {
  target.moveTo(c.start[0], c.start[1]);
  for (const seg of c.segments) {
    if (seg.type === 'line') {
      target.lineTo(seg.to[0], seg.to[1]);
    } else {
      // arc: 현재점→to, 반경 radius. absarc 근사(중심 계산 생략, 부드러운 근사).
      target.quadraticCurveTo(
        (target.currentPoint.x + seg.to[0]) / 2 + (seg.ccw ? -seg.radius : seg.radius) * 0.2,
        (target.currentPoint.y + seg.to[1]) / 2 + (seg.ccw ? -seg.radius : seg.radius) * 0.2,
        seg.to[0], seg.to[1],
      );
    }
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
  return errs;
}