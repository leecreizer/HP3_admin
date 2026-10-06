import { DEFS, elementDef, type ElementDef, type ParamDef } from './defs';
import { ExprError, NULL, dependencies, evaluate, fmt, tNum, tStr, toStr, truthy, typedOf, type Scope, type Typed } from './expr';
import { parseLinePath, parsePlankPath } from './path';
import type { PmModel, PmNode, PmPath, PmVar, PlankShape, VarOption } from './types';

/**
 * 파라메트릭 모델 계산 — 변수 · 중간 변수 · 부품 변수 · 보고 변수를 필요할 때 계산(지연 계산 + 순환 검사).
 * 형상(three.js)은 geometry.ts 가 이 결과의 숫자를 받아 만든다.
 */

export type V3 = [number, number, number];

/** 상품(재질·스타일·윤곽·하위 모델) 조회 — 에디터가 컨텐츠 라이브러리 · 모델 저장소로 채운다 */
export interface Catalog {
  /** 재질·스타일 상품 — #CZ.name · #CZ.productcode · getProductCustomAttr */
  product?(id: string): { name: string; code?: string; model?: string; customcode?: string; custom?: Record<string, string>; color?: string; texture?: string } | undefined;
  /** 컨텐츠 라이브러리 3D 모델(메시 래퍼) — GLB 에셋과 원래 크기 */
  mesh?(id: string): { name: string; asset?: string; size?: V3 } | undefined;
  /** 윤곽(단면) — 로프트·스윕 profileData, 윤곽 변수 #ZX.w · #ZX.d */
  profile?(id: string): { name: string; w: number; h: number; points: [number, number][] } | undefined;
  /** 하위 파라메트릭 모델 */
  model?(id: string): PmModel | undefined;
  /** 전역 변수 */
  globals?(): PmVar[];
}

export interface EvalOptions {
  catalog?: Catalog;
  /** 부모가 정한 변수 값(하위 모델 인스턴스) — 이름 → 값(계산 끝난 문자열) */
  overrides?: Record<string, string>;
  /** 복합 수식 상태 덮어쓰기 */
  states?: Record<string, 'value' | 'formula'>;
  /** 설계 툴 환경 — #selfPosition · #selfRotate (에디터에서는 적용하지 않음 — 문서 3.1.29 ‘편집기 로직’) */
  env?: { position: V3; rotate: V3 };
  depth?: number;
}

export interface Diag {
  level: 'error' | 'warn';
  /** 어디서 — ‘변수 W’, ‘평면 판재-1 · 높이’ … */
  where: string;
  message: string;
  varName?: string;
  nodeId?: string;
  param?: string;
}

