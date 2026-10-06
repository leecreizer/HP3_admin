import data from './modelTypes.json';

/**
 * 파라메트릭 모델 ‘모델 유형 선택(选择模型类别)’ 데이터와 도구 종류(tooltype)별 부품 라이브러리 폴더.
 *
 * 쿠지알러는 소재 만들기에서 업무 탭의 ‘파라메트릭 모델’ 카드를 누르면 에디터를 tooltype 과 함께 열고
 * (cabinet = 주방·욕실 맞춤, wardrobe = 전체 가구 맞춤, doorwindow = 창호 맞춤, arch = 몰드 클라우드),
 * 먼저 ‘모델 유형 선택’ 창에서 소속 라이브러리(프론트/백엔드)와 실제 분류(真分类)를 고르게 한다.
 * 고른 라이브러리·분류가 저장 후 입고 때 상품이 들어갈 곳이다.
 *
 * modelTypes.json ← scripts/build-create-data.py (custommodel/prodcats · bgs/dynamic-config 조회 덤프)
 */
export type ToolType = 'cabinet' | 'wardrobe' | 'doorwindow' | 'arch';
export type ModelCat = { id: number; name: string; zh: string; children?: ModelCat[] };
export type ModelLib = { lib: number; name: string; zh: string; group: 'front' | 'back'; position: number; cats: ModelCat[] };

export const MODEL_TYPES = data as Record<ToolType, { libs: ModelLib[] }>;
export const TOOLTYPES: ToolType[] = ['cabinet', 'wardrobe', 'doorwindow', 'arch'];
export const TOOLTYPE_LABEL: Record<ToolType, string> = { cabinet: '주방·욕실 맞춤', wardrobe: '전체 가구 맞춤', doorwindow: '창호 맞춤', arch: '몰드 클라우드' };
export const GROUP_LABEL: Record<ModelLib['group'], string> = { front: '프론트', back: '백엔드' };

export const modelLib = (tool: ToolType, lib: number) => MODEL_TYPES[tool].libs.find((l) => l.lib === lib);

/** 분류 id 의 경로(상위 → 하위). 같은 분류가 여러 곳에 있으면 처음 찾은 곳 */
export function catPath(cats: ModelCat[], id: number, path: ModelCat[] = []): ModelCat[] | null {
  for (const c of cats) {
    if (c.id === id) return [...path, c];
    const sub = c.children ? catPath(c.children, id, [...path, c]) : null;
    if (sub) return sub;
  }
  return null;
}

/** 분류 이름(한글·원문) 검색 — 경로와 함께 */
export function searchCats(cats: ModelCat[], q: string): ModelCat[][] {
  const out: ModelCat[][] = [];
  const walk = (list: ModelCat[], path: ModelCat[]) => {
    for (const c of list) {
      const p = [...path, c];
      if (c.name.toLowerCase().includes(q) || c.zh.includes(q)) out.push(p);
      if (c.children) walk(c.children, p);
    }
  };
  if (q) walk(cats, []);
  return out;
}

/** 부품 라이브러리(部件库) 폴더 — 도구 종류별 소재 라이브러리 번호 */
export const PART_FOLDERS: Record<ToolType, { name: string; libs: number[] }[]> = {
  cabinet: [
    { name: '미분류 모델', libs: [12] }, { name: '캐비닛 모드 라이브러리', libs: [15] }, { name: '캐비닛 조합 라이브러리', libs: [16] },
    { name: '부품 모드 라이브러리', libs: [17] }, { name: '내부 부품 라이브러리', libs: [18] }, { name: '반제품 라이브러리', libs: [20] },
    { name: '액세서리 라이브러리', libs: [19] }, { name: '가상 부품 라이브러리', libs: [21] },
  ],
  wardrobe: [
    { name: '미분류 모델', libs: [22] }, { name: '캐비닛 모드 라이브러리', libs: [25] }, { name: '캐비닛 조합 라이브러리', libs: [26] },
    { name: '부품 모드 라이브러리', libs: [27] }, { name: '내부 부품 라이브러리', libs: [28] }, { name: '반제품 라이브러리', libs: [30] },
    { name: '액세서리 라이브러리', libs: [29] }, { name: '가상 부품 라이브러리', libs: [31] },
  ],
  doorwindow: [
    { name: '미분류 모델', libs: [32] }, { name: '일반 창호 라이브러리', libs: [35] }, { name: '알루미늄 창호 라이브러리', libs: [41] },
    { name: '일반 부품 라이브러리', libs: [36] }, { name: '알루미늄 창호 부품 라이브러리', libs: [42] }, { name: '반제품 라이브러리', libs: [37] },
    { name: '액세서리 라이브러리', libs: [38] }, { name: '가상 부품 라이브러리', libs: [45] },
  ],
  arch: [
    { name: '모델 라이브러리', libs: [81] }, { name: '파라메트릭 모델 라이브러리', libs: [97] }, { name: '파라메트릭 모델 부품 라이브러리', libs: [98] },
  ],
};

export function toolOfLib(lib: number): ToolType | undefined {
  return TOOLTYPES.find((t) => PART_FOLDERS[t].some((f) => f.libs.includes(lib)));
}
