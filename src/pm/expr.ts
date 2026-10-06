/**
 * 쿠지알러 파라메트릭 수식 (editor/api/site/expression/functions 46개 기준) — 새 에디터 계산 엔진.
 *
 *  변수        #W  #D  #CZ               (# 생략 가능)
 *  변수 속성    #CZ.name  #CZ.productcode  #ZX.w          (재질·스타일·윤곽 변수가 가리키는 상품·윤곽의 속성)
 *  부품 참조    @MB.W  @MB.materialBrandGoodId.name       (하위 부품 참조명.변수[.속성])
 *  자기 참조    @selfMB.W  #selfMB.paramStyle.name         (부품 자신의 크기·상품 정보)
 *  연산        + - * / % ^  == != < > <= >=  AND OR (&& ||)  !  조건 ? 참값 : 거짓값
 *  문자열       'abc' "abc"   참·거짓 true false
 *
 * 값에는 형식이 있다(쿠지알러 설명 그대로):
 *  - 정수끼리 나누면 몫만 남는다 — ‘#W / 5.0 처럼 소수점을 써야 소수 결과’ (/ 함수 설명)
 *  - 실수를 문자와 이으면 ".0" 이 붙는다 — 그래서 float2Int(#D)+"AA" = "500AA" (float2Int 설명)
 */

export type PmVal = number | string | boolean | null;

/** 형식 있는 값 — n: 숫자(int = 정수형), s: 문자, b: 참·거짓 */
export type Typed = { k: 'n'; v: number; int: boolean } | { k: 's'; v: string } | { k: 'b'; v: boolean } | { k: 'null' };

export const tNum = (v: number, int = false): Typed => ({ k: 'n', v, int });
export const tStr = (v: string): Typed => ({ k: 's', v });
export const tBool = (v: boolean): Typed => ({ k: 'b', v });
export const NULL: Typed = { k: 'null' };

export const plain = (t: Typed): PmVal => (t.k === 'null' ? null : t.v);

/** 변수 형식(参数类型)에 맞춰 저장 문자열 → 값 */
export function typedOf(raw: string | null | undefined, type: string): Typed {
  const s = raw == null ? '' : String(raw);
  switch (type) {
    case 'float': case 'int': {
      if (s.trim() === '') return NULL;
      const n = Number(s);
      if (Number.isNaN(n)) return tStr(s);
      return tNum(type === 'int' ? Math.trunc(n) : n, type === 'int');
    }
    case 'boolean': {
      const l = s.trim().toLowerCase();
      if (l === 'true' || l === '1') return tBool(true);
      if (l === 'false' || l === '0' || l === '') return tBool(false);
      return tStr(s);
    }
    default:
      return tStr(s);
  }
}

export class ExprError extends Error {
  /** 없는 변수·부품·속성 — isNull 이 참으로 받는다 */
  readonly missing: boolean;
  constructor(message: string, missing = false) { super(message); this.missing = missing; }
}

/** 수식이 읽는 값들 — 계산기(resolve.ts)가 채운다 */
export interface Scope {
  /** #이름 */
  getVar(name: string): Typed | undefined;
  /** #이름.속성… — 재질·스타일·윤곽 변수 속성 또는 #self부품.paramStyle.* */
  getVarAttr?(name: string, path: string[]): Typed | undefined;
  /** @참조명.변수[.속성] (@self참조명 포함) */
  getRef?(ref: string, path: string[]): Typed | undefined;
  /** 복합 수식 변수의 상태 — isValue · statusSum · average */
  varState?(name: string): 'value' | 'formula' | undefined;
  /** getOptionName — 선택형 변수의 선택지 */
  options?(name: string): { name: string; value: string }[] | undefined;
  /** getProductCustomAttr(재질/스타일 값, 키) */
  productCustomAttr?(id: string, key: string): Typed | undefined;
  /** getSelfAttr / getSelfCustomAttr — 이 모델을 상품으로 볼 때의 속성 */
  selfAttr?(key: string): Typed | undefined;
  selfCustomAttr?(key: string): Typed | undefined;
}

/* ───────────── 구문 분석 ───────────── */

type Tok =
  | { t: 'num'; v: number; int: boolean }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string; hash: boolean; path: string[] }
  | { t: 'ref'; v: string; path: string[] }
  | { t: 'op'; v: string };

