import { describe, expect, it } from 'vitest';
import { parseDxfProfile } from './dxf';

const dxf = (entities: string[], header = '') =>
  ['0', 'SECTION', '2', 'HEADER', ...(header ? header.split('\n') : []), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n');
const lw = (pts: [number, number, number?][], closed = true) =>
  ['0', 'LWPOLYLINE', '90', String(pts.length), '70', closed ? '1' : '0', ...pts.flatMap(([x, y, b]) => ['10', String(x), '20', String(y), ...(b ? ['42', String(b)] : [])])];
const area = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

describe('DXF 몰딩 프로파일', () => {
  it('닫힌 LWPOLYLINE 사각형 → 좌하단 0,0 기준 폭·높이', () => {
    const s = parseDxfProfile(dxf(lw([[100, 50], [118, 50], [118, 130], [100, 130]])));
    expect(s.w).toBe(18);
    expect(s.h).toBe(80);
    expect(s.points[0]).toEqual([0, 0]);
    expect(area(s.points)).toBeCloseTo(18 * 80, 3);
  });

  it('bulge 반원 — 넓이 = 사각형 + 반원', () => {
    // (0,0)→(20,0)→(20,40)⌒(0,40) : 위쪽 반원(반지름 10, 반시계)
    const s = parseDxfProfile(dxf(lw([[0, 0], [20, 0], [20, 40, 1], [0, 40]])));
    expect(s.h).toBeCloseTo(50, 1);
    const exact = 20 * 40 + (Math.PI * 100) / 2;
    expect(Math.abs(area(s.points) - exact) / exact).toBeLessThan(0.002); // 원호 10° 분할 근사
  });

  it('흩어진 LINE·ARC 를 이어 닫힌 윤곽으로 (시계 방향 입력도 반시계로)', () => {
    const line = (x1: number, y1: number, x2: number, y2: number) => ['0', 'LINE', '10', `${x1}`, '20', `${y1}`, '11', `${x2}`, '21', `${y2}`];
    const s = parseDxfProfile(dxf([
      ...line(0, 0, 0, 30), ...line(30, 0, 0, 0),
      '0', 'ARC', '10', '30', '20', '30', '40', '30', '50', '270', '51', '360', // (30,0) → (60,30)
      ...line(60, 30, 0, 30),
    ]));
    expect(s.w).toBe(60);
    expect(s.h).toBe(30);
    expect(area(s.points)).toBeGreaterThan(0);
  });

  it('$INSUNITS = cm 이면 mm 로 바꾼다', () => {
    const s = parseDxfProfile(dxf(lw([[0, 0], [2, 0], [2, 8], [0, 8]]), '9\n$INSUNITS\n70\n5'));
    expect([s.w, s.h]).toEqual([20, 80]);
  });

  it('닫힌 윤곽이 없으면 오류', () => {
    expect(() => parseDxfProfile(dxf(lw([[0, 0], [10, 0], [10, 10]], false)))).toThrow(/닫힌 윤곽/);
  });
});
