import { describe, expect, it } from 'vitest';
import { stringifyLinePath } from '../../pm/path';
import { SECTION_TEMPLATES, sectionArcs } from '../../pm/sections';
import { flatten, LW_FILE_RULES, mergeAttach, parseLineWallDxf, segLength, shapeFromPolygon, sizeError, type LwMode } from './lineWall';

/** DXF 문자열 만들기 — [code, value] 쌍 */
const dxf = (ents: (string | number)[][], units?: number) => {
  const head = units != null ? [[0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, units], [0, 'ENDSEC']] : [];
  const rows = [...head, [0, 'SECTION'], [2, 'ENTITIES'], ...ents, [0, 'ENDSEC'], [0, 'EOF']];
  return rows.map(([c, v]) => `${c}\n${v}`).join('\n');
};
const lw = (pts: [number, number, number?][], closed = true, extra: (string | number)[][] = []) => [
  [0, 'LWPOLYLINE'], [90, pts.length], [70, closed ? 1 : 0], ...extra,
  ...pts.flatMap(([x, y, b]) => [[10, x], [20, y], ...(b ? [[42, b]] : [])]),
];
const line = (x0: number, y0: number, x1: number, y1: number) => [[0, 'LINE'], [10, x0], [20, y0], [11, x1], [21, y1]];
const area = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

describe('몰딩/벽판 DXF 단면 — 구간 보존', () => {
  it('닫힌 폴리선(시계 방향) → 왼쪽 아래 (0,0)·반시계, 구간 4개', () => {
    const s = parseLineWallDxf(dxf(lw([[100, 50], [100, 70], [130, 70], [130, 50]])));
    expect([s.w, s.h]).toEqual([30, 20]);
    expect(s.segs).toHaveLength(4);
    expect(area(flatten(s))).toBeCloseTo(600, 6);
    expect(s.points.some(([x, y]) => x === 0 && y === 0)).toBe(true);
  });

  it('LINE + ARC 를 이어 사분원 단면 — 원호 구간 하나(bulge = tan 22.5°)', () => {
    const arc = [[0, 'ARC'], [10, 0], [20, 0], [40, 20], [50, 0], [51, 90]];
    const s = parseLineWallDxf(dxf([...line(0, 0, 20, 0), ...arc, ...line(0, 20, 0, 0)]));
    expect(s.segs).toHaveLength(3);
    const arcs = s.segs.filter((g) => g.bulge);
    expect(arcs).toHaveLength(1);
    expect(Math.abs(arcs[0].bulge!)).toBeCloseTo(Math.tan(Math.PI / 8), 6);
    expect([s.w, s.h]).toEqual([20, 20]);
    // 원호는 10° 간격 꺾은선 — 정확한 넓이와 1% 안
    expect(Math.abs(area(flatten(s)) - (Math.PI * 400) / 4) / ((Math.PI * 400) / 4)).toBeLessThan(0.01);
    const g = arcs[0];
    expect(segLength(s.points[g.a], s.points[g.b], g.bulge)).toBeCloseTo((Math.PI * 20) / 2, 6);
  });

  it('쿠지알러 파일 요건 — 열린 윤곽·두 윤곽·타원·1mm 이하·20m 이상은 오류', () => {
    expect(() => parseLineWallDxf(dxf(lw([[0, 0], [10, 0], [10, 10]], false)))).toThrow(LW_FILE_RULES[0]);
    expect(() => parseLineWallDxf(dxf([...lw([[0, 0], [10, 0], [10, 10]]), ...lw([[50, 50], [60, 50], [60, 60]])]))).toThrow(LW_FILE_RULES[0]);
    expect(() => parseLineWallDxf(dxf([[0, 'ELLIPSE'], [10, 0], [20, 0]]))).toThrow(LW_FILE_RULES[1]);
    expect(() => parseLineWallDxf(dxf(lw([[0, 0], [0.5, 0], [0.5, 10], [0, 10]])))).toThrow(LW_FILE_RULES[2]);
    expect(() => parseLineWallDxf(dxf(lw([[0, 0], [25000, 0], [25000, 10], [0, 10]])))).toThrow(LW_FILE_RULES[3]);
  });

  it('단위(cm → mm)·거울 좌표(230 = -1)·글자 같은 비그리기 요소 무시', () => {
    const cm = parseLineWallDxf(dxf(lw([[0, 0], [3, 0], [3, 2], [0, 2]]), 5));
    expect([cm.w, cm.h]).toEqual([30, 20]);
    const mir = parseLineWallDxf(dxf([...lw([[0, 0], [3, 0], [3, 2], [0, 2]], true, [[230, -1]]), [0, 'TEXT'], [10, 0], [20, 0], [1, '메모']]));
    expect([mir.w, mir.h]).toEqual([3, 2]);
    expect(area(flatten(mir))).toBeGreaterThan(0);
  });

  it('그린 단면(꺾은선)도 같은 형식', () => {
    const s = shapeFromPolygon([[0, 0], [30, 0], [30, 10], [10, 10], [10, 40], [0, 40]]);
    expect(s.segs).toHaveLength(6);
    expect([s.w, s.h]).toEqual([30, 40]);
  });
});

