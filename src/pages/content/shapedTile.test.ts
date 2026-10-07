import { describe, expect, it } from 'vitest';
import { boxAspect, defaultParams, fixSide, fixSmall, fixStar, shapeOutline, shapedSize, type Pt } from './shapedTile';

const area = (pts: Pt[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const inBox = (pts: Pt[], w: number, h: number) => pts.every(([x, y]) => x >= -1e-6 && y >= -1e-6 && x <= w + 1e-6 && y <= h + 1e-6);

describe('비정형 상품 형상 — 쿠지알러 calcuSize·겹침 그림 공식', () => {
  it('상품 크기: 육각형 폭 = L·√3/2, 별 = L·√2 정사각형, 둥근 사각 = L 정사각형, 사용자 정의 = 입력값', () => {
    expect(shapedSize('hexagon', 600, 999)).toEqual([600, (600 * Math.sqrt(3)) / 2]);
    expect(shapedSize('star', 300, 1)).toEqual([300 * Math.SQRT2, 300 * Math.SQRT2]);
    expect(shapedSize('radius', 600, 10)).toEqual([600, 600]);
    expect(shapedSize('custom', 300, 350)).toEqual([300, 350]);
    expect(boxAspect('hexagon')).toBeCloseTo(2 / Math.sqrt(3));
    expect(boxAspect('custom', { w: 300, h: 350 })).toBeCloseTo(300 / 350);
  });

  it('육각형 — 좌우가 뾰족한 정육각형', () => {
    const pts = shapeOutline('hexagon', 600, 0, { straight: 0, arc: 0, side: 0 });
    const h = (600 * Math.sqrt(3)) / 2;
    expect(pts).toEqual([[0, h / 2], [150, 0], [450, 0], [600, h / 2], [450, h], [150, h]]);
    // 여섯 변이 모두 같다 (정육각형)
    const sides = pts.map((p, i) => { const q = pts[(i + 1) % 6]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
    sides.forEach((s) => expect(s).toBeCloseTo(300, 6));
  });

  it('네 꼭지 별 — 꼭지는 상자 변 가운데, 호 높이만큼 오목해서 마름모보다 작다', () => {
    const L = 300, B = L * Math.SQRT2;
    const flat = shapeOutline('star', L, 0, { straight: 5, arc: 0.0001, side: 0 });
    const deep = shapeOutline('star', L, 0, { straight: 5, arc: 40, side: 0 });
    expect(inBox(deep, B, B)).toBe(true);
    for (const t of [[B / 2, 0], [B, B / 2], [B / 2, B], [0, B / 2]]) expect(deep.some((p) => Math.hypot(p[0] - t[0], p[1] - t[1]) < 1e-6)).toBe(true);
    expect(area(flat)).toBeCloseTo(L * L, 0); // 호가 거의 없으면 한 변 L 마름모
    expect(area(deep)).toBeLessThan(area(flat) - 1000);
    // 꼭지에서 변을 따라 ‘직선 변’만큼은 곧다: 위 꼭지 다음 점이 (B/2 + 5/√2, 5/√2)
    const i = deep.findIndex((p) => Math.hypot(p[0] - B / 2, p[1]) < 1e-6);
    expect(deep[i + 1][0]).toBeCloseTo(B / 2 + 5 / Math.SQRT2, 6);
    expect(deep[i + 1][1]).toBeCloseTo(5 / Math.SQRT2, 6);
  });

  it('둥근 모서리 사각 — 모서리를 작은 타일 몫(다리 s/√2)만큼 깎고, 호 높이만큼 모서리 쪽으로 볼록', () => {
    const L = 600, s = 200, A = s / Math.SQRT2;
    const cut = shapeOutline('radius', L, 0, { straight: 20, arc: 0.0001, side: s });
    const round = shapeOutline('radius', L, 0, { straight: 20, arc: 30, side: s });
    expect(inBox(round, L, L)).toBe(true);
    expect(area(cut)).toBeCloseTo(L * L - 2 * A * A, 0); // 호가 거의 없으면 네 모서리 직각삼각형(다리 A)을 뺀 넓이
    expect(area(round)).toBeGreaterThan(area(cut) + 1000); // 볼록한 호가 넓이를 되돌린다
    expect(round.some(([x, y]) => x === L - A && y === 0)).toBe(true);
  });

  it('사용자 정의 — 0–1 윤곽을 상자에 늘인다', () => {
    const pts = shapeOutline('custom', 300, 350, { straight: 0, arc: 0, side: 0 }, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(pts).toEqual([[0, 0], [300, 0], [300, 350], [0, 350]]);
  });

  it('매개변수 고치기 — 쿠지알러 St·dt·Mt 그대로', () => {
    expect(fixStar(400, 600)).toBe(299);
    expect(fixStar(10, 20)).toBe(9);
    expect(fixStar(5, 20)).toBe(5);
    expect(fixSide(500, 600)).toBe(424);
    expect(fixSide(68, 20)).toBe(14);
    expect(fixSide(68, 100)).toBe(68);
    expect(fixSmall(10, 14)).toBe(6);
    expect(fixSmall(5, 14)).toBe(5);
    expect(defaultParams(600)).toEqual({ star: { straight: 5, arc: 10, side: 68 }, radius: { straight: 5, arc: 10, side: 68 } });
    expect(defaultParams(20)).toEqual({ star: { straight: 5, arc: 9, side: 14 }, radius: { straight: 5, arc: 6, side: 14 } });
  });
});
