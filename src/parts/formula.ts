import type { Corner, PartVar, Vec2 } from './types';

/**
 * 파츠용 경량 수식 평가기. 좌표·변수 계산에 필요한 사칙·괄호·단항·함수를 지원.
 * 지원: + - * / %, 단항 -, 괄호, 숫자, 변수(식별자, 앞의 # 무시),
 * 함수 abs/sqrt/round/floor/ceil/pow/min/max/sin/cos/tan(도 단위).
 * 평가 실패(문법 오류·미정의 변수 등)면 null 반환.
 */
export function evalExpr(expr: string | undefined, scope: Record<string, number>): number | null {
  if (expr == null) return null;
  const s = String(expr).trim();
  if (s === '') return null;
  const re = /[0-9]*\.?[0-9]+|[A-Za-z_#가-힣][A-Za-z0-9_.가-힣]*|[-+*/%(),]/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) tokens.push(m[0]);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];

  const FUNCS: Record<string, (...a: number[]) => number> = {
    abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    pow: Math.pow, min: Math.min, max: Math.max,
    sin: (x) => Math.sin((x * Math.PI) / 180),
    cos: (x) => Math.cos((x * Math.PI) / 180),
    tan: (x) => Math.tan((x * Math.PI) / 180),
  };

  function parseAdd(): number {
    let v = parseMul();
    while (peek() === '+' || peek() === '-') { const op = next(); const r = parseMul(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function parseMul(): number {
    let v = parseUnary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(); const r = parseUnary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parseUnary(): number {
    if (peek() === '-') { next(); return -parseUnary(); }
    if (peek() === '+') { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = next();
    if (t === undefined) throw new Error('eof');
    if (t === '(') { const v = parseAdd(); if (next() !== ')') throw new Error(')'); return v; }
    if (/^[0-9.]/.test(t)) return parseFloat(t);
    if (peek() === '(') { // 함수 호출
      next();
      const args: number[] = [];
      if (peek() !== ')') { args.push(parseAdd()); while (peek() === ',') { next(); args.push(parseAdd()); } }
      if (next() !== ')') throw new Error(')');
      const fn = FUNCS[t.toLowerCase()];
      if (!fn) throw new Error('fn ' + t);
      return fn(...args);
    }
    const key = t.replace(/^#/, '');
    if (Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
    throw new Error('var ' + t);
  }

  try {
    const v = parseAdd();
    if (p !== tokens.length) return null; // 남은 토큰 = 문법 오류
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** 변수 목록을 순서대로 평가해 스코프를 만든다(뒤 변수는 앞 변수를 참조 가능). extra는 내장값(T=두께 등). */
export function buildScope(vars: PartVar[] | undefined, extra: Record<string, number> = {}): Record<string, number> {
  const scope: Record<string, number> = { ...extra };
  for (const v of vars ?? []) {
    if (!v.name) continue;
    const val = evalExpr(v.expr, scope);
    if (val != null) scope[v.name.replace(/^#/, '')] = val;
  }
  return scope;
}

/** 각 꼭지점의 xExpr/yExpr가 있으면 평가해 pt로 확정한다(없으면 리터럴 pt 사용). */
export function resolveCorners(cs: Corner[], scope: Record<string, number>): Corner[] {
  return cs.map((c) => {
    const x = c.xExpr ? evalExpr(c.xExpr, scope) : null;
    const y = c.yExpr ? evalExpr(c.yExpr, scope) : null;
    const pt: Vec2 = [x ?? c.pt[0], y ?? c.pt[1]];
    return { ...c, pt };
  });
}