describe('덧붙임 재질 · 크기', () => {
  const m = (id: string) => ({ id, name: id, img: '' });
  it('구간별 → 범위: 이어지고 재질·방식이 같으면 하나로 (쿠지알러 Yc)', () => {
    const per = new Map<number, { mat: ReturnType<typeof m>; mode: LwMode }>([[3, { mat: m('a'), mode: 'fit' }], [1, { mat: m('a'), mode: 'fit' }], [2, { mat: m('a'), mode: 'fit' }], [4, { mat: m('a'), mode: 'tile' }], [6, { mat: m('b'), mode: 'fit' }]]);
    expect(mergeAttach(per).map((x) => [x.start, x.end, x.mat.id, x.mode])).toEqual([[1, 3, 'a', 'fit'], [4, 4, 'a', 'tile'], [6, 6, 'b', 'fit']]);
  });

  it('크기 — 몰딩 고정 10~8000 또는 맞춤, 벽판 규격 10~6000·맞춤 최대는 최대 규격 이상 20000 이하', () => {
    const W = { specific: false, specs: ['0'], customized: false, customizedSize: '' };
    expect(sizeError(260, { customized: false, length: '' }, W)).toMatch('크기를 입력하세요');
    expect(sizeError(260, { customized: false, length: '2400' }, W)).toBe('');
    expect(sizeError(260, { customized: true, length: '' }, W)).toBe('');
    expect(sizeError(613, { customized: false, length: '' }, W)).toBe('크기를 입력하세요');
    expect(sizeError(613, { customized: false, length: '' }, { ...W, specific: true, specs: ['2400', '2700'] })).toBe('');
    expect(sizeError(613, { customized: false, length: '' }, { ...W, specific: true, specs: ['2400', '7000'] })).toMatch('규격 길이');
    expect(sizeError(613, { customized: false, length: '' }, { specific: true, specs: ['2700'], customized: true, customizedSize: '2400' })).toBe('올바른 길이의 맞춤 규격을 입력하세요');
    expect(sizeError(613, { customized: false, length: '' }, { specific: true, specs: ['2700'], customized: true, customizedSize: '3000' })).toBe('');
  });
});

describe('직접 그린 단면 → 구간', () => {
  it('직접 그린 단면 — 둥근 모서리 5mm 도 원호 한 구간이라 1mm 규칙에 걸리지 않고, 사분원은 3구간', () => {
    const tpl = (k: string) => SECTION_TEMPLATES.find((x) => x.key === k)!;
    const sk = sectionArcs(stringifyLinePath(tpl('skirt').build({ W: 15, H: 80, R: 5 })));
    const a = shapeFromPolygon(sk.points, sk.bulges);
    expect(a.segs).toHaveLength(5);
    expect([a.w, a.h]).toEqual([15, 80]);
    const q = sectionArcs(stringifyLinePath(tpl('quarter').build({ R: 30 })));
    const b = shapeFromPolygon(q.points, q.bulges);
    expect(b.segs).toHaveLength(3);
    expect(b.segs.filter((g) => g.bulge)).toHaveLength(1);
  });
});