export type Ast =
  | { t: 'num'; v: number; int: boolean }
  | { t: 'str'; v: string }
  | { t: 'var'; name: string; path: string[] }
  | { t: 'ref'; ref: string; path: string[] }
  | { t: 'call'; fn: string; args: Ast[] }
  | { t: 'un'; op: string; a: Ast }
  | { t: 'bin'; op: string; a: Ast; b: Ast }
  | { t: 'cond'; c: Ast; a: Ast; b: Ast };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '^', '<', '>', '!', '?', ':', '(', ')', ','];
const ID0 = /[A-Za-z_ㄱ-힝一-鿿]/;
const ID_RE = /^[A-Za-z_ㄱ-힝一-鿿][A-Za-z0-9_ㄱ-힝一-鿿]*/;
/** 전각 괄호·쉼표(문서 예제에 섞여 있음)를 반각으로 */
const normalize = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',').replace(/＝/g, '=');

function readPath(src: string, i: number): { path: string[]; end: number } {
  const path: string[] = [];
  let j = i;
  for (;;) {
    const m = /^\.\s*([A-Za-z_ㄱ-힝一-鿿][A-Za-z0-9_ㄱ-힝一-鿿]*)/.exec(src.slice(j));
    if (!m) break;
    path.push(m[1]);
    j += m[0].length;
  }
  return { path, end: j };
}

