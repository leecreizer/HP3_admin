/**
 * 실시간 재질 제작 도구(쿠지알러 实时材质制作工具) 데이터 — public/pbr-templates.json 을 편집기를 열 때 한 번만 불러온다.
 * 템플릿 289종 = ‘실시간 재질 분류’의 재질과 같은 것(id = obsPtextureId). 속성 묶음·속성은 쿠지알러 재질 스키마(attributeCategories) 그대로.
 * 만든 스크립트: scripts/build-pbr-templates.py
 */

export type PbrAttrType = 'Option' | 'File' | 'AColor' | 'Color' | 'Float' | 'Switch';
export type Rgb = [number, number, number];
export type PbrValue = number | boolean | string | Rgb;
/** 속성 — k(overridePath)·t(종류)·l(표시 이름)·v(기본값)·r(범위)·o(선택지 [이름, 경로, 값]) */
export type PbrAttr = { k: string; t: PbrAttrType; l: string; v: PbrValue; r?: [number, number]; o?: [string, string, number][] };
export type PbrGroup = { id: number; name: string; attrs: PbrAttr[] };
export type PbrTemplate = {
  id: string; name: string; zh: string; cat: number; ball: string; model: number; scale: [number, number]; shader: string;
  groups: PbrGroup[];
  /** 요철/노멀 묶음에서 ‘노멀’일 때 쓰는 노멀 맵 */
  normal?: string;
  /** 스키마에 프레넬 묶음이 없는 템플릿의 V-Ray 원본 값 */
  vray?: { fresnel: boolean; fresnelIor: number };
};
export type PbrPreset = { name: string; img: string };
export type PbrData = { cats: { v: number; zh: string; name: string }[]; templates: PbrTemplate[]; presets: Record<string, PbrPreset[]> };

let cache: Promise<PbrData> | null = null;
export function loadPbrData(): Promise<PbrData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}pbr-templates.json`)
      .then((r) => { if (!r.ok) throw new Error(`재질 템플릿을 불러오지 못했습니다 (${r.status})`); return r.json() as Promise<PbrData>; })
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

/** 속성 묶음 번호 (쿠지알러 matParamCategoryIdEnum) — -1 은 번호 없는 ‘투명도’ */
export const G = { DIFFUSE: 0, REFLECT: 1, REFRACT: 2, GLOSS: 3, NORMAL: 4, COLOR: 5, FRESNEL: 6, OPACITY: 7, DISPLACE: 8, REFRACT_GLOSS: 10, FALLOFF: 11, TRANSPARENCY: -1 } as const;

/** 표시 모델 (쿠지알러 modelTypeEnum) — 쿠지알러 모델(로고 셰이더볼)은 HP3 셰이더볼로 */
export const MODELS: { id: number; name: string; icon: string }[] = [
  { id: 0, name: '구체 모델', icon: '●' },
  { id: 1, name: '판재 모델', icon: '▯' },
  { id: 2, name: '천 모델', icon: '◠' },
  { id: 3, name: '정육면체 모델', icon: '◼' },
  { id: 4, name: '셰이더볼 모델', icon: '◉' },
];
export const DISPLACE_MODEL = { id: -1, name: '변위 모델', icon: '▦' };

/** 묶음 설명 (쿠지알러 ? 도움말 문구 — 영상은 빼고 글만) */
export const GROUP_HELP: Record<number, { title: string; lines: string[] }> = {
  [G.DIFFUSE]: { title: '확산 반사', lines: ['색 — 재질 표면의 색을 정합니다', '맵 — 재질 표면의 색과 무늬를 정합니다'] },
  [G.REFLECT]: { title: '반사 매개변수', lines: ['색: 그 색으로 반사합니다. 검정은 전혀 반사하지 않고, 흰색은 강하게 반사합니다', '맵: 맵의 색으로 반사합니다. 검정은 전혀 반사하지 않고, 흰색은 강하게 반사합니다'] },
  [G.GLOSS]: { title: '반사 광택도 매개변수', lines: ['맵: 보통 흑백 채널 이미지 — 검정은 반사가 완전히 흐리고, 흰색은 거울처럼 맑습니다', '수치: 표면 반사가 흐린 정도 — 클수록 반사가 맑습니다'] },
  [G.FRESNEL]: { title: '프레넬 매개변수', lines: ['켜면 보는 각도에 따라 반사 세기가 달라집니다 — 정면보다 옆면에서 더 강하게 반사합니다', '끄면 모든 각도에서 똑같이 반사합니다', '프레넬 굴절률이 높을수록 표면 반사가 강해집니다'] },
  [G.NORMAL]: { title: '요철 매개변수', lines: ['보통 흑백 채널 이미지 — 흰색은 튀어나오고 검정은 들어갑니다', '요철 비율은 요철의 깊이 — 클수록 요철이 강합니다'] },
  [G.REFRACT]: { title: '굴절 매개변수', lines: ['굴절 색과 투명함을 정합니다. 흰색에 가까울수록 투명하고 검정에 가까울수록 불투명합니다. 굴절 색이 흰색이면 확산 반사는 효과가 없습니다', '굴절률: 빛이 재질을 지날 때 꺾이는 정도 — 1 이면 꺾이지 않습니다'] },
  [G.OPACITY]: { title: '불투명도 매개변수', lines: ['맵: 흰색은 불투명, 검을수록 투명해지고 검정이면 완전히 투명합니다', '수치: 1 이면 불투명, 작을수록 투명해지고 0 이면 완전히 투명합니다'] },
  [G.TRANSPARENCY]: { title: '불투명도 매개변수', lines: ['맵: 흰색은 불투명, 검을수록 투명해지고 검정이면 완전히 투명합니다'] },
  [G.DISPLACE]: { title: '변위 매개변수', lines: ['맵으로 모델의 꼭짓점을 밀어 평면에 요철을 만듭니다. 변위 맵은 보통 흑백 — 흰색은 튀어나오고 검정은 들어갑니다'] },
  [G.REFRACT_GLOSS]: { title: '굴절 광택도 매개변수', lines: ['굴절의 선명함을 정합니다', '맵: 보통 흑백 채널 이미지 — 검정은 완전히 흐리고, 흰색은 완벽한 유리 굴절', '수치: 1 이면 완벽한 유리 굴절, 낮을수록 흐리거나 광택 있는 굴절'] },
  [G.FALLOFF]: { title: '감쇠 매개변수', lines: ['정면과 측면의 색·맵을 바꿔 두 색·맵을 섞습니다. 천의 보송보송한 느낌에 많이 씁니다'] },
};

/** 쿠지알러 이미지 서버(OSS) 크기 조절 — 실시간 미리보기 맵 해상도(1024·2048), 재질 공 아이콘 */
const KJ_HOST = /(^|\/\/)[^/]*kujiale\.com\//;
export function texUrl(url: string, res: number): string {
  if (!KJ_HOST.test(url) || url.includes('?')) return url;
  return `${url}?x-oss-process=image/resize,h_${res},w_${res}`;
}
export function ballUrl(url: string, px: number): string {
  if (!url || !KJ_HOST.test(url) || url.includes('?')) return url;
  return `${url}?x-oss-process=image/resize,m_fill,w_${px},h_${px}/format,webp`;
}
