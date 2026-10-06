import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { evaluate, fmt, renameRef, renameVar, tNum, tStr, toStr, type Scope, type Typed } from './expr';
import { expandNumPath, parsePlankPath, rectPath, stringifyPlankPath } from './path';
import { PmEval, basicVars, referenceGraph } from './resolve';
import { buildModel } from './geometry';
import { newModel } from './store';
import { DEFS, defaultParams, elementDef } from './defs';
import type { PmModel, PmNode, PmVar } from './types';

const scope = (vars: Record<string, Typed>, extra: Partial<Scope> = {}): Scope => ({ getVar: (n) => vars[n], ...extra });
const ev = (e: string, vars: Record<string, Typed> = {}, extra: Partial<Scope> = {}) => evaluate(e, scope(vars, extra));
const val = (e: string, vars: Record<string, Typed> = {}, extra: Partial<Scope> = {}) => { const t = ev(e, vars, extra); return t.k === 'null' ? null : t.v; };

describe('수식 (쿠지알러 함수 설명 예제)', () => {
  it('정수끼리 나누면 몫, 소수점을 쓰면 실수', () => {
    expect(val('7/2')).toBe(3);
    expect(val('7/2.0')).toBe(3.5);
    expect(val('#N/2', { N: tNum(7, true) })).toBe(3);
    expect(val('#W/2', { W: tNum(7) })).toBe(3.5);
  });
  it('실수를 문자와 이으면 .0 — float2Int 로 정수', () => {
    expect(val('#D+"AA"', { D: tNum(500) })).toBe('500.0AA');
    expect(val('#float2Int(#D)+"AA"', { D: tNum(500) })).toBe('500AA');
  });
  it('조건 중첩 · AND/OR 단어 · 거듭제곱근', () => {
    expect(val('#W < 2500 ? 0 : #D > 500 ? 200 : #D1', { W: tNum(3000), D: tNum(600), D1: tNum(1) })).toBe(200);
    expect(val('#W >= 200 AND #D <= 500 AND #H > 1200', { W: tNum(300), D: tNum(500), H: tNum(1500) })).toBe(true);
    expect(val('#YS==\'좌\'or#YS==\'우\'', { YS: tStr('우') })).toBe(true);
    expect(val('#W ^ 0.5', { W: tNum(16) })).toBe(4);
  });
  it('문자 함수 — left · right · mid · strToNum · firstIndexOf', () => {
    expect(val("left('hello', 3)")).toBe('hel');
    expect(val("right('hello', 4)")).toBe('ello');
    expect(val("mid('hello', 2, 3)")).toBe('ell');
    expect(val("strToNum(RIGHT('V10010', 5)) - 10")).toBe(10000);
    expect(val('#left(#code, #firstIndexOf(#code, "-"))', { code: tStr('abc-def') })).toBe('abc');
  });
  it('deRound · rad · round', () => {
    expect(val('#deRound(3.1415926,2)')).toBe(3.14);
    expect(val('#deRound(13.14,-1)')).toBe(10);
    expect(val('#rad(10, 5)')).toBe(5);
    expect(val('#rad(10, 6)')).toBe(0);
    expect(val('round(3.7)')).toBe(4);
  });
  it('isNull — 없는 부품 속성은 참', () => {
    const refs: Scope['getRef'] = (r, p) => (r === 'MB' && p[0] === 'W' ? tNum(600) : undefined);
    expect(val('#isNull(@MB.W)', {}, { getRef: refs })).toBe(false);
    expect(val('#isNull(@MB.Z)', {}, { getRef: refs })).toBe(true);
  });
  it('복합 수식 함수 — isValue · statusSum · average', () => {
    const vars = { L0: tNum(100), L1: tNum(200), L2: tNum(300), N: tNum(3, true), LMAX: tNum(50), D: tNum(1000) };
    const states: Record<string, 'value' | 'formula'> = { L0: 'value', L1: 'formula', L2: 'formula' };
    const x = { varState: (n: string) => states[n] };
    expect(val('isValue("\'L0\'")', vars, x)).toBe(true);
    expect(val('isValue("\'L1\'")', vars, x)).toBe(false);
    expect(val('#statusSum(#LMAX, #N, "\'L0\'", "\'L1\'", "\'L2\'")', vars, x)).toBe(200);
    expect(val('#average(#D, #N, "\'L0\'", "\'L1\'", "\'L2\'")', vars, x)).toBe(450);
  });
  it('getOptionName · 전각 괄호', () => {
    const x = { options: (n: string) => (n === 'P1' ? [{ name: '세면대 A', value: '0' }, { name: '세면대 B', value: '1' }] : undefined) };
    expect(val('#getOptionName("P1", 1)', {}, x)).toBe('세면대 B');
    expect(val('#getOptionName("P9", 1)', {}, x)).toBe(null);
    expect(val('#left(#S,3）', { S: tStr('abcdef') })).toBe('abc');
  });
  it('이름 바꾸기 — 문자열 안은 그대로', () => {
    expect(renameVar("#W+#W1+'#W'", 'W', 'WD')).toBe("#WD+#W1+'#W'");
    expect(renameRef('@MB.W+@selfMB.H', 'MB', 'DOOR')).toBe('@DOOR.W+@selfDOOR.H');
  });
});