export interface VarEval {
  v: PmVar;
  value: Typed;
  error?: string;
  /** 숨김 조건 결과 */
  hidden: boolean;
  /** 잠금 조건(diy-immutable) 결과 */
  locked: boolean;
  /** 보이는 선택지 (선택지 숨김 조건 반영) */
  options?: VarOption[];
  /** 구간 최소·최대 계산값 */
  min?: number;
  max?: number;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const isFormulaLike = (s: string) => /^[#@(]/.test(s.trim()) || /[?+*/]|==|!=|&&|\|\|/.test(s);

/** 값이 수식인지 문자 그대로인지 — 재질 id(3FO4KF1T9XQV)·선택지 값('top')은 문자 그대로 */
function literalOrFormula(raw: string, pd: ParamDef | undefined): { literal: true; v: Typed } | { literal: false } {
  const s0 = raw.trim();
  const type = pd?.type ?? 'float';
  if (['material', 'shape', 'string', 'parammodelpackage'].includes(type)) {
    if (pd?.options?.some((o) => o.value === s0)) return { literal: true, v: tStr(s0) };
    if (/^['"].*['"]$/.test(s0) || isFormulaLike(s0)) return { literal: false };
    return { literal: true, v: tStr(s0) };
  }
  return { literal: false };
}

export class PmEval {
  readonly model: PmModel;
  readonly opts: EvalOptions;
  readonly diags: Diag[] = [];
  readonly scope: Scope;
  private readonly varByName = new Map<string, PmVar>();
  private readonly nodeByRef = new Map<string, PmNode>();
  private readonly varMemo = new Map<string, VarEval>();
  private readonly paramMemo = new Map<string, Typed | ExprError>();
  private readonly visiting: string[] = [];
  private readonly childMemo = new Map<string, PmEval | null>();
  private readonly reported = new Set<string>();

  constructor(model: PmModel, opts: EvalOptions = {}) {
    this.model = model;
    this.opts = opts;
    const globals = opts.catalog?.globals?.() ?? [];
    for (const v of model.vars) {
      const g = v.globalId ? globals.find((x) => x.id === v.globalId) : undefined;
      const merged: PmVar = g ? { ...g, id: v.id, scope: v.scope, group: v.group, globalId: v.globalId, hidden: v.hidden ?? g.hidden } : v;
      if (this.varByName.has(v.name)) this.diag('error', `변수 ${v.name}`, `참조명 ${v.name} 이(가) 중복됩니다`, { varName: v.name });
      else this.varByName.set(v.name, merged);
      if (!NAME_RE.test(v.name)) this.diag('error', `변수 ${v.label || v.name}`, '참조명은 영문자로 시작하고 영문·숫자만 쓸 수 있습니다', { varName: v.name });
    }
    for (const n of model.nodes) {
      if (!n.refName) continue;
      if (this.nodeByRef.has(n.refName)) this.diag('error', n.name, `부품 참조명 ${n.refName} 이(가) 중복됩니다`, { nodeId: n.id });
      else this.nodeByRef.set(n.refName, n);
    }
    this.scope = {
      getVar: (name) => this.varTyped(name),
      getVarAttr: (name, path) => this.varAttr(name, path),
      getRef: (ref, path) => this.refValue(ref, path),
      varState: (name) => this.stateOf(name),
      options: (name) => this.varByName.get(name)?.options,
      productCustomAttr: (id, key) => { const c = opts.catalog?.product?.(id)?.custom?.[key]; return c == null ? undefined : typedOf(c, Number.isNaN(Number(c)) ? 'string' : 'float'); },
    };
  }

  private diag(level: Diag['level'], where: string, message: string, extra: Partial<Diag> = {}) {
    const key = `${level}|${where}|${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.diags.push({ level, where, message, ...extra });
  }

  /** 순환 검사를 하며 계산 */
  private guard<T>(key: string, label: string, fn: () => T): T {
    if (this.visiting.includes(key)) {
      const cycle = [...this.visiting.slice(this.visiting.indexOf(key)).map((k) => k.split('|')[1]), label].join(' → ');
      throw new ExprError(`순환 참조: ${cycle}`);
    }
    this.visiting.push(key);
    try { return fn(); } finally { this.visiting.pop(); }
  }

  /* ───────────── 변수 ───────────── */

  getVarDef(name: string) { return this.varByName.get(name); }

  stateOf(name: string): 'value' | 'formula' | undefined {
    const v = this.varByName.get(name);
    if (!v) return undefined;
    if (v.valueType !== 'composite') return 'value';
    if (this.opts.overrides && name in this.opts.overrides) return 'value';
    return this.opts.states?.[name] ?? v.state ?? 'value';
  }

  private calc(expr: string, where: string, extra: Partial<Diag>): Typed {
    try { return evaluate(expr, this.scope); } catch (e) {
      const msg = (e as Error).message;
      this.diag('error', where, msg, extra);
      throw e;
    }
  }

  /** 변수 계산 결과 (값 · 숨김 · 잠금 · 보이는 선택지) */
  varEval(name: string): VarEval | undefined {
    const hit = this.varMemo.get(name);
    if (hit) return hit;
    const v = this.varByName.get(name);
    if (!v) return undefined;
    const where = `변수 ${v.label || v.name}(${v.name})`;
    const extra = { varName: v.name };
    let value: Typed = NULL, error: string | undefined;
    try {
      value = this.guard(`v|${name}`, `#${name}`, () => this.computeVar(v, where, extra));
    } catch (e) { error = (e as Error).message; this.diag('error', where, error, extra); }
    const r: VarEval = { v, value, error, hidden: false, locked: false };
    this.varMemo.set(name, r);
    // 숨김 조건 · 잠금 조건 · 선택지 숨김 · 구간 — 값 다음에 (자기 자신을 참조해도 순환이 아니게)
    const bool = (expr: string | undefined, label: string) => {
      if (!expr || !expr.trim()) return false;
      try { return truthy(evaluate(expr, this.scope)); } catch (e) { this.diag('error', `${where} · ${label}`, (e as Error).message, extra); return false; }
    };
    r.hidden = bool(v.hidden, '숨김 조건');
    r.locked = bool(v.ext?.['diy-immutable'], '잠금 조건');
    if (v.options?.length) r.options = v.options.filter((o) => !bool(o.hidden, `선택지 ${o.name} 숨김 조건`));
    if (v.valueType === 'range' && (v.type === 'float' || v.type === 'int')) {
      const num = (e: string | undefined, label: string) => {
        if (e == null || e.trim() === '') return undefined;
        try { const t = evaluate(e, this.scope); return t.k === 'n' ? t.v : Number(toStr(t)); } catch (err) { this.diag('error', `${where} · ${label}`, (err as Error).message, extra); return undefined; }
      };
      r.min = num(v.min, '최솟값');
      r.max = num(v.max, '최댓값');
      if (value.k === 'n' && ((r.min != null && value.v < r.min - 1e-9) || (r.max != null && value.v > r.max + 1e-9)))
        this.diag('warn', where, `현재값 ${fmt(value)} 이(가) 구간 ${r.min ?? ''}~${r.max ?? ''} 밖입니다`, extra);
    }
    if (v.valueType === 'options' && r.options && value.k !== 'null' && !v.options!.some((o) => o.value === toStr(value) || o.value === fmt(value)))
      this.diag('warn', where, `현재값 ${fmt(value)} 이(가) 선택지에 없습니다`, extra);
    return r;
  }

  private computeVar(v: PmVar, where: string, extra: Partial<Diag>): Typed {
    const ov = this.opts.overrides?.[v.name];
    if (ov != null) return typedOf(ov, v.type === 'int' ? 'int' : v.type === 'float' ? 'float' : v.type === 'boolean' ? 'boolean' : 'string');
    const useFormula = v.scope === 'middle' || v.scope === 'report' || v.valueType === 'formula'
      || (v.valueType === 'composite' && this.stateOf(v.name) === 'formula');
    if (useFormula) {
      const f = (v.formula ?? '').trim() || (v.valueType === 'formula' ? v.value : '');
      if (!f.trim()) return NULL;
      const t = this.calc(f, where, extra);
      return v.type === 'int' && t.k === 'n' ? tNum(Math.trunc(t.v), true) : v.type === 'float' && t.k === 'n' ? tNum(t.v) : t;
    }
    const raw = (v.value ?? '').trim();
    if (v.type === 'float' || v.type === 'int') {
      if (raw === '') return NULL;
      if (!Number.isNaN(Number(raw))) return typedOf(raw, v.type);
      const t = this.calc(raw, where, extra);
      return t.k === 'n' ? tNum(v.type === 'int' ? Math.trunc(t.v) : t.v, v.type === 'int') : t;
    }
    if (v.type === 'boolean') {
      if (/^(true|false|1|0|)$/i.test(raw)) return typedOf(raw, 'boolean');
      return this.calc(raw, where, extra);
    }
    return tStr(v.value ?? '');
  }

  varTyped(name: string): Typed | undefined {
    if (!this.varByName.has(name)) return undefined;
    const r = this.varEval(name)!;
    if (r.error) throw new ExprError(`#${name}: ${r.error}`);
    return r.value;
  }

  /** #이름.속성 — 재질/스타일 상품 속성, 윤곽 크기, 환경, #self부품.paramStyle.* */
  private varAttr(name: string, path: string[]): Typed | undefined {
    if (name === 'selfPosition' || name === 'selfRotate') {
      const env = this.opts.env;
      const i = { x: 0, y: 1, z: 2 }[path[0] as 'x' | 'y' | 'z'];
      if (i == null) return undefined;
      return tNum(env ? (name === 'selfPosition' ? env.position : env.rotate)[i] : 0);
    }
    const v = this.varByName.get(name);
    if (v) {
      const val = this.varTyped(name);
      return val ? this.attrOfValue(val, path, v.type) : undefined;
    }
    // #MB.paramStyle.name · #selfMB.paramStyle.name — 하위 부품 상품 정보
    const node = this.findRef(name);
    if (node) return this.nodeAttr(node, path);
    return undefined;
  }

  /** 상품(재질·윤곽) id → 이름 (없으면 '') */
  nameOf(id: string, kind?: string): string {
    const t = id ? this.attrOfValue(tStr(id), ['name'], kind) : undefined;
    return t && t.k === 's' ? t.v : '';
  }

  /** 상품 id 값의 속성 */
  attrOfValue(val: Typed, path: string[], kind?: string): Typed | undefined {
    const id = toStr(val);
    const key = (path[0] ?? '').toLowerCase();
    if (kind === 'profile' || ((key === 'w' || key === 'd' || key === 'h') && this.opts.catalog?.profile?.(id))) {
      const p = this.opts.catalog?.profile?.(id);
      if (!p) return undefined;
      if (key === 'w') return tNum(p.w);
      if (key === 'd' || key === 'h') return tNum(p.h);
      if (key === 'name') return tStr(p.name);
      return undefined;
    }
    const prod = this.opts.catalog?.product?.(id);
    if (!prod) return key === 'name' || key === 'productcode' || key === 'model' || key === 'customcode' ? tStr('') : undefined;
    switch (key) {
      case 'name': return tStr(prod.name);
      case 'productcode': case 'code': return tStr(prod.code ?? '');
      case 'model': return tStr(prod.model ?? '');
      case 'customcode': return tStr(prod.customcode ?? '');
      default: { const c = prod.custom?.[path[0]]; return c == null ? undefined : tStr(c); }
    }
  }

  /* ───────────── 부품 ───────────── */

  findRef(ref: string): PmNode | undefined {
    return this.nodeByRef.get(ref) ?? (ref.startsWith('self') ? this.nodeByRef.get(ref.slice(4)) : undefined);
  }

  /** @참조명.변수[.속성] */
  private refValue(ref: string, path: string[]): Typed | undefined {
    const node = this.findRef(ref);
    if (!node) return undefined;
    return this.nodeAttr(node, path);
  }

  private nodeAttr(node: PmNode, path: string[]): Typed | undefined {
    const [param, ...rest] = path;
    if (param === 'paramStyle') {
      // 하위 모델 상품 정보 — 이름·형번·코드
      const key = (rest[0] ?? 'name').toLowerCase();
      const child = node.sub?.kind === 'param' ? this.opts.catalog?.model?.(node.sub.id) : undefined;
      const prod = node.sub ? this.opts.catalog?.product?.(node.sub.id) : undefined;
      if (key === 'name') return tStr(prod?.name ?? child?.name ?? node.sub?.name ?? node.name);
      if (key === 'productcode') return tStr(prod?.code ?? '');
      if (key === 'model') return tStr(prod?.model ?? '');
      if (key === 'customcode') return tStr(prod?.customcode ?? '');
      return undefined;
    }
    const v = this.nodeValue(node, param);
    if (!v) return undefined;
    if (!rest.length) return v;
    if (v.k === 's' && v.v.trim().startsWith('{')) {
      // float3/float2 성분 — @MB.position.x
      try {
        const o = JSON.parse(v.v) as Record<string, string>;
        if (rest[0] in o) return this.calcIn(node, `${param}.${rest[0]}`, o[rest[0]]);
      } catch { /* 문자열 값 */ }
    }
    const def = elementDef(node.def);
    const pd = def?.params.find((p) => p.name === param);
    return this.attrOfValue(v, rest, pd?.type === 'shape' ? 'profile' : undefined);
  }

  private calcIn(node: PmNode, label: string, expr: string): Typed {
    return this.guard(`p|${node.id}.${label}`, `@${node.refName ?? node.name}.${label}`, () => this.calc(expr, `${node.name} · ${label}`, { nodeId: node.id, param: label }));
  }

  /** 부품 변수 값(스칼라). float3·경로 같은 구조 값은 원문 문자열 */
  nodeValue(node: PmNode, param: string): Typed | undefined {
    const key = `${node.id}.${param}`;
    const hit = this.paramMemo.get(key);
    if (hit) { if (hit instanceof ExprError) throw hit; return hit; }
    const def = elementDef(node.def);
    const pd = def?.params.find((p) => p.name === param);
    let raw = node.params[param];
    let out: Typed | undefined;
    try {
      if (raw == null && node.sub?.kind === 'param') {
        // 하위 모델 변수 — 부모가 정하지 않았으면 하위 모델의 현재값
        const child = this.child(node);
        out = child?.varTyped(param);
        if (!out && (param === 'W' || param === 'D' || param === 'H')) out = child?.varTyped(param);
      } else if (raw == null && (param === 'W' || param === 'D' || param === 'H') && def) {
        out = this.elementSize(node, def, param);
      } else {
        if (raw == null) raw = pd?.value ?? '';
        const structured = pd && !['float', 'int', 'boolean', 'string', 'material', 'shape', 'positive', 'numberparamname'].includes(pd.type);
        if (structured || raw.trim().startsWith('{') || raw.trim().startsWith('[')) out = tStr(raw);
        else if (raw.trim() === '') out = pd?.type === 'boolean' ? tStr('') : NULL;
        else {
          const lit = literalOrFormula(raw, pd);
          out = lit.literal ? lit.v : this.calcIn(node, pd?.label ?? param, raw);
          if (pd?.type === 'int' && out.k === 'n') out = tNum(Math.trunc(out.v), true);
        }
      }
    } catch (e) {
      const err = e instanceof ExprError ? e : new ExprError((e as Error).message);
      this.paramMemo.set(key, err);
      throw err;
    }
    if (out) this.paramMemo.set(key, out);
    return out;
  }

  /** 수식 하나 계산 (부품 값 → 숫자). 오류는 진단에 남기고 fallback */
  num(node: PmNode, label: string, expr: string | undefined, fallback = 0): number {
    if (expr == null || String(expr).trim() === '') return fallback;
    try {
      const t = this.calcIn(node, label, String(expr));
      if (t.k === 'n') return t.v;
      if (t.k === 'b') return t.v ? 1 : 0;
      const n = Number(toStr(t));
      return Number.isNaN(n) ? fallback : n;
    } catch { return fallback; }
  }
  bool(node: PmNode, param: string, fallback = false): boolean {
    try {
      const t = this.nodeValue(node, param);
      if (!t || t.k === 'null' || (t.k === 's' && t.v.trim() === '')) return fallback;
      return truthy(t);
    } catch { return fallback; }
  }
  str(node: PmNode, param: string): string {
    try { const t = this.nodeValue(node, param); return t ? (t.k === 'n' ? fmt(t) : toStr(t)) : ''; } catch { return ''; }
  }
  numParam(node: PmNode, param: string, fallback = 0): number {
    try {
      const t = this.nodeValue(node, param);
      if (!t || t.k === 'null') return fallback;
      if (t.k === 'n') return t.v;
      const n = Number(toStr(t));
      return Number.isNaN(n) ? fallback : n;
    } catch { return fallback; }
  }
  /** float3 / float2 변수 */
  vec(node: PmNode, param: string, fallback: V3 = [0, 0, 0]): V3 {
    const raw = node.params[param] ?? elementDef(node.def)?.params.find((p) => p.name === param)?.value ?? '';
    let o: Record<string, string> = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch { this.diag('error', `${node.name} · ${param}`, '좌표 형식 오류', { nodeId: node.id, param }); }
    const pd = elementDef(node.def)?.params.find((p) => p.name === param);
    const label = pd?.label ?? param;
    return [this.num(node, `${label} X`, o.x, fallback[0]), this.num(node, `${label} Y`, o.y, fallback[1]), this.num(node, `${label} Z`, o.z, fallback[2])];
  }

  /** 판재 윤곽 — 점마다 수식 계산 */
  plankShape(node: PmNode, param = 'plankPath'): { shape: PlankShape; num: (p: PmPath, label: string) => NumPathOut } {
    const raw = node.params[param] ?? elementDef(node.def)?.params.find((p) => p.name === param)?.value ?? '';
    const shape = parsePlankPath(raw);
    return { shape, num: (p, label) => this.numPath(node, p, label) };
  }
  linePath(node: PmNode, param: string, closedDefault = false): NumPathOut {
    const raw = node.params[param] ?? elementDef(node.def)?.params.find((p) => p.name === param)?.value ?? '';
    return this.numPath(node, parseLinePath(raw, closedDefault), elementDef(node.def)?.params.find((p) => p.name === param)?.label ?? param);
  }
  numPath(node: PmNode, p: PmPath, label: string): NumPathOut {
    return {
      closed: p.closed,
      points: p.points.map((pt, i) => ({
        x: this.num(node, `${label} 점${i + 1} X`, pt.x), y: this.num(node, `${label} 점${i + 1} Y`, pt.y), type: pt.type,
        radius: pt.type === 1 ? this.num(node, `${label} 점${i + 1} 반지름`, pt.radius) : 0,
        a: pt.type === 2 ? this.num(node, `${label} 점${i + 1} 모따기 a`, pt.chamferA) : 0,
        b: pt.type === 2 ? this.num(node, `${label} 점${i + 1} 모따기 b`, pt.chamferB) : 0,
      })),
      lines: p.lines.map((l, i) => ({
        type: l.type, radius: l.type === 1 ? this.num(node, `${label} 선${i + 1} 반지름`, l.radius) : 0,
        clockwise: !!l.clockwise, minor: l.minor !== false,
      })),
      offset: p.offset ? this.num(node, `${label} 오프셋`, p.offset) : 0,
    };
  }

  /** 요소의 W·D·H (@판재.W 등) — 윤곽 경계 + 두께 */
  private elementSize(node: PmNode, def: ElementDef, param: 'W' | 'D' | 'H'): Typed | undefined {
    if (def.fn === 'PrimitiveModel.plank' || def.fn === 'PrimitiveModel.sideStylePlank') {
      const { shape, num } = this.plankShape(node);
      const pts = num(shape.outline, '윤곽점').points;
      if (!pts.length) return tNum(0);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      if (param === 'W') return tNum(Math.max(...xs) - Math.min(...xs));
      if (param === 'D') return tNum(Math.max(...ys) - Math.min(...ys));
      return tNum(this.numParam(node, 'thickness'));
    }
    if (def.fn === 'PrimitiveModel.grid') return tNum(this.numParam(node, param === 'W' ? 'length' : param === 'D' ? 'width' : 'thickness'));
    const size = def.params.some((p) => p.name === 'size') ? this.vec(node, 'size') : null;
    if (size) return tNum(size[param === 'W' ? 0 : param === 'D' ? 1 : 2]);
    return undefined;
  }

  /* ───────────── 하위 모델 ───────────── */

  /** 하위 파라메트릭 모델 계산 (부모가 정한 W·D·H·변수 값으로) */
  child(node: PmNode): PmEval | null {
    if (node.sub?.kind !== 'param') return null;
    const hit = this.childMemo.get(node.id);
    if (hit !== undefined) return hit;
    const depth = (this.opts.depth ?? 0) + 1;
    // 스타일 변수(#CM 등)로 부품 모델 교체 — 문서 3.1.28 ‘样式变量’
    let modelId = node.sub.id;
    const ps = node.params.paramStyle;
    if (ps && ps.trim()) {
      try { const id = toStr(this.calcIn(node, '스타일 변수', ps)); if (id && this.opts.catalog?.model?.(id)) modelId = id; } catch { /* 진단에 남음 */ }
    }
    const m = this.opts.catalog?.model?.(modelId);
    if (!m) { this.diag('error', node.name, `하위 모델 ${node.sub.name} 을(를) 찾을 수 없습니다`, { nodeId: node.id }); this.childMemo.set(node.id, null); return null; }
    if (depth > 8) { this.diag('error', node.name, '하위 모델이 너무 깊게 중첩되었습니다(8단계)', { nodeId: node.id }); this.childMemo.set(node.id, null); return null; }
    this.childMemo.set(node.id, null); // 자기 순환 방지
    const overrides: Record<string, string> = {};
    const childVars = new Set(m.vars.map((v) => v.name));
    for (const [k, expr] of Object.entries(node.params)) {
      if (!childVars.has(k) || expr == null || String(expr).trim() === '') continue;
      try {
        const cv = m.vars.find((v) => v.name === k)!;
        const lit = cv.type === 'material' || cv.type === 'style' || cv.type === 'profile' || cv.type === 'string';
        const t = lit && !isFormulaLike(expr) ? tStr(expr) : this.calcIn(node, k, expr);
        overrides[k] = t.k === 'n' ? String(t.v) : toStr(t);
      } catch { /* 진단은 calcIn 이 남김 */ }
    }
    const ce = new PmEval(m, { catalog: this.opts.catalog, overrides, depth });
    this.childMemo.set(node.id, ce);
    for (const d of ce.diagsAll()) this.diags.push({ ...d, where: `${node.name} › ${d.where}`, nodeId: node.id });
    return ce;
  }

  /** 모든 변수·부품 변수를 한 번씩 계산해 진단을 모은다 */
  diagsAll(): Diag[] {
    for (const v of this.model.vars) this.varEval(v.name);
    for (const n of this.model.nodes) {
      const def = elementDef(n.def);
      for (const pd of def?.params ?? []) {
        if (['float', 'int', 'boolean', 'string', 'material'].includes(pd.type)) { try { this.nodeValue(n, pd.name); } catch { /* 진단에 남음 */ } }
        else if (pd.type === 'float3' || pd.type === 'float2') this.vec(n, pd.name);
      }
      if (n.sub?.kind === 'param') this.child(n);
      for (const [k, v] of Object.entries(n.params)) if (!def?.params.some((p) => p.name === k) && v && !String(v).trim().startsWith('{')) { try { this.nodeValue(n, k); } catch { /* 진단 */ } }
    }
    for (const [k, v] of Object.entries(this.model.frame)) if (k === 'size' || k === 'center') this.frameVec(k, v);
    return this.diags;
  }

  /** 모델 외곽 틀 크기·위치 */
  frameVec(_param: string, raw: string): V3 {
    let o: Record<string, string> = {};
    try { o = JSON.parse(raw); } catch { /* 기본 */ }
    const n = (e: string | undefined, label: string) => {
      if (!e) return 0;
      try { const t = this.calc(e, `모델 외곽 틀 · ${label}`, {}); return t.k === 'n' ? t.v : Number(toStr(t)) || 0; } catch { return 0; }
    };
    return [n(o.x, `${_param} X`), n(o.y, `${_param} Y`), n(o.z, `${_param} Z`)];
  }

  /** 아무 수식이나 이 모델 안에서 계산 (수식 창 미리보기) */
  try(expr: string): { value?: Typed; error?: string } {
    if (!expr.trim()) return {};
    try { return { value: evaluate(expr, this.scope) }; } catch (e) { return { error: (e as Error).message }; }
  }
}

export interface NumPathOut {
  closed: boolean;
  points: { x: number; y: number; type: 0 | 1 | 2; radius: number; a: number; b: number }[];
  lines: { type: 0 | 1; radius: number; clockwise: boolean; minor: boolean }[];
  offset: number;
}

/* ───────────── 참조 보기 (의존 그래프) ───────────── */

export interface RefEdge { from: string; to: string; via: string }

/** 변수·부품이 누구를 참조하는지 — ‘참조 보기’ 페이지와 이름 바꾸기 확인용 */
export function referenceGraph(m: PmModel): RefEdge[] {
  const edges: RefEdge[] = [];
  const add = (from: string, expr: string | undefined, via: string) => {
    if (!expr) return;
    const d = dependencies(expr);
    for (const v of d.vars) edges.push({ from, to: `#${v}`, via });
    for (const r of d.refs) edges.push({ from, to: `@${r}`, via });
  };
  for (const v of m.vars) {
    const from = `#${v.name}`;
    if (v.valueType === 'formula' || v.valueType === 'composite' || v.scope === 'middle' || v.scope === 'report') add(from, v.formula || v.value, '수식');
    else if (v.type === 'float' || v.type === 'int') add(from, v.value, '현재값');
    add(from, v.min, '최솟값'); add(from, v.max, '최댓값'); add(from, v.hidden, '숨김 조건');
    for (const o of v.options ?? []) add(from, o.hidden, `선택지 ${o.name}`);
  }
  for (const n of m.nodes) {
    const from = n.refName ? `@${n.refName}` : n.name;
    const def = elementDef(n.def);
    for (const [k, raw] of Object.entries(n.params)) {
      const pd = def?.params.find((p) => p.name === k);
      const label = pd?.label ?? k;
      if (!raw) continue;
      if (raw.trim().startsWith('{')) {
        // float3 · 경로 — 안쪽 문자열 수식 모두
        for (const m2 of raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const s = m2[1].replace(/\\"/g, '"'); if (/[#@]/.test(s)) add(from, s.replace(/^\{.*\}$/, ''), label); }
      } else add(from, raw, label);
    }
  }
  return edges;
}

/** 새 변수 · 부품 id */
let seq = 0;
export const uid = (p = 'n') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 기본 변수(W D H CZ) — 문서 1.1.6 ‘모든 분류에 시스템이 넣는 4개 변수’ */
export function basicVars(w = 600, d = 500, h = 720): PmVar[] {
  return [
    { id: uid('v'), scope: 'basic', name: 'W', label: '폭', type: 'float', valueType: 'range', value: String(w), min: '0', max: '10000', visible: true },
    { id: uid('v'), scope: 'basic', name: 'D', label: '깊이', type: 'float', valueType: 'range', value: String(d), min: '0', max: '10000', visible: true },
    { id: uid('v'), scope: 'basic', name: 'H', label: '높이', type: 'float', valueType: 'range', value: String(h), min: '0', max: '10000', visible: true },
    { id: uid('v'), scope: 'basic', name: 'CZ', label: '재질', type: 'material', valueType: 'free', value: '', visible: true },
  ];
}

/** 모델 외곽 틀 기본값 (실제 모델 frameModels 와 같은 값) */
export const defaultFrame = (): Record<string, string> =>
  Object.fromEntries(DEFS.frame.params.map((p) => [p.name, p.name === 'invokedPosType' ? '2' : p.value ?? p.def ?? '']));

/** 모델 속성 기본값 (ParamModel.paramModel) */
export const defaultModelProps = (): Record<string, string> =>
  Object.fromEntries(DEFS.model.params.map((p) => [p.name, p.value ?? p.def ?? '']));
