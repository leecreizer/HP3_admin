import type { Corner, PartVar, Vec2, Part, Profile } from './types';

/**
 * 파츠용 경량 수식/조건식 평가기. 불리언은 1/0으로 취급.
 * 지원: 사칙 + - * / %, 단항 -/+/!, 괄호, 숫자, 변수(식별자, 앞의 # 무시),
 *   비교 == != < > <= >=, 논리 && ||, 삼항 조건식  cond ? a : b,
 *   함수 abs/sqrt/round/floor/ceil/pow/min/max/sin/cos/tan(도 단위).
 * 예) #W == 600-(18*2),  #W>500 ? 600 : 400,  min(#W, #H)/2
 * 평가 실패(문법 오류·미정의 변수 등)면 null 반환.
 */
export function evalExpr(expr: string | undefined, scope: Record<string, number>): number | null {
  if (expr == null) return null;
  const s = String(expr).trim();
  if (s === '') return null;
  const re = /[0-9]*\.?[0-9]+|[A-Za-z_#가-힣][A-Za-z0-9_.가-힣]*|==|!=|<=|>=|&&|\|\||[-+*/%(),<>!?:]/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) tokens.push(m[0]);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const B = (b: boolean) => (b ? 1 : 0);

  const FUNCS: Record<string, (...a: number[]) => number> = {
    abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    pow: Math.pow, min: Math.min, max: Math.max,
    sin: (x) => Math.sin((x * Math.PI) / 180),
    cos: (x) => Math.cos((x * Math.PI) / 180),
    tan: (x) => Math.tan((x * Math.PI) / 180),
  };

  function parseTernary(): number {
    const c = parseOr();
    if (peek() === '?') {
      next(); const a = parseTernary();
      if (next() !== ':') throw new Error(':');
      const b = parseTernary();
      return c !== 0 ? a : b;
    }
    return c;
  }
  function parseOr(): number { let v = parseAnd(); while (peek() === '||') { next(); const r = parseAnd(); v = B(v !== 0 || r !== 0); } return v; }
  function parseAnd(): number { let v = parseEq(); while (peek() === '&&') { next(); const r = parseEq(); v = B(v !== 0 && r !== 0); } return v; }
  function parseEq(): number {
    let v = parseCmp();
    while (peek() === '==' || peek() === '!=') { const op = next(); const r = parseCmp(); v = B(op === '==' ? v === r : v !== r); }
    return v;
  }
  function parseCmp(): number {
    let v = parseAdd();
    while (peek() === '<' || peek() === '>' || peek() === '<=' || peek() === '>=') {
      const op = next(); const r = parseAdd();
      v = B(op === '<' ? v < r : op === '>' ? v > r : op === '<=' ? v <= r : v >= r);
    }
    return v;
  }
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
    if (peek() === '!') { next(); return B(parseUnary() === 0); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = next();
    if (t === undefined) throw new Error('eof');
    if (t === '(') { const v = parseTernary(); if (next() !== ')') throw new Error(')'); return v; }
    if (/^[0-9.]/.test(t)) return parseFloat(t);
    if (peek() === '(') { // 함수 호출
      next();
      const args: number[] = [];
      if (peek() !== ')') { args.push(parseTernary()); while (peek() === ',') { next(); args.push(parseTernary()); } }
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
    const v = parseTernary();
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

/** 파츠의 변수·좌표 수식을 모두 평가해 확정 좌표 Profile을 반환(3D·조립 공용). */
export function resolveProfile(part: Part): Profile {
  const scope = buildScope(part.vars, { T: part.extrude.depth });
  const cs = part.profile.contours[0]?.corners ?? [];
  const resolved = resolveCorners(cs, scope);
  return { ...part.profile, contours: [{ closed: true, corners: resolved }, ...part.profile.contours.slice(1)] };
}