function model(vars: PmVar[], nodes: PmNode[] = []): PmModel {
  const m = newModel({ tooltype: 'cabinet', library: '테스트', category: '테스트' });
  return { ...m, vars, nodes };
}
const v = (name: string, p: Partial<PmVar>): PmVar => ({ id: name, scope: 'custom', name, label: name, type: 'float', valueType: 'range', value: '0', ...p });
const plank = (id: string, params: Record<string, string>, refName?: string): PmNode =>
  ({ id, def: 'PrimitiveModel.plank', name: id, refName, params: { ...defaultParams(elementDef('PrimitiveModel.plank')!, 'cabinet'), ...params } });

describe('계산기', () => {
  it('구간 · 수식 · 복합 수식 · 중간 변수', () => {
    const m = model([
      ...basicVars(600, 500, 720),
      v('W1', { min: '100', max: '#W-100', value: '300' }),
      v('A', { scope: 'middle', valueType: 'formula', formula: '#W-#W1' }),
      v('C', { valueType: 'composite', formula: '#W/2', value: '10', state: 'formula' }),
    ]);
    const e = new PmEval(m);
    expect(fmt(e.varTyped('A'))).toBe('300');
    expect(e.varEval('W1')!.max).toBe(500);
    expect(fmt(e.varTyped('C'))).toBe('300');
    const e2 = new PmEval(m, { states: { C: 'value' } });
    expect(fmt(e2.varTyped('C'))).toBe('10');
  });
  it('순환 참조를 진단한다', () => {
    const m = model([v('A', { valueType: 'formula', formula: '#B+1' }), v('B', { valueType: 'formula', formula: '#A+1' })]);
    const e = new PmEval(m);
    e.diagsAll();
    expect(e.diags.some((d) => d.message.includes('순환 참조'))).toBe(true);
  });
  it('구간 밖 현재값 경고', () => {
    const e = new PmEval(model([v('X', { min: '0', max: '10', value: '20' })]));
    e.diagsAll();
    expect(e.diags.some((d) => d.level === 'warn' && d.varName === 'X')).toBe(true);
  });
  it('@부품 참조 — 판재 두께 · W(윤곽 폭)', () => {
    const m = model(basicVars(800, 500, 720), [
      plank('p1', { thickness: '#H/40' }, 'MB'),
      plank('p2', { thickness: '@MB.thickness*2', position: '{"x":"@MB.W","y":"0","z":"0"}' }),
    ]);
    const e = new PmEval(m);
    expect(e.numParam(m.nodes[1], 'thickness')).toBe(36);
    expect(e.vec(m.nodes[1], 'position')[0]).toBe(800);
  });
  it('하위 모델 — 부모가 정한 W 로 계산하고 @참조로 읽는다', () => {
    const child = model([...basicVars(400, 300, 200), v('K', { valueType: 'formula', formula: '#W*2' })]);
    const inst: PmNode = { id: 'i1', def: 'instance', name: '문짝', refName: 'MB', sub: { kind: 'param', id: child.id, name: '문짝' }, params: { ...defaultParams(DEFS.instance), W: '#W/2', D: '18', H: '#H' } };
    const parent = model([...basicVars(1000, 500, 700), v('R', { scope: 'report', valueType: 'formula', formula: '@MB.K' })], [inst]);
    const e = new PmEval(parent, { catalog: { model: (id) => (id === child.id ? child : undefined) } });
    expect(fmt(e.varTyped('R'))).toBe('1000');
  });
  it('참조 보기 그래프', () => {
    const m = model([...basicVars(), v('A', { valueType: 'formula', formula: '#W-#D' })], [plank('p1', { thickness: '#A' }, 'MB')]);
    const g = referenceGraph(m);
    expect(g.some((x) => x.from === '#A' && x.to === '#W')).toBe(true);
    expect(g.some((x) => x.from === '@MB' && x.to === '#A')).toBe(true);
  });
});

