import { describe, it, expect } from 'vitest';
import { buildShape, computeBBox, validateProfile, sampleArc } from './partGeometry';
import type { Profile } from './types';

const rect = (w: number, h: number): Profile => ({
  units: 'mm',
  contours: [{
    closed: true,
    start: [0, 0],
    segments: [
      { type: 'line', to: [w, 0] },
      { type: 'line', to: [w, h] },
      { type: 'line', to: [0, h] },
      { type: 'line', to: [0, 0] },
    ],
  }],
});

describe('validateProfile', () => {
  it('정상 사각형은 오류 없음', () => {
    expect(validateProfile(rect(600, 720))).toEqual([]);
  });
  it('점 3개 미만이면 오류', () => {
    const p: Profile = { units: 'mm', contours: [{ closed: true, start: [0, 0], segments: [{ type: 'line', to: [10, 0] }] }] };
    expect(validateProfile(p).length).toBeGreaterThan(0);
  });
  it('컨투어가 없으면 오류', () => {
    expect(validateProfile({ units: 'mm', contours: [] }).length).toBeGreaterThan(0);
  });
});

describe('computeBBox', () => {
  it('사각형 600x720, 두께 18 → w600 h720 d18', () => {
    expect(computeBBox(rect(600, 720), 18)).toEqual({ w: 600, h: 720, d: 18 });
  });
});

describe('buildShape', () => {
  it('사각형은 THREE.Shape를 반환하고 곡선점이 4개 이상', () => {
    const shape = buildShape(rect(600, 720));
    const pts = shape.getPoints();
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });
  it('구멍이 있으면 holes에 반영', () => {
    const p = rect(600, 720);
    p.contours.push({ closed: true, start: [100, 100], segments: [
      { type: 'line', to: [200, 100] }, { type: 'line', to: [200, 200] },
      { type: 'line', to: [100, 200] }, { type: 'line', to: [100, 100] },
    ]});
    const shape = buildShape(p);
    expect(shape.holes.length).toBe(1);
  });
});

describe('sampleArc', () => {
  it('모든 샘플점이 정확히 반지름 R 위에 있다', () => {
    const from: [number, number] = [0, 0];
    const to: [number, number] = [100, 0];
    const R = 80;
    const pts = sampleArc(from, to, R, false);
    // 중심은 두 끝점에서 각각 R 거리에 있어야 하고, 모든 샘플점도 그 중심에서 R
    // 끝점 to 포함, from 제외
    expect(pts[pts.length - 1]).toEqual([100, 0]);
    // 중심 역산: from·to 에서 R인 점 — 여기선 검증을 위해 중심을 찾는다
    const half = 50, h = Math.sqrt(R * R - half * half);
    const cx = 50, cy = -h; // ccw=false → 진행방향 우측(아래)
    for (const [x, y] of pts) {
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(R, 3);
    }
  });
  it('ccw는 볼록 방향을 뒤집는다(y 부호 반대)', () => {
    const a = sampleArc([0, 0], [100, 0], 80, false);
    const b = sampleArc([0, 0], [100, 0], 80, true);
    const midA = a[Math.floor(a.length / 2)];
    const midB = b[Math.floor(b.length / 2)];
    expect(Math.sign(midA[1])).toBe(-Math.sign(midB[1]));
  });
});

describe('validateProfile arc', () => {
  it('R값이 두 끝점 거리 절반보다 작으면 오류', () => {
    const p: Profile = { units: 'mm', contours: [{ closed: true, start: [0, 0], segments: [
      { type: 'arc', to: [100, 0], radius: 10 }, // 거리 100 → 최소 R 50 필요
      { type: 'line', to: [100, 100] },
      { type: 'line', to: [0, 0] },
    ] }] };
    expect(validateProfile(p).some((e) => e.includes('원호 R값'))).toBe(true);
  });
  it('충분한 R값이면 오류 없음', () => {
    const p: Profile = { units: 'mm', contours: [{ closed: true, start: [0, 0], segments: [
      { type: 'arc', to: [100, 0], radius: 80 },
      { type: 'line', to: [100, 100] },
      { type: 'line', to: [0, 0] },
    ] }] };
    expect(validateProfile(p)).toEqual([]);
  });
});