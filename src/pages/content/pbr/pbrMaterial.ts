import * as THREE from 'three';
import { getAsset } from '../../../data/assetStore';
import { texUrl, type PbrTemplate, type Rgb } from './pbrData';
import { TEXTURE, isNormalMode, type PbrValues } from './pbrModel';

/**
 * V-Ray 재질 값(쿠지알러 실시간 재질) → three.js MeshPhysicalMaterial.
 * 쿠지알러 실시간 미리보기 엔진은 공개되지 않아 같은 뜻으로 옮겼다(근사):
 *  확산 반사 맵 — 색조·채도·고급 감마 대비·고급 밝기·VR 색을 셰이더에서 적용
 *  반사 — 반사 색(또는 맵×밝기) R. 프레넬 켬: 정면 R·((n−1)/(n+1))², 옆면 R / 끔: 모든 각도 R (금속·거울). 확산은 (1−반사) 만큼 줄임
 *  반사 광택도 — 거칠기 = 1 − 광택도(맵이면 맵×밝기)
 *  요철 — 범프 맵(요철 비율), 노멀 — 노멀 맵 · 굴절 — 투과(굴절률) · 불투명도 — 알파 · 변위 — 꼭짓점 밀기 · 자체 발광 — 발광
 */

export type MapKey = 'diffuse' | 'reflect' | 'gloss' | 'bump' | 'normal' | 'refract' | 'opacity' | 'displace' | 'emit' | 'front' | 'side';
export type MapSet = Partial<Record<MapKey, THREE.Texture | null>>;

/** 맵 속성 → 미리보기 맵 종류와 색 공간 */
export const MAP_OF: Record<string, { key: MapKey; srgb: boolean }> = {
  diffuseTex: { key: 'diffuse', srgb: true },
  reflectTex: { key: 'reflect', srgb: true },
  reflectGlossinessTex: { key: 'gloss', srgb: false },
  newBump: { key: 'bump', srgb: false },
  refractTex: { key: 'refract', srgb: true },
  opacityTex: { key: 'opacity', srgb: false },
  displace: { key: 'displace', srgb: false },
  colorTex: { key: 'emit', srgb: true },
  diffuseTexFalloffColor1Tex: { key: 'front', srgb: true },
  diffuseTexFalloffColor2Tex: { key: 'side', srgb: true },
};

/* ───────── 맵 불러오기 (주소·IndexedDB 에셋, 같은 주소는 한 번만) ───────── */

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const cache = new Map<string, Promise<THREE.Texture>>();

