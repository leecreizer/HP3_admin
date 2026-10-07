import { describe, expect, it } from 'vitest';
import { stringifyLinePath } from './path';
import { SECTION_TEMPLATES, sectionArcs, sectionPathFromArcs, sectionShape, sectionStartPath } from './sections';

const tpl = (key: string) => SECTION_TEMPLATES.find((t) => t.key === key)!;
const defaults = (key: string) => Object.fromEntries(tpl(key).fields.map((f) => [f.k, f.v]));
const area = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

describe('단면 그리기 — 경로 → 몰딩 단면', () => {
  it('사각형 30×20 → 왼쪽 아래 (0,0), 반시계, 경로를 함께 보관', () => {
    const path = stringifyLinePath(tpl('rect').build({ W: 30, H: 20 }));
    const s = sectionShape(path);
    expect([s.w, s.h]).toEqual([30, 20]);
    expect(area(s.points)).toBeCloseTo(600, 6);
    expect(s.path).toBe(path);
  });

  it('사분원은 볼록(넓이 πR²/4), 코브는 오목(사각형보다 작음)', () => {
    const q = sectionShape(stringifyLinePath(tpl('quarter').build({ R: 20 })));
    expect([q.w, q.h]).toEqual([20, 20]);
    expect(area(q.points)).toBeCloseTo((Math.PI * 400) / 4, 0);
    const c = sectionShape(stringifyLinePath(tpl('cove').build({ W: 60, H: 60, T: 10 })));
    expect([c.w, c.h]).toEqual([60, 60]);
    const a = area(c.points);
    expect(a).toBeLessThan(60 * 60 - 0.5 * 50 * 50); // 대각선으로 자른 것보다도 더 깎임(오목)
    expect(a).toBeGreaterThan(60 * 10 * 2 - 100);
  });

  it('둥근 모서리·모따기 꼭짓점은 펼쳐서 점이 늘고 넓이가 줄어든다', () => {
    const sk = sectionShape(stringifyLinePath(tpl('skirt').build(defaults('skirt'))));
    expect(sk.points.length).toBeGreaterThan(4);
    expect(area(sk.points)).toBeLessThan(15 * 80);
    const ch = sectionShape(stringifyLinePath(tpl('chamfer').build(defaults('chamfer'))));
    expect(ch.points.length).toBe(5);
    expect(area(ch.points)).toBeCloseTo(18 * 60 - 18, 6);
  });

  it('시작 경로 — 그린 경로 그대로, DXF 단면 점은 직선으로 이어 같은 단면', () => {
    expect(sectionStartPath({ path: 'X' })).toBe('X');
    const s = sectionShape(sectionStartPath({ points: [[0, 0], [40, 0], [40, 10], [0, 10]] }));
    expect([s.w, s.h]).toEqual([40, 10]);
    expect(sectionShape(sectionStartPath()).w).toBe(30);
  });

  it('구간 — 원호 선·둥근 모서리는 원호 한 구간, 넓이는 펼친 단면과 같다', () => {
    const bulgeArea = (s: { points: [number, number][]; bulges: number[] }) => s.points.reduce((sum, a, i) => {
      const b = s.points[(i + 1) % s.points.length], k = s.bulges[i];
      const tri = (a[0] * b[1] - b[0] * a[1]) / 2;
      if (!k) return sum + tri;
      const th = 4 * Math.atan(k), c = Math.hypot(b[0] - a[0], b[1] - a[1]), r = c / (2 * Math.sin(Math.abs(th) / 2));
      return sum + tri + Math.sign(th) * (r * r / 2) * (Math.abs(th) - Math.sin(Math.abs(th))); // 활꼴
    }, 0);
    const q = sectionArcs(stringifyLinePath(tpl('quarter').build({ R: 20 })));
    expect(q.points.length).toBe(3);
    expect(q.bulges.filter((b) => b !== 0)).toHaveLength(1);
    expect(q.bulges.find((b) => b !== 0)).toBeCloseTo(Math.tan(Math.PI / 8), 9); // 반시계 90°
    expect(bulgeArea(q)).toBeCloseTo((Math.PI * 400) / 4, 6);
    const sk = sectionArcs(stringifyLinePath(tpl('skirt').build(defaults('skirt'))));
    expect(sk.points.length).toBe(5); // 둥근 모서리 = 점 2개 + 원호 1구간
    expect(sk.bulges.filter((b) => b !== 0)).toHaveLength(1);
    expect(bulgeArea(sk)).toBeCloseTo(15 * 80 - 25 + (Math.PI * 25) / 4, 6);
    const c = sectionArcs(stringifyLinePath(tpl('cove').build(defaults('cove'))));
    expect(c.points.length).toBe(5);
    expect(c.bulges.filter((b) => b < 0)).toHaveLength(1); // 오목 = 시계
  });

  it('구간 → 경로 왕복 — 원호 구간이 같은 원호로 돌아온다', () => {
    const pts: [number, number][] = [[0, 0], [30, 0], [30, 10], [0, 40]];
    const bul = [0, 0, -0.3, 0];
    const back = sectionArcs(sectionPathFromArcs(pts, bul));
    expect(back.points).toEqual(pts);
    back.bulges.forEach((b, i) => expect(b).toBeCloseTo(bul[i], 3));
  });

  it('닫히지 않았거나 넓이가 없으면 알림', () => {
    const open = JSON.stringify({ points: [{ x: '0', y: '0' }, { x: '10', y: '0' }, { x: '10', y: '10' }], lines: [{}, {}], isClose: false });
    expect(() => sectionShape(open)).toThrow();
    const flat = stringifyLinePath({ points: [{ x: '0', y: '0', type: 0 }, { x: '10', y: '0', type: 0 }, { x: '20', y: '0', type: 0 }], lines: [{ type: 0 }, { type: 0 }, { type: 0 }], closed: true });
    expect(() => sectionShape(flat)).toThrow('넓이');
  });
});
