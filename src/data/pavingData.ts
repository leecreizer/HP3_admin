/**
 * 타일 상품(쿠지알러 铺贴产品) 업로드 화면 정적 데이터 — 2026-10-07 쿠지알러 HANSSEM 계정 화면·조회 GET 으로 확인.
 *  렌더 분류  ← deco_cms/api/categories (categoryTrees)
 *  붙임 방식  ← 같은 응답의 pavingStyleTypeData (1=타일·석재, 2=바닥재, 3=카펫) — 기본 방식이 맨 앞
 * 한글 이름은 시드 생성(build-content-seed.py)·재질 분류(build-create-data.py)에서 쓰던 번역과 맞췄다.
 */

export type RenderCat = { id: number; name: string; zh: string; children: RenderCat[] };

const C = (id: number, name: string, zh: string, children: RenderCat[] = []): RenderCat => ({ id, name, zh, children });

export const TILE_RENDER_CATS: RenderCat[] = [
  C(3112, '타일', '瓷砖', [
    C(3113, '앤티크 타일', '仿古砖'), C(3114, '모던 앤티크 타일', '现代仿古砖'), C(3115, '풀 폴리싱 유약 타일', '全抛釉'), C(3116, '폴리싱 타일', '抛光砖'),
    C(3117, '결정화 석재', '微晶石'), C(3118, '문화석', '文化石'), C(3119, '자기질 폴리싱 타일', '瓷抛砖'), C(3120, '벽 타일', '瓷片'),
    C(3121, '대리석 타일', '大理石瓷砖'), C(3108, '보더 타일', '波打线砖'), C(3234, '세라믹 슬래브', '岩板'), C(3127, '기타', '其它'),
  ]),
  C(506, '바닥재', '地板', [
    C(3128, '원목 마루', '实木地板'), C(3129, '강화 마루', '复合地板'), C(3130, '대나무 마루', '竹木地板'), C(3131, '코르크 마루', '软木地板'),
    C(3132, '합판 마루', '复合实木地板'), C(3133, '조립식 마루', '拼接地板'), C(3134, 'WPC 마루', '木塑地板'), C(3135, '기타', '其它'),
  ]),
  C(800, '카펫·바닥 시트', '地毯地胶'),
  C(3213, '석재', '石材', [
    C(3214, '대리석', '大理石'), C(3215, '화강석', '花岗石'), C(3216, '문화석', '文化石'), C(3217, '인조석', '人造石'), C(3218, '슬레이트', '板岩'), C(3219, '기타', '其它'),
  ]),
];

export const RENDERCAT = { CERAMIC: 3112, FLOOR: 506, CARPET: 800, STONE: 3213, WAVE_LINE: 3108 } as const;

/** 붙임 방식 id (쿠지알러 그대로) */
export const PAVING = { STRAIGHT: 1, H: 2, THREE: 3, ZIGZAG: 4, VORTEX: 5, CUSTOM: 9, FISHBONE: 10 } as const;
export const PAVING_NAME: Record<number, { name: string; zh: string }> = {
  1: { name: '일자 붙임', zh: '连续直铺' }, 2: { name: '엇갈림(I자) 붙임', zh: '工字铺' }, 3: { name: '3·6·9 붙임', zh: '三六九铺' },
  4: { name: '헤링본', zh: '人字铺' }, 5: { name: '바람개비 붙임', zh: '旋风铺' }, 9: { name: '맞춤 배열', zh: '定制铺法' }, 10: { name: '피시본', zh: '鱼骨铺' },
};
/** 렌더 대분류별 붙임 방식 — 기본 방식이 맨 앞 (쿠지알러 preHandlePaving) */
export const PAVING_BY_CAT: Record<number, number[]> = {
  3112: [1, 2, 3, 4, 5, 10], // 타일 (pavingStyleTypeData[1])
  3213: [1, 2, 3, 4, 5, 10], // 석재 (pavingStyleTypeData[1])
  506: [2, 1, 3, 4, 10], // 바닥재 (pavingStyleTypeData[2], 기본 엇갈림)
  800: [1, 2, 3, 4, 5, 10], // 카펫 (pavingStyleTypeData[3])
};

/** 크기 범위 — 바닥재·석재·카펫 10–25000mm, 그 밖 10–8000mm */
export const sizeMax = (cat1?: number) => (cat1 === RENDERCAT.FLOOR || cat1 === RENDERCAT.STONE || cat1 === RENDERCAT.CARPET ? 25000 : 8000);

export function renderPath(ids: number[]): RenderCat[] {
  const out: RenderCat[] = [];
  let list = TILE_RENDER_CATS;
  for (const id of ids) { const c = list.find((x) => x.id === id); if (!c) break; out.push(c); list = c.children; }
  return out;
}

/** 새 타일 상품 기본값 (쿠지알러 createImg) */
export const TILE_DEFAULTS = { gapColor: '#999999', gapWidth: 1.5 };
export const TILE_PAGE_SIZE = 60;