describe('판재 윤곽 경로', () => {
  it('쿠지알러 기본 plankPath 왕복', () => {
    const raw = elementDef('PrimitiveModel.plank')!.params.find((p) => p.name === 'plankPath')!.value!;
    const sh = parsePlankPath(raw);
    expect(sh.outline.points.map((p) => [p.x, p.y])).toEqual([['-#W/2', '-#D/2'], ['-#W/2', '#D/2'], ['#W/2', '#D/2'], ['#W/2', '-#D/2']]);
    const again = parsePlankPath(stringifyPlankPath(sh));
    expect(again.outline.points).toEqual(sh.outline.points);
  });
  it('둥근 모서리 · 모따기 · 원호 선', () => {
    const sq = (t: 0 | 1 | 2, r = 0, a = 0, b = 0) => [
      { x: 0, y: 0, type: 0 as const, radius: 0, a: 0, b: 0 }, { x: 0, y: 100, type: 0 as const, radius: 0, a: 0, b: 0 },
      { x: 100, y: 100, type: t, radius: r, a, b }, { x: 100, y: 0, type: 0 as const, radius: 0, a: 0, b: 0 }];
    const lines = [0, 1, 2, 3].map(() => ({ type: 0 as const, radius: 0, clockwise: false, minor: true }));
    const filleted = expandNumPath(sq(1, 20), lines, true);
    expect(filleted.length).toBeGreaterThan(6);
    const maxDist = Math.max(...filleted.map(([x, y]) => Math.hypot(x - 80, y - 80)));
    expect(maxDist).toBeLessThan(80 * Math.SQRT2 + 1e-6);
    // 둥근 모서리 위 점은 중심(80,80)에서 20
    expect(filleted.filter(([x, y]) => x > 80 && y > 80).every(([x, y]) => Math.abs(Math.hypot(x - 80, y - 80) - 20) < 1e-6)).toBe(true);
    const chamfered = expandNumPath(sq(2, 0, 30, 10), lines, true);
    expect(chamfered).toContainEqual([70, 100]);
    expect(chamfered).toContainEqual([100, 90]);
    const arcLines = lines.map((l, i) => (i === 1 ? { ...l, type: 1 as const, radius: 50, clockwise: true } : l));
    const arc = expandNumPath(sq(0), arcLines, true);
    expect(Math.max(...arc.map(([, y]) => y))).toBeGreaterThan(149);
  });
  it('사각형 형상 템플릿', () => {
    const p = rectPath('0', '0', '#W', '#D', 'c');
    expect(p.points.map((x) => [x.x, x.y])).toEqual([['-#W/2.0', '-#D/2.0'], ['-#W/2.0', '#D/2.0'], ['#W/2.0', '#D/2.0'], ['#W/2.0', '-#D/2.0']]);
  });
});

describe('배치 — 교육 문서 예제', () => {
  const boxOf = (m: PmModel) => {
    const r = buildModel(new PmEval(m));
    const b = new Box3();
    for (const p of r.parts) if (p.kind === 'solid' && p.geometry) { p.geometry.computeBoundingBox(); b.union(p.geometry.boundingBox!.clone().applyMatrix4(p.matrix)); }
    return b;
  };
  it('기본 판재: 좌후하 호출 → X 0..W, Y -D..0, Z 0..두께', () => {
    const b = boxOf(model(basicVars(600, 500, 18), [plank('p', {})]));
    expect([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((n) => Math.round(n) + 0)).toEqual([0, -500, 0, 600, 0, 18]);
  });
  it('문짝 판재(2.1.21): 윤곽 (0,0)(0,#W)(#H,#W)(#H,0) · 회전 X90 Y-90 → 폭 W · 두께 D · 높이 H 로 섬', () => {
    const path = stringifyPlankPath({ outline: { closed: true, lines: [0, 1, 2, 3].map(() => ({ type: 0 as const })), points: [['0', '0'], ['0', '#W'], ['#H', '#W'], ['#H', '0']].map(([x, y]) => ({ x, y, type: 0 as const })) }, holes: [], slots: [] });
    const b = boxOf(model(basicVars(450, 9, 700), [plank('p', { plankPath: path, thickness: '#D', rotationDegree: '{"x":"90","y":"-90","z":"0"}' })]));
    expect([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((n) => Math.round(n) + 0)).toEqual([0, -9, 0, 450, 0, 700]);
  });
  it('격자 문짝 4장(2.1.21)이 W×H 를 정확히 덮는다', () => {
    const W = 450, H = 700, D = 10;
    const grid = (id: string, rot: string, pos: string): PmNode => ({ id, def: 'PrimitiveModel.grid', name: id, params: {
      ...defaultParams(elementDef('PrimitiveModel.grid')!), length: '#W/2+#A', width: '#H/2+#A', thickness: '#D', plankThickness: '#W2', gridLength: '#W1', rotationDegree: rot, position: pos } });
    const m = model([...basicVars(W, D, H), v('W1', { value: '30' }), v('W2', { value: '5' }), v('A', { scope: 'middle', valueType: 'formula', formula: '((#W1^2*2)^0.5/2+(#W2^2*2)^0.5/2)' })], [
      grid('g1', '{"x":"90","y":"-180","z":"0"}', '{"x":"#W/2+#A","y":"0","z":"0"}'),
      grid('g2', '{"x":"-90","y":"0","z":"0"}', '{"x":"#W/2-#A","y":"-#D","z":"0"}'),
      grid('g3', '{"x":"90","y":"0","z":"0"}', '{"x":"#W/2-#A","y":"0","z":"#H"}'),
      grid('g4', '{"x":"90","y":"0","z":"180"}', '{"x":"#W/2+#A","y":"-#D","z":"#H"}'),
    ]);
    const b = boxOf(m);
    expect([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((n) => Math.round(n) + 0)).toEqual([0, -D, 0, W, 0, H]);
  });
  it('실수 표시는 .0 없이', () => {
    expect(fmt(tNum(500))).toBe('500');
    expect(toStr(tNum(500))).toBe('500.0');
  });
});
