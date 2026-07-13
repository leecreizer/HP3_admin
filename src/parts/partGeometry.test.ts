import { describe, it, expect } from 'vitest';
import { buildShape, computeBBox, validateProfile } from './partGeometry';
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