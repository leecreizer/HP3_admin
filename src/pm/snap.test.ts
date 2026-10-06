import { describe, expect, it } from 'vitest';
import { pointOnSegment, shiftExpr, snapPoint } from './snap';

// 사각형 600×500 가운데 기준 (쿠지알러 기본 판재 윤곽)
const pts: [number, number][] = [[-300, -250], [-300, 250], [300, 250], [300, -250]];
const exprs = [{ x: '-#W/2', y: '-#D/2' }, { x: '-#W/2', y: '#D/2' }, { x: '#W/2', y: '#D/2' }, { x: '#W/2', y: '-#D/2' }];

describe('윤곽 편집 스냅(직각 가이드)', () => {
  it('이웃 점과 수직·수평 정렬 — 수식을 이어받는다', () => {
    const r = snapPoint({ pts, exprs, i: 2, closed: true, m: [296, 180], tol: 8, start: { pos: [300, 250], x: '#W/2', y: '#D/2' } });
    expect(r.pos[0]).toBe(300);
    expect(r.x).toBe('#W/2'); // 뒤 점(점4)과 같은 X
    expect(r.y).toBeUndefined();
    expect(r.guides.length).toBe(1);
  });
  it('두 축 모두 붙으면 직각 표시', () => {
    const r = snapPoint({ pts, exprs, i: 2, closed: true, m: [303, 247], tol: 8, start: { pos: [300, 250], x: '#W/2', y: '#D/2' } });
    expect(r.pos).toEqual([300, 250]);
    expect(r.x).toBe('#W/2');
    expect(r.y).toBe('#D/2');
    expect(r.marks.length).toBeGreaterThan(0);
  });
  it('정렬이 없으면 이웃 꼭짓점이 직각이 되는 선에 붙는다', () => {
    // 점1 을 (-150, -250) 쪽으로 옮기며 점2(-300,250)-점3 변에 수직인 선(x=-300)에서 벗어난 경우 → 스냅 없음
    const free = snapPoint({ pts, exprs, i: 0, closed: true, m: [-150, -120], tol: 8, start: { pos: [-300, -250], x: '-#W/2', y: '-#D/2' } });
    expect(free.x).toBeUndefined();
    expect(free.y).toBeUndefined();
    // 기울어진 이웃 변: 점1(0,0) 점2(100,100) 점3(200,0) 에서 점3 을 움직일 때 점2 직각선(점2 에서 (1,1) 에 수직) 근처
    const tri: [number, number][] = [[0, 0], [100, 100], [200, 0]];
    const e3 = tri.map(([x, y]) => ({ x: String(x), y: String(y) }));
    const r = snapPoint({ pts: tri, exprs: e3, i: 2, closed: false, m: [215, -12], tol: 8, start: { pos: [500, 500], x: '500', y: '500' } });
    // 점2 에서 변(점1→점2) 방향 (1,1)/√2 에 수직인 선: x + y = 200
    expect(Math.abs(r.pos[0] + r.pos[1] - 200)).toBeLessThan(1e-6);
    expect(r.marks.length).toBeGreaterThan(0);
  });
  it('선 위 클릭 — 수평선이면 Y 수식 유지', () => {
    const r = pointOnSegment([-300, 250], [300, 250], exprs[1], exprs[2], [120, 262]);
    expect(r.pos).toEqual([120, 250]);
    expect(r.y).toBe('#D/2');
    expect(r.x).toBeUndefined();
  });
});

describe('좌표 수식 옮기기', () => {
  it('숫자 · 수식 · 끝 숫자 합치기 · 조건식 괄호', () => {
    expect(shiftExpr('100', 25)).toBe('125');
    expect(shiftExpr('#W/2', 30)).toBe('#W/2+30');
    expect(shiftExpr('#W/2+30', 10)).toBe('#W/2+40');
    expect(shiftExpr('#W/2+30', -30)).toBe('#W/2');
    expect(shiftExpr('#D-100', 30)).toBe('#D-70');
    expect(shiftExpr('#W/2*-3', 5)).toBe('#W/2*-3+5');
    expect(shiftExpr('#A>1?#W:#D', -5)).toBe('(#A>1?#W:#D)-5');
    expect(shiftExpr('#W', 0)).toBe('#W');
  });
});
