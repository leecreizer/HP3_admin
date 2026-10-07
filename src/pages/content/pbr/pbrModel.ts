import type { PbrConfig } from '../../../data/contentLibrary';
import { G, type PbrAttr, type PbrGroup, type PbrTemplate, type PbrValue, type Rgb } from './pbrData';

/**
 * 실시간 재질 제작 도구 — 값·화면 규칙 (쿠지알러 번들의 jn·PARAM_NO_EFFECT_VALUE·resetToTemplateDefaultParams 를 옮김)
 */

export type PbrValues = Record<string, PbrValue>;
/** 편집 결과 — 상품(타일·비정형)에 저장 (contentLibrary PbrConfig) */
export type { PbrConfig };
/** 감쇠 묶음의 보이는 쪽 */
export type FalloffSide = 'front' | 'side';

/** 선택지 값 — 맵 = 1, 색·수치 = 0 (쿠지알러 paramEffectEnum) */
export const TEXTURE = 1;

export function defaultsOf(t: PbrTemplate): PbrValues {
  const out: PbrValues = {};
  for (const g of t.groups) for (const a of g.attrs) out[a.k] = a.v;
  return out;
}

export function findAttr(t: PbrTemplate, k: string): PbrAttr | undefined {
  for (const g of t.groups) { const a = g.attrs.find((x) => x.k === k); if (a) return a; }
  return undefined;
}

export function sameValue(a: PbrValue | undefined, b: PbrValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

/** 템플릿 기본값과 다른 값만 */
export function diffValues(t: PbrTemplate, vals: PbrValues): PbrValues {
  const d = defaultsOf(t);
  const out: PbrValues = {};
  for (const k of Object.keys(vals)) if (k in d && !sameValue(vals[k], d[k])) out[k] = vals[k];
  return out;
}

/** 템플릿 기본값 + 저장된 값 (템플릿에 없는 키는 버림) */
export function valuesFor(t: PbrTemplate, saved?: PbrValues): PbrValues {
  const d = defaultsOf(t);
  if (saved) for (const k of Object.keys(saved)) if (k in d) d[k] = saved[k];
  return d;
}

/** ‘효과 없애기’ 값 (쿠지알러 PARAM_NO_EFFECT_VALUE) — 이 값이면 그 묶음은 아무 효과가 없다 */
export const NO_EFFECT: Record<number, PbrValues> = {
  [G.REFLECT]: { reflectOption: 0, reflect: [0, 0, 0] },
  [G.GLOSS]: { reflectGlossinessOption: 0, reflectGlossiness: 0 },
  [G.NORMAL]: { newBumpMultiplier: 0 },
  [G.REFRACT]: { refractOption: 0, refract: [0, 0, 0], ior: 1.6 },
  [G.OPACITY]: { opacityOption: 0, opacity: 1 },
  [G.REFRACT_GLOSS]: { refractGlossinessOption: 0, refractGlossiness: 0 },
};

/** 그 묶음이 이미 효과 없음인지 — 묶음에 있는 속성만 본다 */
export function isNoEffect(g: PbrGroup, vals: PbrValues): boolean {
  const ne = NO_EFFECT[g.id];
  if (!ne) return true;
  return Object.keys(ne).every((k) => !g.attrs.some((a) => a.k === k) || sameValue(vals[k], ne[k]));
}

export function applyNoEffect(g: PbrGroup, vals: PbrValues): PbrValues {
  const ne = NO_EFFECT[g.id];
  if (!ne) return vals;
  const out = { ...vals };
  for (const k of Object.keys(ne)) if (g.attrs.some((a) => a.k === k)) out[k] = ne[k];
  return out;
}

/** 선택지가 ‘색·수치’일 때 묶음에서 그 값 하나만 남기는 선택지 (쿠지알러 jn) */
const ONLY_KEEP: Record<string, string> = { diffuseOption: 'diffuse', reflectOption: 'reflect', reflectGlossinessOption: 'reflectGlossiness', opacityOption: 'opacity' };

/**
 * 화면 규칙 — hidden: 매개변수 칸에서 숨길 속성, offTex: 효과가 꺼져 ⊘ 로 표시할 맵.
 *  선택지 = 맵 → 다른 선택(색·수치) 속성을 숨김
 *  선택지 = 색·수치 → 그 맵을 ⊘, 확산·반사·반사 광택도·불투명도는 그 값 하나만 남김
 *  프레넬 끔 → 프레넬 굴절률 숨김 · 감쇠 묶음은 정면/측면 중 고른 쪽만
 */
export function panelRules(t: PbrTemplate, vals: PbrValues, falloff: Record<number, FalloffSide> = {}): { hidden: Set<string>; offTex: Set<string> } {
  const hidden = new Set<string>();
  const offTex = new Set<string>();
  for (const g of t.groups) {
    for (const a of g.attrs) {
      if (a.t !== 'Option' || a.k === 'normalBumpOption' || !a.o) continue;
      if (vals[a.k] === TEXTURE) {
        for (const o of a.o) if (o[2] !== TEXTURE) hidden.add(o[1]);
      } else {
        const tex = a.o.find((o) => o[2] === TEXTURE)?.[1];
        if (tex) offTex.add(tex);
        const keep = ONLY_KEEP[a.k];
        if (keep) for (const b of g.attrs) if (b.k !== keep && b.k !== a.k) hidden.add(b.k);
      }
    }
    if (g.attrs.some((a) => a.k.includes('TexFalloffColor'))) {
      const side = falloff[g.id] ?? 'front';
      const mine = side === 'front' ? 'TexFalloffColor1' : 'TexFalloffColor2';
      const other = side === 'front' ? 'TexFalloffColor2' : 'TexFalloffColor1';
      for (const b of g.attrs) if (b.k.includes(other)) hidden.add(b.k);
      const opt = g.attrs.find((b) => b.k.includes(mine) && /option$/i.test(b.k) && b.o);
      const colorPath = opt?.o?.find((o) => o[2] !== TEXTURE)?.[1];
      if (opt && colorPath && vals[opt.k] !== TEXTURE) for (const b of g.attrs) if (b.k.includes(mine) && b.k !== colorPath && b.k !== opt.k && b.t !== 'File') hidden.add(b.k);
    }
  }
  if (vals.fresnel === false) hidden.add('fresnelIor');
  return { hidden, offTex };
}

/** 맵 칸 — 묶음 순서대로 맵 속성 하나씩 (감쇠는 정면·측면 각각) */
export type TexTab = { key: string; group: PbrGroup; attr: PbrAttr; label: string };
export function textureTabs(t: PbrTemplate): TexTab[] {
  const out: TexTab[] = [];
  for (const g of t.groups) for (const a of g.attrs) if (a.t === 'File') out.push({ key: a.k, group: g, attr: a, label: a.k.includes('TexFalloffColor') ? `${g.name} ${a.l}` : g.name });
  return out;
}

/** 요철/노멀 묶음에서 노멀을 고른 상태인지 */
export const isNormalMode = (vals: PbrValues) => vals.normalBumpOption === 1;

/* ───────── 색 (V-Ray 색 값은 선형 0–1, 화면 견본은 감마 2.2 — 쿠지알러 견본과 같은 계산: 철 반사 0.24 → 133) ───────── */

const toSrgb = (c: number) => Math.pow(Math.max(0, c), 1 / 2.2);
const toLin = (c: number) => Math.pow(Math.max(0, c), 2.2);
export function rgbToHex(v: Rgb): string {
  return `#${v.map((c) => Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return n.map((c) => Math.round(toLin(c) * 1e6) / 1e6) as Rgb;
}