function tokenize(raw: string): Tok[] {
  const src = normalize(raw);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]), int: !/[.e]/i.test(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) j++; s += src[j]; j++; }
      if (j >= src.length) throw new ExprError('따옴표가 닫히지 않았습니다');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '@') {
      const m = ID_RE.exec(src.slice(i + 1));
      if (!m) throw new ExprError('@ 뒤에 부품 참조명이 필요합니다');
      const { path, end } = readPath(src, i + 1 + m[0].length);
      if (!path.length) throw new ExprError(`@${m[0]} 뒤에 .변수 가 필요합니다 (예: @${m[0]}.W)`);
      out.push({ t: 'ref', v: m[0], path });
      i = end;
      continue;
    }
    if (c === '#' || ID0.test(c)) {
      const hash = c === '#';
      const m = ID_RE.exec(src.slice(hash ? i + 1 : i));
      if (!m) throw new ExprError(`이름 오류: ${src.slice(i, i + 6)}`);
      const start = (hash ? i + 1 : i) + m[0].length;
      const { path, end } = readPath(src, start);
      const name = m[0];
      if (!hash && !path.length && /^(AND|and)$/.test(name)) out.push({ t: 'op', v: '&&' });
      else if (!hash && !path.length && /^(OR|or)$/.test(name)) out.push({ t: 'op', v: '||' });
      else out.push({ t: 'id', v: name, hash, path });
      i = end;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`알 수 없는 기호: ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

function parseTokens(toks: Tok[]): Ast {
  let p = 0;
  const isOp = (v: string) => { const t = toks[p]; return !!t && t.t === 'op' && t.v === v; };
  const eat = (v: string) => { if (!isOp(v)) throw new ExprError(`'${v}' 가 필요합니다`); p++; };

  const ternary = (): Ast => {
    const c = or();
    if (isOp('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return { t: 'cond', c, a, b }; }
    return c;
  };
  const binLevel = (ops: string[], next: () => Ast) => (): Ast => {
    let a = next();
    for (;;) {
      const t = toks[p];
      if (!t || t.t !== 'op' || !ops.includes(t.v)) return a;
      p++;
      a = { t: 'bin', op: t.v, a, b: next() };
    }
  };
  const unary = (): Ast => {
    if (isOp('-')) { p++; return { t: 'un', op: '-', a: unary() }; }
    if (isOp('+')) { p++; return { t: 'un', op: '+', a: unary() }; }
    if (isOp('!')) { p++; return { t: 'un', op: '!', a: unary() }; }
    return pow();
  };
  const pow = (): Ast => {
    const a = primary();
    if (isOp('^')) { p++; return { t: 'bin', op: '^', a, b: unary() }; }
    return a;
  };
  const mul = binLevel(['*', '/', '%'], unary);
  const add = binLevel(['+', '-'], mul);
  const cmp = binLevel(['<', '>', '<=', '>='], add);
  const eq = binLevel(['==', '!='], cmp);
  const and = binLevel(['&&'], eq);
  const or = binLevel(['||'], and);

  function primary(): Ast {
    const t = toks[p];
    if (!t) throw new ExprError('수식이 끝났습니다');
    p++;
    if (t.t === 'num') return { t: 'num', v: t.v, int: t.int };
    if (t.t === 'str') return { t: 'str', v: t.v };
    if (t.t === 'ref') return { t: 'ref', ref: t.v, path: t.path };
    if (t.t === 'op') {
      if (t.v === '(') { const v = ternary(); eat(')'); return v; }
      throw new ExprError(`'${t.v}' 위치가 잘못되었습니다`);
    }
    if (!t.path.length && isOp('(')) {
      p++;
      const args: Ast[] = [];
      if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p++; args.push(ternary()); } }
      eat(')');
      return { t: 'call', fn: t.v, args };
    }
    return { t: 'var', name: t.v, path: t.path };
  }

  if (!toks.length) throw new ExprError('빈 수식');
  const ast = ternary();
  if (p !== toks.length) throw new ExprError('수식 뒤에 남는 기호가 있습니다');
  return ast;
}

const CACHE = new Map<string, Ast | ExprError>();
export function parse(expr: string): Ast {
  let hit = CACHE.get(expr);
  if (!hit) {
    try { hit = parseTokens(tokenize(expr)); } catch (e) { hit = e instanceof ExprError ? e : new ExprError(String((e as Error).message)); }
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(expr, hit);
  }
  if (hit instanceof ExprError) throw hit;
  return hit;
}

/* ───────────── 계산 ───────────── */

/** 자바 Double.toString 처럼 — 정수 값의 실수는 "500.0" */
function javaDouble(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e7) return `${v}.0`;
  return String(v);
}
export function toStr(t: Typed): string {
  switch (t.k) {
    case 'n': return t.int ? String(Math.trunc(t.v)) : javaDouble(t.v);
    case 's': return t.v;
    case 'b': return t.v ? 'true' : 'false';
    default: return 'null';
  }
}
function toNum(t: Typed, what = '값'): number {
  switch (t.k) {
    case 'n': return t.v;
    case 'b': return t.v ? 1 : 0;
    case 's': {
      const s = t.v.trim();
      if (s === '') return 0;
      if (/^(true|false)$/i.test(s)) return /^true$/i.test(s) ? 1 : 0;
      const n = Number(s);
      if (Number.isNaN(n)) throw new ExprError(`${what}이(가) 숫자가 아닙니다: '${t.v}'`);
      return n;
    }
    default: throw new ExprError(`${what}이(가) 비어 있습니다`, true);
  }
}
export function truthy(t: Typed): boolean {
  switch (t.k) {
    case 'b': return t.v;
    case 'n': return t.v !== 0;
    case 's': { const s = t.v.trim().toLowerCase(); return !(s === '' || s === 'false' || s === '0' || s === 'null'); }
    default: return false;
  }
}
const isInt = (t: Typed) => t.k === 'n' && t.int;
const numLike = (t: Typed) => t.k === 'n' || t.k === 'b' || (t.k === 's' && t.v.trim() !== '' && !Number.isNaN(Number(t.v)));

function equals(a: Typed, b: Typed): boolean {
  if (a.k === 'null' || b.k === 'null') return a.k === b.k || (a.k === 's' && a.v === '') || (b.k === 's' && b.v === '');
  if (a.k === 'b' || b.k === 'b') return truthy(a) === truthy(b);
  if (numLike(a) && numLike(b)) return Math.abs(toNum(a) - toNum(b)) < 1e-9;
  return (a.k === 'n' ? toStr(a) : String(a.v)) === (b.k === 'n' ? toStr(b) : String(b.v));
}

/** 이름이 따옴표 안에 한 번 더 따옴표로 들어오는 경우("'W'") 벗기기 */
const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');

const DEG = Math.PI / 180;

export function evalAst(ast: Ast, sc: Scope): Typed {
  const ev = (a: Ast) => evalAst(a, sc);
  switch (ast.t) {
    case 'num': return tNum(ast.v, ast.int);
    case 'str': return tStr(ast.v);
    case 'var': {
      if (!ast.path.length) {
        const v = sc.getVar(ast.name);
        if (v) return v;
        const low = ast.name.toLowerCase();
        if (low === 'true') return tBool(true);
        if (low === 'false') return tBool(false);
        if (low === 'null') return NULL;
        throw new ExprError(`변수 #${ast.name} 이(가) 없습니다`, true);
      }
      const v = sc.getVarAttr?.(ast.name, ast.path);
      if (v) return v;
      throw new ExprError(`#${ast.name}.${ast.path.join('.')} 을(를) 읽을 수 없습니다`, true);
    }
    case 'ref': {
      const v = sc.getRef?.(ast.ref, ast.path);
      if (v) return v;
      throw new ExprError(`@${ast.ref}.${ast.path.join('.')} 이(가) 없습니다`, true);
    }
    case 'un': {
      const a = ev(ast.a);
      if (ast.op === '!') return tBool(!truthy(a));
      const n = toNum(a);
      return tNum(ast.op === '-' ? -n : n, isInt(a));
    }
    case 'cond': return truthy(ev(ast.c)) ? ev(ast.a) : ev(ast.b);
    case 'bin': {
      if (ast.op === '&&') return tBool(truthy(ev(ast.a)) && truthy(ev(ast.b)));
      if (ast.op === '||') return tBool(truthy(ev(ast.a)) || truthy(ev(ast.b)));
      const a = ev(ast.a), b = ev(ast.b);
      switch (ast.op) {
        case '==': return tBool(equals(a, b));
        case '!=': return tBool(!equals(a, b));
        case '<': case '>': case '<=': case '>=': {
          let r: number;
          if (numLike(a) && numLike(b)) r = toNum(a) - toNum(b);
          else { const x = toStr(a), y = toStr(b); r = x < y ? -1 : x > y ? 1 : 0; }
          return tBool(ast.op === '<' ? r < 0 : ast.op === '>' ? r > 0 : ast.op === '<=' ? r <= 0 : r >= 0);
        }
        case '+':
          if (a.k === 's' || b.k === 's') return tStr(toStr(a) + toStr(b));
          return tNum(toNum(a) + toNum(b), isInt(a) && isInt(b));
        case '-': return tNum(toNum(a) - toNum(b), isInt(a) && isInt(b));
        case '*': return tNum(toNum(a) * toNum(b), isInt(a) && isInt(b));
        case '/': {
          const x = toNum(a), y = toNum(b);
          if (y === 0) throw new ExprError('0 으로 나눌 수 없습니다');
          return isInt(a) && isInt(b) ? tNum(Math.trunc(x / y), true) : tNum(x / y);
        }
        case '%': {
          const x = toNum(a), y = toNum(b);
          if (y === 0) throw new ExprError('0 으로 나눈 나머지는 없습니다');
          return tNum(x % y, isInt(a) && isInt(b));
        }
        case '^': return tNum(Math.pow(toNum(a), toNum(b)));
      }
      throw new ExprError(`연산자 ${ast.op}`);
    }
    case 'call': return callFn(ast.fn, ast.args, sc);
  }
}

