import { describe, it, expect } from 'vitest';
import { buildShape, computeBBox, validateProfile, filletCorner, outlinePoints } from './partGeometry';
import type { Profile } from './types';

const rect = (w: number, h: number): Profile => ({
  units: 'mm',
  contours: [{
    closed: true,
    corners: [
      { pt: [0, 0] },
      { pt: [w, 0] },
      { pt: [w, h] },
      { pt: [0, h] },
    ],
  }],
});

describe('validateProfile', () => {
  it('정상 사각형은 오류 없음', () => {
    expect(validateProfile(rect(600, 720))).toEqual([]);
  });
  it('꼭지점 3개 미만이면 오류', () => {
    const p: Profile = { units: 'mm', contours: [{ closed: true, corners: [{ pt: [0, 0] }, { pt: [10, 0] }] }] };
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
  it('사각형은 THREE.Shape를 반환하고 점이 4개 이상', () => {
    const shape = buildShape(rect(600, 720));
    expect(shape.getPoints().length).toBeGreaterThanOrEqual(4);
  });
  it('구멍이 있으면 holes에 반영', () => {
    const p = rect(600, 720);
    p.contours.push({ closed: true, corners: [
      { pt: [100, 100] }, { pt: [200, 100] }, { pt: [200, 200] }, { pt: [100, 200] },
    ] });
    expect(buildShape(p).holes.length).toBe(1);
  });
});

describe('filletCorner', () => {
  it('r 없으면 꼭지점 그대로', () => {
    expect(filletCorner([0, 100], [0, 0], [100, 0])).toEqual([[0, 0]]);
  });
  it('직각 모서리를 R로 필렛하면 접점~접점 호가 생기고 모든 점이 중심에서 R', () => {
    // (0,100)-(0,0)-(100,0) 직각. R=40 → 접점은 축상 40 지점, 중심은 (40,40)
    const pts = filletCorner([0, 100], [0, 0], [100, 0], 40);
    expect(pts.length).toBeGreaterThan(2);
    const cx = 40, cy = 40; // 직각 필렛 중심
    for (const [x, y] of pts) {
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(40, 3);
    }
    // 시작 접점 T1은 세로변 위(0방향), 끝 접점 T2는 가로변 위
    expect(pts[0][0]).toBeCloseTo(0, 3);
    expect(pts[pts.length - 1][1]).toBeCloseTo(0, 3);
  });
  it('R이 인접 변보다 크면 접점거리를 변 길이로 클램프', () => {
    // 변 길이 100 → maxT=100. 매우 큰 R을 줘도 접점은 변 길이(100) 이내
    const pts = filletCorner([0, 100], [0, 0], [100, 0], 10000);
    expect(pts[0][1]).toBeLessThanOrEqual(100 + 1e-6);
    expect(pts[pts.length - 1][0]).toBeLessThanOrEqual(100 + 1e-6);
  });
});

describe('outlinePoints', () => {
  it('필렛 없는 사각형은 꼭지점 4개 그대로', () => {
    const pts = outlinePoints(rect(600, 720).contours[0]);
    expect(pts.length).toBe(4);
  });
  it('한 모서리에 R을 주면 경계점이 늘어난다(라운드 반영)', () => {
    const p = rect(600, 720);
    p.contours[0].corners[0].r = 50;
    expect(outlinePoints(p.contours[0]).length).toBeGreaterThan(4);
  });
});