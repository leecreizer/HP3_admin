import { describe, it, expect } from 'vitest';
import { evalExpr, buildScope, resolveCorners } from './formula';
import type { Corner } from './types';

describe('evalExpr', () => {
  it('사칙연산·우선순위', () => {
    expect(evalExpr('2 + 3 * 4', {})).toBe(14);
    expect(evalExpr('(2 + 3) * 4', {})).toBe(20);
    expect(evalExpr('10 / 4', {})).toBe(2.5);
  });
  it('변수 참조(#접두 무시)', () => {
    expect(evalExpr('#W / 2', { W: 600 })).toBe(300);
    expect(evalExpr('W + H', { W: 100, H: 20 })).toBe(120);
  });
  it('함수', () => {
    expect(evalExpr('max(10, 20)', {})).toBe(20);
    expect(evalExpr('sqrt(144)', {})).toBe(12);
    expect(evalExpr('round(sin(90))', {})).toBe(1); // 도 단위
  });
  it('단항 음수', () => {
    expect(evalExpr('-5 + 3', {})).toBe(-2);
  });
  it('비교 연산은 1/0', () => {
    expect(evalExpr('600 == 600-(18*2)', {})).toBe(0); // 600 vs 564
    expect(evalExpr('#W == 600-(18*2)', { W: 564 })).toBe(1);
    expect(evalExpr('#W >= 500', { W: 564 })).toBe(1);
    expect(evalExpr('3 < 2', {})).toBe(0);
  });
  it('논리·부정', () => {
    expect(evalExpr('#W>500 && #H<800', { W: 564, H: 720 })).toBe(1);
    expect(evalExpr('!(1)', {})).toBe(0);
    expect(evalExpr('0 || 5', {})).toBe(1);
  });
  it('삼항 조건식', () => {
    expect(evalExpr('#W>500 ? 600 : 400', { W: 564 })).toBe(600);
    expect(evalExpr('#W>500 ? 600 : 400', { W: 300 })).toBe(400);
    expect(evalExpr('#W>500 ? #W-36 : #W', { W: 564 })).toBe(528);
  });
  it('미정의 변수·문법오류는 null', () => {
    expect(evalExpr('#missing + 1', {})).toBeNull();
    expect(evalExpr('2 +', {})).toBeNull();
    expect(evalExpr('', {})).toBeNull();
  });
});

describe('buildScope', () => {
  it('앞 변수 참조 가능 + 내장값', () => {
    const s = buildScope([{ name: 'W', expr: '600' }, { name: 'HalfW', expr: '#W / 2' }], { T: 18 });
    expect(s.W).toBe(600);
    expect(s.HalfW).toBe(300);
    expect(s.T).toBe(18);
  });
});

describe('resolveCorners', () => {
  it('수식 좌표를 평가해 pt로 확정, 없으면 리터럴 유지', () => {
    const cs: Corner[] = [
      { pt: [0, 0] },
      { pt: [0, 0], xExpr: '#W', yExpr: '0' },
      { pt: [0, 0], xExpr: '#W', yExpr: '#H' },
    ];
    const out = resolveCorners(cs, { W: 600, H: 720 });
    expect(out[0].pt).toEqual([0, 0]);
    expect(out[1].pt).toEqual([600, 0]);
    expect(out[2].pt).toEqual([600, 720]);
  });
  it('수식 평가 실패 시 리터럴 pt로 폴백', () => {
    const cs: Corner[] = [{ pt: [50, 60], xExpr: '#bad' }];
    expect(resolveCorners(cs, {})[0].pt).toEqual([50, 60]);
  });
});