function callFn(name: string, args: Ast[], sc: Scope): Typed {
  const fn = name.toLowerCase();
  const ev = (i: number) => {
    if (!args[i]) throw new ExprError(`${name}: ${i + 1}번째 인수가 필요합니다`);
    return evalAst(args[i], sc);
  };
  const n = (i: number) => toNum(ev(i), `${name} 인수`);
  const s = (i: number) => toStr(ev(i));
  const f = (v: number) => tNum(v);
  // 복합 수식 함수 — 이름 인수("'L0'") 들의 상태
  const names = (from: number) => args.slice(from).map((a) => unquote(toStr(evalAst(a, sc))));
  const state = (v: string) => sc.varState?.(v) ?? 'value';
  const varNum = (v: string) => { const t = sc.getVar(v); if (!t) throw new ExprError(`변수 #${v} 이(가) 없습니다`, true); return toNum(t); };

  switch (fn) {
    case 'abs': { const v = ev(0); return tNum(Math.abs(toNum(v)), isInt(v)); }
    case 'toradians': return f(n(0) * DEG);
    case 'todegrees': return f(n(0) / DEG);
    case 'sin': return f(Math.sin(n(0)));
    case 'cos': return f(Math.cos(n(0)));
    case 'tan': return f(Math.tan(n(0)));
    case 'asin': return f(Math.asin(n(0)));
    case 'acos': return f(Math.acos(n(0)));
    case 'atan': return f(Math.atan(n(0)));
    case 'ceil': return f(Math.ceil(n(0)));
    case 'floor': return f(Math.floor(n(0)));
    case 'round': return tNum(Math.round(n(0)), true);
    case 'sqrt': return f(Math.sqrt(n(0)));
    case 'min': case 'max': {
      if (!args.length) throw new ExprError(`${name}: 인수가 필요합니다`);
      const vs = args.map((_, i) => ev(i));
      const ns = vs.map((v) => toNum(v));
      return tNum(fn === 'min' ? Math.min(...ns) : Math.max(...ns), vs.every(isInt));
    }
    case 'left': { const k = n(1); return tStr(k <= 0 ? '' : s(0).slice(0, k)); }
    case 'right': { const k = n(1); return tStr(k <= 0 ? '' : s(0).slice(-k)); }
    case 'mid': { const str = s(0); const st = Math.max(1, n(1)); return tStr(str.substr(st - 1, Math.max(0, n(2)))); }
    case 'strtonum': {
      const str = s(0).trim();
      const v = Number(str);
      if (str === '' || Number.isNaN(v)) throw new ExprError(`strToNum: 숫자가 아닌 문자 '${str}'`);
      return tNum(v, !/[.e]/i.test(str));
    }
    case 'float2int': return tNum(Math.trunc(n(0)), true);
    case 'firstindexof': return tNum(s(0).indexOf(s(1)), true);
    case 'lastindexof': return tNum(s(0).lastIndexOf(s(1)), true);
    case 'strcontains': return tBool(s(0).includes(s(1)));
    case 'deround': {
      const v = n(0), d = Math.trunc(n(1));
      const k = Math.pow(10, d);
      const r = Math.round(v * k) / k;
      return d <= 0 ? tNum(r, true) : f(Number(r.toPrecision(Math.min(15, Math.max(6, String(Math.trunc(r)).length + d)))));
    }
    case 'rad': {
      const A = n(0), H = n(1);
      return f(A <= 0 || H <= 0 || 2 * H > A ? 0 : (A * A) / (8 * H) + H / 2);
    }
    case 'boolat': { const bits = s(0); return tBool(bits.charAt(n(1) - 1) === '1'); }
    case 'boolall': {
      const bits = s(0), want = truthy(ev(1)) ? '1' : '0', k = n(2);
      return tBool(bits.length >= k && bits.slice(0, k).split('').every((ch) => ch === want));
    }
    case 'isnull': {
      if (!args[0]) return tBool(true);
      try {
        const v = evalAst(args[0], sc);
        return tBool(v.k === 'null' || (v.k === 's' && v.v === ''));
      } catch (e) {
        if (e instanceof ExprError && e.missing) return tBool(true);
        throw e;
      }
    }
    case 'isvalue': return tBool(state(unquote(s(0))) === 'value');
    case 'statussum': {
      const fallback = n(0), cnt = Math.trunc(n(1));
      const list = names(2).slice(0, Math.max(0, cnt));
      return f(list.reduce((acc, v) => acc + (state(v) === 'value' ? varNum(v) : fallback), 0));
    }
    case 'average': {
      const total = n(0), cnt = Math.trunc(n(1));
      const list = names(2).slice(0, Math.max(0, cnt));
      const fixed = list.filter((v) => state(v) === 'value');
      const free = list.length - fixed.length;
      return f(free > 0 ? (total - fixed.reduce((acc, v) => acc + varNum(v), 0)) / free : 0);
    }
    case 'getproductcustomattr': {
      const id = s(0), key = s(1);
      return sc.productCustomAttr?.(id, key) ?? (args[2] ? ev(2) : NULL);
    }
    case 'getselfattr': return sc.selfAttr?.(s(0)) ?? NULL;
    case 'getselfcustomattr': return sc.selfCustomAttr?.(s(0)) ?? (args[1] ? ev(1) : NULL);
    case 'getoptionname': {
      const v = unquote(s(0)), val = toStr(ev(1));
      const o = sc.options?.(v)?.find((x) => x.value === val || (numLike(tStr(x.value)) && numLike(tStr(val)) && Number(x.value) === Number(val)));
      return o ? tStr(o.name) : NULL;
    }
  }
  throw new ExprError(`함수 ${name} 은(는) 지원하지 않습니다`);
}