/** src: 주소 또는 'asset:<id>' · res: 쿠지알러 맵 해상도(1024·2048) */
export function loadTexture(src: string, srgb: boolean, res: number): Promise<THREE.Texture> {
  const key = `${src}|${srgb ? 's' : 'l'}|${res}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = src.startsWith('asset:') ? await getAsset(src.slice(6)) : texUrl(src, res);
      if (!url) throw new Error('맵을 찾지 못했습니다');
      const tex = await loader.loadAsync(url);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = 8;
      return tex;
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/* ───────── 셰이더 보정 ───────── */

type HpUniforms = Record<'hpHue' | 'hpSat' | 'hpGamma' | 'hpBright' | 'hpReflGain' | 'hpFresnel' | 'hpFresnelIor' | 'hpGlossGain' | 'hpOpGain', { value: number }> & { hpVr: { value: THREE.Color } };

const HEADER = /* glsl */ `
uniform float hpHue;
uniform float hpSat;
uniform float hpGamma;
uniform float hpBright;
uniform vec3 hpVr;
uniform float hpReflGain;
uniform float hpFresnel;
uniform float hpFresnelIor;
uniform float hpGlossGain;
uniform float hpOpGain;
// HSV 변환 — 분기형 (부호·스텝 섞는 짧은 공식은 일부 그래픽 드라이버(ANGLE)에서 색이 틀어져 쓰지 않음)
vec3 hpRgb2Hsv( vec3 c ) {
  float mx = max( c.r, max( c.g, c.b ) );
  float mn = min( c.r, min( c.g, c.b ) );
  float d = mx - mn;
  float h = 0.0;
  if ( d > 1.0e-6 ) {
    if ( mx == c.r ) h = mod( ( c.g - c.b ) / d, 6.0 );
    else if ( mx == c.g ) h = ( c.b - c.r ) / d + 2.0;
    else h = ( c.r - c.g ) / d + 4.0;
  }
  return vec3( h / 6.0, mx > 0.0 ? d / mx : 0.0, mx );
}
vec3 hpHsv2Rgb( vec3 c ) {
  vec3 k = clamp( abs( mod( c.x * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
  return c.z * mix( vec3( 1.0 ), k, c.y );
}
// 확산 반사 맵 조정 — 표시 공간(감마 2.2)에서 색조·채도·감마 대비, 선형에서 밝기·VR 색
vec3 hpAdjust( vec3 lin ) {
  vec3 s = pow( max( lin, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
  vec3 h = hpRgb2Hsv( s );
  h.x = fract( h.x + hpHue / 360.0 );
  h.y = clamp( h.y * ( 1.0 + hpSat / 100.0 ), 0.0, 1.0 );
  s = pow( max( hpHsv2Rgb( h ), vec3( 0.0 ) ), vec3( max( hpGamma, 0.001 ) ) );
  return pow( s, vec3( 2.2 ) ) * hpBright * hpVr;
}
`;
const MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor *= vec4( hpAdjust( sampledDiffuseColor.rgb ), sampledDiffuseColor.a );
#endif
`;
const ROUGH = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
  roughnessFactor = 1.0 - clamp( texelRoughness.g * hpGlossGain, 0.0, 1.0 );
#endif
`;
const ALPHA = /* glsl */ `
#ifdef USE_ALPHAMAP
  diffuseColor.a *= clamp( texture2D( alphaMap, vAlphaMapUv ).g * hpOpGain, 0.0, 1.0 );
#endif
`;
const SPEC = /* glsl */ `
{
  vec3 hpR = clamp( specularColorFactor * hpReflGain, 0.0, 1.0 );
  float hpMaxR = max( max( hpR.r, hpR.g ), hpR.b );
  float hpF0 = hpFresnel > 0.5 ? pow2( ( hpFresnelIor - 1.0 ) / ( hpFresnelIor + 1.0 ) ) : 1.0;
  material.specularColor = hpR * hpF0;
  material.specularColorBlended = material.specularColor;
  material.specularF90 = hpFresnel > 0.5 ? hpMaxR : hpMaxR * hpF0;
  material.diffuseContribution *= 1.0 - max( max( material.specularColor.r, material.specularColor.g ), material.specularColor.b );
}
`;

export function createPbrMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, specularIntensity: 1 });
  const u: HpUniforms = {
    hpHue: { value: 0 }, hpSat: { value: 0 }, hpGamma: { value: 1 }, hpBright: { value: 1 }, hpVr: { value: new THREE.Color(1, 1, 1) },
    hpReflGain: { value: 1 }, hpFresnel: { value: 1 }, hpFresnelIor: { value: 1.6 }, hpGlossGain: { value: 1 }, hpOpGain: { value: 1 },
  };
  m.userData.hp = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HEADER}`)
      .replace('#include <map_fragment>', MAP)
      .replace('#include <roughnessmap_fragment>', ROUGH)
      .replace('#include <alphamap_fragment>', ALPHA)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SPEC}`);
  };
  m.customProgramCacheKey = () => 'hp3-pbr-2';
  return m;
}

/** 요철 비율·변위 비율 → three.js 크기 (1 단위 = 1 m) */
export const BUMP_K = 0.6;
export const DISP_K = 0.0015;

const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** 값·맵을 재질에 반영. repeat = 맵 반복(모델 1 m 당 상품 크기 몇 장) */
export function updatePbrMaterial(m: THREE.MeshPhysicalMaterial, t: PbrTemplate, vals: PbrValues, maps: MapSet, repeat: [number, number], doubleSide = false) {
  const u = m.userData.hp as HpUniforms;
  const num = (k: string, d: number) => (typeof vals[k] === 'number' ? (vals[k] as number) : d);
  const col = (k: string, d: Rgb): Rgb => (Array.isArray(vals[k]) ? (vals[k] as Rgb) : d);
  const has = (k: string) => k in vals;
  const sig = () => [m.map, m.specularColorMap, m.roughnessMap, m.bumpMap, m.normalMap, m.transmissionMap, m.alphaMap, m.displacementMap, m.emissiveMap].map((x) => x?.uuid ?? '').join() + `|${m.transparent}|${m.sheen > 0}|${m.transmission > 0}|${m.side}`;
  const before = sig();

  const light = t.shader === 'VRayLightMtl';
  // 확산 반사
  u.hpHue.value = 0; u.hpSat.value = 0; u.hpGamma.value = 1; u.hpBright.value = 1; u.hpVr.value.setRGB(1, 1, 1);
  m.sheen = 0;
  if (light) {
    m.map = null; m.color.setRGB(0, 0, 0);
  } else if (has('diffuseTexFalloffColor1option')) {
    // 감쇠(彩色真皮): 정면 = 확산 반사, 측면 = 결(sheen) 색
    const frontTex = vals.diffuseTexFalloffColor1option === TEXTURE;
    m.map = frontTex ? maps.front ?? null : null;
    const fc = frontTex ? [1, 1, 1] as Rgb : col('diffuseTexFalloffColor1', [0.5, 0.5, 0.5]);
    m.color.setRGB(fc[0], fc[1], fc[2]);
    u.hpHue.value = num('diffuseTexFalloffColor1TexhueShift', 0); u.hpSat.value = num('diffuseTexFalloffColor1Texsaturation', 0);
    u.hpGamma.value = num('diffuseTexFalloffColor1TexadvContrast', 1); u.hpBright.value = num('diffuseTexFalloffColor1TexadvBrightness', 1);
    const sc = col('diffuseTexFalloffColor2', [0.8, 0.8, 0.8]);
    m.sheen = 1; m.sheenRoughness = 0.6; m.sheenColor.setRGB(sc[0], sc[1], sc[2]);
  } else if (!has('diffuseOption') || vals.diffuseOption === TEXTURE) {
    m.map = maps.diffuse ?? null;
    m.color.setRGB(1, 1, 1);
    u.hpHue.value = num('hueShift', 0); u.hpSat.value = num('saturation', 0); u.hpGamma.value = num('advContrast', 1); u.hpBright.value = num('advBrightness', 1);
    const vr = col('vrColor', [1, 1, 1]); u.hpVr.value.setRGB(vr[0], vr[1], vr[2]);
  } else {
    m.map = null;
    const d = col('diffuse', [0.5, 0.5, 0.5]); m.color.setRGB(d[0], d[1], d[2]);
  }

  // 반사
  u.hpReflGain.value = 1;
  if (!has('reflectOption') && !has('reflectTexFalloffColor1option')) {
    m.specularColorMap = null; m.specularColor.setRGB(0, 0, 0);
  } else if (vals.reflectOption === TEXTURE || (has('reflectTexFalloffColor1option') && vals.reflectTexFalloffColor1option === TEXTURE)) {
    m.specularColorMap = maps.reflect ?? null;
    m.specularColor.setRGB(1, 1, 1);
    u.hpReflGain.value = 1 + num(has('reflectBrightness') ? 'reflectBrightness' : 'reflectTexFalloffColor1Texbrightness', 0) / 100;
  } else {
    m.specularColorMap = null;
    const r = col(has('reflect') ? 'reflect' : 'reflectTexFalloffColor1', [0, 0, 0]); m.specularColor.setRGB(r[0], r[1], r[2]);
  }
  // 프레넬 (스키마에 없으면 V-Ray 원본 값)
  const fresnel = has('fresnel') ? vals.fresnel === true : t.vray?.fresnel ?? true;
  u.hpFresnel.value = fresnel ? 1 : 0;
  u.hpFresnelIor.value = Math.max(1.0001, has('fresnelIor') ? num('fresnelIor', 1.6) : t.vray?.fresnelIor ?? 1.6);

  // 반사 광택도
  if (vals.reflectGlossinessOption === TEXTURE) {
    m.roughnessMap = maps.gloss ?? null; m.roughness = 1 - num('reflectGlossiness', 1);
    u.hpGlossGain.value = 1 + num('reflectGlossinessBrightness', 0) / 100;
  } else {
    m.roughnessMap = null; m.roughness = Math.min(1, Math.max(0, 1 - num('reflectGlossiness', 1)));
  }

  // 요철 / 노멀
  const bumpK = num('newBumpMultiplier', 0);
  if (isNormalMode(vals)) {
    m.bumpMap = null; m.normalMap = maps.normal ?? null; m.normalScale.set(bumpK / 2, bumpK / 2);
  } else {
    m.normalMap = null; m.bumpMap = has('newBump') ? maps.bump ?? null : null; m.bumpScale = bumpK * BUMP_K;
  }

  // 굴절
  if (has('refractOption')) {
    const rTex = vals.refractOption === TEXTURE;
    m.transmissionMap = rTex ? maps.refract ?? null : null;
    m.transmission = rTex ? 1 : luma(col('refract', [0, 0, 0]));
    m.ior = Math.min(2.333, Math.max(1, num('ior', 1.6)));
    m.thickness = 0.02;
    if (has('refractGlossiness') && vals.refractGlossinessOption !== TEXTURE) m.roughness = Math.max(m.roughness, (1 - num('refractGlossiness', 1)) * 0.6);
  } else {
    m.transmission = 0; m.transmissionMap = null;
  }

  // 불투명도 / 투명도
  u.hpOpGain.value = 1;
  const opTex = has('opacityTex') && (!has('opacityOption') || vals.opacityOption === TEXTURE);
  m.alphaMap = opTex ? maps.opacity ?? null : null;
  m.opacity = !opTex && has('opacity') ? num('opacity', 1) : 1;
  if (opTex) u.hpOpGain.value = 1 + num('opacityBrightness', 0) / 100;
  m.transparent = !!m.alphaMap || m.opacity < 1;
  m.alphaTest = m.alphaMap ? 0.02 : 0;
  m.side = m.transparent || doubleSide ? THREE.DoubleSide : THREE.FrontSide;
  m.depthWrite = !m.transparent || !!m.alphaMap;

  // 변위
  m.displacementMap = has('displace') ? maps.displace ?? null : null;
  m.displacementScale = num('displaceMultiplier', 0) * DISP_K;
  m.displacementBias = -m.displacementScale / 2;

  // 자체 발광
  if (has('colorOption') || light) {
    const eTex = vals.colorOption === TEXTURE;
    m.emissiveMap = eTex ? maps.emit ?? null : null;
    const c = eTex ? [1, 1, 1] as Rgb : col('color', [1, 1, 1]);
    m.emissive.setRGB(c[0], c[1], c[2]);
    m.emissiveIntensity = num('energy', 10) / 10;
  } else {
    m.emissiveMap = null; m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1;
  }

  for (const tex of [m.map, m.specularColorMap, m.roughnessMap, m.bumpMap, m.normalMap, m.transmissionMap, m.alphaMap, m.displacementMap, m.emissiveMap]) {
    if (tex) tex.repeat.set(repeat[0], repeat[1]);
  }
  if (sig() !== before) m.needsUpdate = true;
}
