import { describe, expect, it } from 'vitest';
import { newScheme, PV_CLIP_DEFAULTS, type PvClipType, type PvPaving, type PvScheme, type PvSprite, type PvTile } from '../../../data/paving';
import { area, bounds, clipOutline, countRefs, layoutScheme, offsetPolygon, refsIn, schemeScope } from './pavingGeom';

const sp = (id: string, w = 1200, h = 600, weight = 1): PvSprite => ({ id, name: id, img: '', w, h, weight });
const tile = (over: Partial<PvTile> = {}): PvTile => ({ kind: 'tile', id: 't1', sprites: [sp('a')], multi: false, machine: null, x: '0', y: '0', angle: '0', ...over });
const paving = (over: Partial<PvPaving> = {}): PvPaving => ({
  kind: 'paving', id: 'p1', name: '포설', tiles: [tile()],
  u: { x: '1200', y: '0', pos: 'INF', neg: 'INF' }, v: { x: '0', y: '600', pos: 'INF', neg: 'INF' },
  sx: '5943', sy: '4944', angle: '0', gap: '0', gapColor: '', cornerCut: '0', ...over,
});
const scheme = (nodes: PvScheme['nodes'], over: Partial<PvScheme> = {}): PvScheme => ({ ...newScheme(), nodes, ...over });
const machine = (type: PvClipType, params: Record<string, string> = {}) => ({ type, params: { ...PV_CLIP_DEFAULTS[type], ...params }, texX: '0', texY: '0', texRot: '0' });
const sc = schemeScope(newScheme());

