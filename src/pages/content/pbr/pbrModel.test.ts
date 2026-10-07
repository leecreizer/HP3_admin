import { describe, expect, it } from 'vitest';
import type { PbrTemplate } from './pbrData';
import { applyNoEffect, defaultsOf, diffValues, hexToRgb, isNoEffect, panelRules, rgbToHex, textureTabs, valuesFor } from './pbrModel';

/** 쿠지알러 ‘深色大理石’ 템플릿 스키마(속성 묶음 5개)를 줄여 옮긴 것 */
const marble: PbrTemplate = {
  id: 'T1', name: '짙은 대리석', zh: '深色大理石', cat: 1, ball: '', model: 0, scale: [1000, 1000], shader: 'VRayMtl',
  groups: [
    { id: 0, name: '확산 반사', attrs: [
      { k: 'diffuseOption', t: 'Option', l: '효과', v: 1, o: [['맵', 'diffuseTex', 1], ['색', 'diffuse', 0]] },
      { k: 'diffuseTex', t: 'File', l: '확산 반사 맵', v: 'https://x/d.jpg' },
      { k: 'diffuse', t: 'AColor', l: '확산 반사 색', v: [1, 1, 1] },
      { k: 'vrColor', t: 'AColor', l: 'VR 색', v: [1, 1, 1] },
      { k: 'hueShift', t: 'Float', l: '색조', v: 0, r: [-180, 180] },
    ] },
    { id: 1, name: '반사', attrs: [
      { k: 'reflectOption', t: 'Option', l: '효과', v: 1, o: [['맵', 'reflectTex', 1], ['색', 'reflect', 0]] },
      { k: 'reflect', t: 'AColor', l: '반사 색', v: [1, 1, 1] },
      { k: 'reflectTex', t: 'File', l: '반사 맵', v: 'https://x/r.jpg' },
      { k: 'reflectBrightness', t: 'Float', l: '밝기', v: 0, r: [-100, 100] },
    ] },
    { id: 3, name: '반사 광택도', attrs: [
      { k: 'reflectGlossinessTex', t: 'File', l: '광택도 맵', v: 'https://x/g.jpg' },
      { k: 'reflectGlossiness', t: 'Float', l: '반사 광택도', v: 0.96, r: [0, 1] },
      { k: 'reflectGlossinessOption', t: 'Option', l: '효과', v: 1, o: [['맵', 'reflectGlossinessTex', 1], ['수치', 'reflectGlossiness', 0]] },
      { k: 'reflectGlossinessBrightness', t: 'Float', l: '밝기', v: 0, r: [-100, 100] },
    ] },
    { id: 4, name: '요철', attrs: [
      { k: 'newBumpMultiplier', t: 'Float', l: '요철 비율', v: 2, r: [-100, 100] },
      { k: 'newBump', t: 'File', l: '요철 맵', v: 'https://x/b.jpg' },
    ] },
    { id: 6, name: '프레넬', attrs: [
      { k: 'fresnel', t: 'Switch', l: '프레넬', v: true },
      { k: 'fresnelIor', t: 'Float', l: '프레넬 굴절률', v: 1.6, r: [1, 100] },
    ] },
  ],
};

describe('실시간 재질 제작 도구 — 값·화면 규칙 (쿠지알러 jn·PARAM_NO_EFFECT_VALUE)', () => {
  it('맵을 고르면 색·수치 칸을 숨기고, 색을 고르면 확산 반사는 그 색 하나만 남긴다', () => {
    const v = defaultsOf(marble);
    const r1 = panelRules(marble, v);
    expect(r1.hidden.has('diffuse')).toBe(true);
    expect(r1.hidden.has('reflect')).toBe(true);
    expect(r1.hidden.has('reflectGlossiness')).toBe(true);
    expect(r1.hidden.has('hueShift')).toBe(false);
    expect(r1.offTex.size).toBe(0);
    const r2 = panelRules(marble, { ...v, diffuseOption: 0, reflectGlossinessOption: 0 });
    expect(r2.hidden.has('diffuse')).toBe(false);
    expect(['vrColor', 'hueShift', 'diffuseTex'].every((k) => r2.hidden.has(k))).toBe(true);
    expect(r2.hidden.has('reflectGlossinessBrightness')).toBe(true);
    expect(r2.offTex.has('diffuseTex') && r2.offTex.has('reflectGlossinessTex')).toBe(true);
  });

  it('프레넬을 끄면 굴절률 칸을 숨긴다', () => {
    expect(panelRules(marble, { ...defaultsOf(marble), fresnel: false }).hidden.has('fresnelIor')).toBe(true);
  });

  it('효과 없애기 — 반사는 색·검정, 광택도는 수치 0, 요철은 비율 0', () => {
    let v = defaultsOf(marble);
    const [, refl, gloss, bump] = marble.groups;
    expect(isNoEffect(refl, v)).toBe(false);
    v = applyNoEffect(refl, v);
    expect(v.reflectOption).toBe(0);
    expect(v.reflect).toEqual([0, 0, 0]);
    expect(isNoEffect(refl, v)).toBe(true);
    v = applyNoEffect(bump, applyNoEffect(gloss, v));
    expect(v.reflectGlossinessOption).toBe(0);
    expect(v.reflectGlossiness).toBe(0);
    expect(v.newBumpMultiplier).toBe(0);
    expect(isNoEffect(marble.groups[0], v)).toBe(true); // 확산 반사는 효과 없애기 대상이 아님
  });

  it('저장은 템플릿 기본값과 다른 값만, 다시 열면 기본값 위에 얹는다', () => {
    const v = { ...defaultsOf(marble), hueShift: 30, reflect: [0.5, 0.5, 0.5] as [number, number, number] };
    const d = diffValues(marble, v);
    expect(d).toEqual({ hueShift: 30, reflect: [0.5, 0.5, 0.5] });
    const back = valuesFor(marble, { ...d, notInTemplate: 1 });
    expect(back.hueShift).toBe(30);
    expect('notInTemplate' in back).toBe(false);
    expect(back.reflectGlossiness).toBe(0.96);
  });

  it('맵 칸은 묶음 순서대로 맵 속성마다 하나', () => {
    expect(textureTabs(marble).map((t) => [t.key, t.label])).toEqual([
      ['diffuseTex', '확산 반사'], ['reflectTex', '반사'], ['reflectGlossinessTex', '반사 광택도'], ['newBump', '요철'],
    ]);
  });

  it('색 값은 선형, 견본은 sRGB — 철 반사 0.24·0.22·0.20 은 화면에서 133·128·123', () => {
    expect(rgbToHex([0.24, 0.22, 0.2])).toBe('#85807b'); // 쿠지알러 견본 rgb(133, 128, 123)
    const back = hexToRgb('#85807b');
    expect(back[0]).toBeCloseTo(0.24, 2);
  });
});