/* ───────────── 공개 API ───────────── */

export function evaluate(expr: string, sc: Scope): Typed {
  const v = evalAst(parse(expr), sc);
  if (v.k === 'n' && !Number.isFinite(v.v)) throw new ExprError('계산 결과가 숫자가 아닙니다');
  return v;
}

/** 수식 → 숫자 (빈 수식이면 fallback, 오류면 onError + fallback) */
export function evalNum(expr: string | null | undefined, sc: Scope, fallback = 0, onError?: (msg: string) => void): number {
  if (expr == null || String(expr).trim() === '') return fallback;
  try {
    const v = evaluate(String(expr), sc);
    return v.k === 'null' ? fallback : toNum(v);
  } catch (e) { onError?.((e as Error).message); return fallback; }
}

/** 수식 → 참·거짓 (빈 수식이면 fallback) */
export function evalBool(expr: string | null | undefined, sc: Scope, fallback = false, onError?: (msg: string) => void): boolean {
  if (expr == null || String(expr).trim() === '') return fallback;
  try { return truthy(evaluate(String(expr), sc)); } catch (e) { onError?.((e as Error).message); return fallback; }
}

/** 수식 → 형식 있는 값 (오류면 null) */
export function evalTyped(expr: string | null | undefined, sc: Scope, onError?: (msg: string) => void): Typed | null {
  if (expr == null || String(expr).trim() === '') return null;
  try { return evaluate(String(expr), sc); } catch (e) { onError?.((e as Error).message); return null; }
}