describe('소재 가공 모양 — 쿠지알러 화면에서 확인한 정의', () => {
  it('기본값: 육각형 위·아래 평평(폭 2a), 삼각형 꼭짓점 (h/tanθ, h), 평행사변형·사다리꼴 윗변 이동', () => {
    const hex = bounds(clipOutline(machine('HEXAGON'), [1200, 600], sc));
    expect([hex.x0, hex.y0, hex.x1]).toEqual([0, 0, 400]);
    expect(hex.y1).toBeCloseTo(200 * Math.sqrt(3), 6);
    const tri = clipOutline(machine('TRIANGLE'), [1200, 600], sc);
    expect(tri[2][0]).toBeCloseTo(400, 6);
    expect(tri[2][1]).toBe(400);
    const par = clipOutline(machine('PARALLELOGRAM'), [1200, 600], sc);
    expect(par[3][0]).toBeCloseTo(400 / Math.tan((63 * Math.PI) / 180), 6);
    const trap = clipOutline(machine('TRAPEZOID'), [1200, 600], sc);
    expect(trap.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([[0, 0], [450, 0], [300, 150], [150, 150]]);
  });

  it('별: a×a, 양 끝 직선 b, 네 변이 안으로 오목 / 둥근 모서리: 귀퉁이를 작은 별 1/4 로 따냄', () => {
    const star = clipOutline(machine('STAR', { size: '600', arcHigh: '100', straightEdge: '100' }), [1200, 600], sc);
    const b = bounds(star);
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([0, 0, 600, 600]);
    expect(star.some(([x, y]) => x === 100 && y === 0)).toBe(true);
    const a = Math.abs(area(star));
    expect(a).toBeLessThan(600 * 600);
    expect(a).toBeGreaterThan(600 * 600 - 4 * (400 * 100));
    const round = clipOutline(machine('ROUNDED_CORNER', { size: '800', smallSize: '300', arcHigh: '60', straightEdge: '60' }), [1200, 600], sc);
    const rb = bounds(round), k = 300 / Math.SQRT2, ra = Math.abs(area(round));
    expect([rb.x0, rb.y0, rb.x1, rb.y1].map(Math.round)).toEqual([0, 0, 800, 800]);
    expect(ra).toBeLessThan(800 * 800 - 4 * (k * k) / 2 + 4 * 300 * 60);
    expect(ra).toBeGreaterThan(800 * 800 - 4 * (k * k) / 2);
  });

  it('가공 없음·원래 모양은 상품 크기, 줄눈 오프셋은 바깥으로 넓힘', () => {
    expect(clipOutline(null, [1200, 600], sc)).toEqual([[0, 0], [1200, 0], [1200, 600], [0, 600]]);
    expect(clipOutline(machine('ORIGIN'), [300, 300], sc)).toEqual([[0, 0], [300, 0], [300, 300], [0, 300]]);
    const o = bounds(offsetPolygon([[0, 0], [100, 0], [100, 50], [0, 50]], 10));
    expect([o.x0, o.y0, o.x1, o.y1].map((v) => Math.round(v * 1000) / 1000)).toEqual([-10, -10, 110, 60]);
  });
});

describe('포설 방식 배치', () => {
  it('1200×600 을 (5943,4944) 에서 U·V 무한 → 캔버스 10000 을 덮는 9열×18행, 모서리 따기면 온전한 7열×16행', () => {
    expect(layoutScheme(scheme([paving()])).placed.length).toBe(9 * 18);
    const cut = layoutScheme(scheme([paving({ cornerCut: '1' })])).placed;
    expect(cut.length).toBe(7 * 16);
    cut.forEach((p) => expect(Math.abs(area(p.poly))).toBeCloseTo(1200 * 600, 3));
  });

  it('개수: 정방향 n → 0..n-1, 역방향 m → -1..-m, 이동 벡터 0 이면 한 자리', () => {
    const fin = layoutScheme(scheme([paving({ u: { x: '1200', y: '0', pos: '3', neg: '2' }, v: { x: '0', y: '600', pos: '1', neg: '0' } })])).placed;
    expect(fin.map((p) => p.i).sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    const zero = layoutScheme(scheme([paving({ u: { x: '0', y: '0', pos: 'INF', neg: 'INF' }, v: { x: '0', y: '600', pos: '1', neg: '0' } })])).placed;
    expect(zero.length).toBe(1);
  });

  it('캔버스 밖은 잘리고, 매개변수 수식(BBW)도 계산된다', () => {
    const s = scheme([paving({ sx: 'BBW-600', sy: '0', u: { x: '1200', y: '0', pos: '1', neg: '0' }, v: { x: '0', y: '600', pos: '1', neg: '0' } })]);
    const [p] = layoutScheme(s).placed;
    const b = bounds(p.poly);
    expect([b.x0, b.x1, b.y0, b.y1]).toEqual([9400, 10000, 0, 600]);
  });

  it('다중 타일 혼합은 비율대로(1:3), 같은 자리에는 늘 같은 소재', () => {
    const t = tile({ multi: true, sprites: [sp('a', 100, 100, 1), sp('b', 100, 100, 3)] });
    const s = scheme([paving({ tiles: [t], u: { x: '100', y: '0', pos: 'INF', neg: 'INF' }, v: { x: '0', y: '100', pos: 'INF', neg: 'INF' }, sx: '0', sy: '0' })], { bbw: '4000', bbh: '4000' });
    const a = layoutScheme(s).placed, b = layoutScheme(s).placed;
    const nb = a.filter((p) => p.sprite?.id === 'b').length / a.length;
    expect(nb).toBeGreaterThan(0.7);
    expect(nb).toBeLessThan(0.8);
    expect(a.map((p) => p.sprite?.id)).toEqual(b.map((p) => p.sprite?.id));
  });

  it('타일 2만 장을 넘으면 overflow', () => {
    const s = scheme([paving({ tiles: [tile({ sprites: [sp('a', 50, 50)] })], u: { x: '50', y: '0', pos: 'INF', neg: 'INF' }, v: { x: '0', y: '50', pos: 'INF', neg: 'INF' }, sx: '0', sy: '0' })]);
    const l = layoutScheme(s);
    expect(l.overflow).toBe(true);
    expect(l.placed.length).toBe(20000);
  });
});

describe('매개변수 참조', () => {
  it('수식의 참조명을 찾고, 쓰는 곳을 센다 (함수·시스템 이름 제외)', () => {
    expect(refsIn('sqrt(W)*2+BBW-cos(A)')).toEqual(['W', 'A']);
    const s = scheme([paving({ u: { x: 'W', y: '0', pos: 'INF', neg: 'INF' }, gapColor: 'GC' })], { params: [{ name: '폭', ref: 'W', type: 'NUMERIC', value: '1200' }, { name: '줄눈색', ref: 'GC', type: 'GAP_MATERIAL', value: '#ffffff' }] });
    expect(countRefs(s, 'W')).toBe(1);
    expect(countRefs(s, 'GC')).toBe(1);
    expect(layoutScheme(s).placed[0].gapColor).toBe('#ffffff');
  });
});