/** 화면 표시용 — 소수 넷째 자리까지, 실수의 ".0" 없이 */
export function fmt(v: Typed | PmVal | undefined): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.k === 'null') return '';
    if (v.k === 'n') return fmtNum(v.v);
    return String(v.v);
  }
  if (typeof v === 'number') return fmtNum(v);
  return String(v);
}
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** 수식이 읽는 변수·부품 참조명 (참조 보기·순환 검사·이름 바꾸기용) */
export function dependencies(expr: string | null | undefined): { vars: string[]; refs: string[] } {
  const vars = new Set<string>(), refs = new Set<string>();
  if (expr == null || String(expr).trim() === '') return { vars: [], refs: [] };
  let ast: Ast;
  try { ast = parse(String(expr)); } catch { return { vars: [], refs: [] }; }
  const walk = (a: Ast) => {
    switch (a.t) {
      case 'var': if (!/^(true|false|null)$/i.test(a.name) || a.path.length) vars.add(a.name); break;
      case 'ref': refs.add(a.ref); break;
      case 'un': walk(a.a); break;
      case 'bin': walk(a.a); walk(a.b); break;
      case 'cond': walk(a.c); walk(a.a); walk(a.b); break;
      case 'call': {
        a.args.forEach(walk);
        const fn = a.fn.toLowerCase();
        // 이름을 문자열로 받는 함수 — 그 이름의 변수에 기대므로 의존으로 본다
        const from = fn === 'isvalue' || fn === 'getoptionname' ? 0 : fn === 'statussum' || fn === 'average' ? 2 : -1;
        if (from >= 0) a.args.slice(from, fn === 'getoptionname' || fn === 'isvalue' ? from + 1 : undefined)
          .forEach((x) => { if (x.t === 'str') vars.add(unquote(x.v)); });
        break;
      }
    }
  };
  walk(ast);
  return { vars: [...vars], refs: [...refs] };
}

/** 수식 문법 검사 — 오류 메시지 또는 null */
export function syntaxError(expr: string): string | null {
  if (expr.trim() === '') return null;
  try { parse(expr); return null; } catch (e) { return (e as Error).message; }
}

/** 수식 안의 변수 이름 바꾸기 (#OLD → #NEW, 문자열 안은 그대로) */
export function renameVar(expr: string, from: string, to: string): string {
  if (!expr || !expr.includes(from)) return expr;
  const re = new RegExp(`(#)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_\\u3131-\\uD79D\\u4E00-\\u9FFF])`, 'g');
  return expr.split(/('[^']*'|"[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(re, `$1${to}`))).join('');
}

/** 수식 안의 부품 참조명 바꾸기 (@OLD. → @NEW.) */
export function renameRef(expr: string, from: string, to: string): string {
  if (!expr || !expr.includes(from)) return expr;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expr.split(/('[^']*'|"[^"]*")/).map((part, i) => (i % 2 ? part : part.replace(new RegExp(`@(self)?${esc}\\.`, 'g'), (_m, self) => `@${self ?? ''}${to}.`))).join('');
}
