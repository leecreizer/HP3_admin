/**
 * 그룹 관리 — 상품관리 폴더(모델)를 불러와 교체 그룹으로 연결하고, 그룹들을 스타일로 묶는다.
 * - 상품 등록/폴더 분류는 상품관리에서만. 여기선 폴더(모델)를 "연결"만 한다.
 * - 모델 그룹: 같은 슬롯(도어·손잡이·몸통 등)에서 교체 가능한 모델(폴더)들의 묶음. 예: 시그니처도어, 슬라이딩도어
 * - 스타일: 여러 모델 그룹(도어 모델 그룹 + 서라운딩 + EP …)을 묶은 상위 그룹. 한 번에 구성·교체
 */
import { INITIAL_PRODUCTS, INITIAL_FOLDERS, INITIAL_FILTER_GROUPS, DEFAULT_THUMB, SAMPLE_BODYVAR_PRODUCTS, storageLeafFolder, type FilterGroup } from '../pages/Products';

/** 상품관리와 동일한 썸네일 정규화 — 업로드 이미지·생성 썸네일('hp3gen' 마커)은 유지, 없거나 옛 SVG면 기본 회색+아이콘 */
function normThumb<T extends { thumbUrl?: string }>(p: T): T {
  return (p.thumbUrl && (!p.thumbUrl.startsWith('data:image/svg') || p.thumbUrl.includes('hp3gen'))) ? p : { ...p, thumbUrl: DEFAULT_THUMB };
}

export type { FilterGroup };

/** 필터관리에서 정의한 필터 그룹 (localStorage) */
export function loadFilterGroups(): FilterGroup[] {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? '{}');
    if (Array.isArray(raw.filterGroups) && raw.filterGroups.length) return raw.filterGroups as FilterGroup[];
  } catch { /* ignore */ }
  return INITIAL_FILTER_GROUPS;
}

/** 그룹/구성 슬롯에서 다루는 부위 상품의 최소 정보 (상품관리에 등록된 운영상품) */
export type PartProduct = {
  contentCode: string;
  name: string;
  brand: string;
  productGroup: string;
  productKind: string; // 상품구분(품목) = 슬롯 기준 (도어·장·손잡이 …)
  productCode: string;
  folderId?: string;
  thumbUrl?: string;
  filterValues?: string[];
};

/** 상품관리 폴더(모델 분류) */
export type PartFolder = { id: string; name: string; parentId: string | null; kind?: 'external' | 'internal'; thumb?: string; thumbReset?: boolean; asProduct?: boolean; hidden?: boolean };

/** 현재 등록된 상품 (localStorage 우선, 없으면 시드) */
export function loadProducts(): PartProduct[] {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? '{}');
    if (Array.isArray(raw.products) && raw.products.length) {
      // 수납 직속 상품 → 종류별 최종 폴더 이관 + #body 데모 샘플 동기화(상품관리 로더와 동일)
      let list = raw.products as (PartProduct & { updatedBy?: string })[];
      list = list.map((p) => {
        const leaf = storageLeafFolder(p);
        return leaf ? { ...p, folderId: leaf } : p;
      });
      for (const sp of SAMPLE_BODYVAR_PRODUCTS as unknown as (PartProduct & { updatedBy?: string })[]) {
        const idx = list.findIndex((p) => p.contentCode === sp.contentCode);
        if (idx < 0) list.unshift(sp);
        else if (list[idx].updatedBy === '시스템') list[idx] = sp;
      }
      return list.map(normThumb);
    }
  } catch { /* ignore */ }
  return (INITIAL_PRODUCTS as unknown as PartProduct[]).map(normThumb);
}

/** 현재 상품관리 폴더 트리 (localStorage) */
export function loadFolders(): PartFolder[] {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? '{}');
    if (Array.isArray(raw.folders) && raw.folders.length) {
      // 수납 하위 샘플 분류 폴더 보장 — 상품관리 로더와 동일하게 병합
      const list = raw.folders as PartFolder[];
      for (const sf of (INITIAL_FOLDERS as unknown as PartFolder[]).filter((f) => f.parentId === 'f-storage')) {
        if (!list.some((f) => f.id === sf.id)) list.push({ ...sf });
      }
      return list;
    }
  } catch { /* ignore */ }
  return INITIAL_FOLDERS as unknown as PartFolder[];
}

/** rootId 폴더 + 모든 하위 폴더 id 집합 */
export function folderSubtree(folders: PartFolder[], rootId: string): Set<string> {
  const set = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId && set.has(f.parentId) && !set.has(f.id)) { set.add(f.id); added = true; }
    }
  }
  return set;
}

/** 폴더 대표 썸네일: 사용자 지정 > (초기화 시 기본) > 첫 등록 컨텐츠 썸네일 > 기본(없음) */
export function folderRepThumb(folderId: string, allFolders: PartFolder[], products: PartProduct[]): string | undefined {
  const f = allFolders.find((x) => x.id === folderId);
  if (f?.thumb) return f.thumb;
  if (f?.thumbReset) return undefined;
  // 직접 담긴 컨텐츠가 있는 폴더에만 자동 썸네일 적용 (상위 폴더는 하위 썸네일을 끌어오지 않음)
  const inFolder = products.filter((p) => p.folderId === folderId);
  if (inFolder.length === 0) return undefined;
  const earliest = [...inFolder].reverse().find((p) => p.thumbUrl) ?? inFolder[inFolder.length - 1];
  return earliest?.thumbUrl || undefined;
}

/** 모델 그룹 — 같은 슬롯에서 교체 가능한 모델(폴더) 묶음
 *  - type='normal'(기본): 개별 상품 + 폴더(폴더 내 상품)를 멤버로 묶음
 *  - type='grouping': 같은 카테고리의 일반 그룹들을 멤버로 묶음(그룹을 다시 묶기) */
export type SwapGroup = { id: string; name: string; kind: string; type?: 'normal' | 'grouping' }; // kind = 상품구분(품목) 슬롯
/** 스타일 — 일반 그룹관리에서 만든 모델 그룹들의 묶음 + 대표 썸네일. kind=스타일 카테고리(탭) */
export type StyleSet = { id: string; name: string; kind?: string; groupIds?: string[]; thumb?: string; folders?: string[] };

export type SwapState = {
  groups: SwapGroup[];
  /** 모델 그룹 id → 연결된 상품관리 폴더 id[] (폴더=모델 분류) */
  folders: Record<string, string[]>;
  /** 모델 그룹 id → 폴더별 모드(true=상품화 폴더: 설계에서 단일 자동조립 단위 / false·미설정=일반: 내부 상품 개별) */
  folderModes?: Record<string, Record<string, boolean>>;
  /** 모델 그룹 id → 직접 추가한 상품 contentCode[] (개별 상품 묶기) */
  items?: Record<string, string[]>;
  /** 그룹핑 그룹 id → 묶은 일반 그룹 id[] (그룹을 다시 묶기) */
  groupRefs?: Record<string, string[]>;
  /** 스타일 묶음 */
  styles: StyleSet[];
  /** 일반 그룹 카테고리 탭(몸통/도어/손잡이 …) — 모델 그룹 보유 */
  categories: string[];
  /** 스타일 그룹 카테고리 탭 — 모델 그룹들의 묶음(스타일) 보유 */
  styleCategories?: string[];
};

/** 읽기용 — 폴더 연결 + 직접 추가 상품을 펼쳐 그룹별 소속 contentCode[]로 변환 */
export function expandMembers(state: SwapState, allFolders: PartFolder[], products: PartProduct[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of state.groups) {
    const connected = state.folders[g.id] ?? [];
    const ids = new Set<string>();
    for (const fid of connected) for (const s of folderSubtree(allFolders, fid)) ids.add(s);
    const fromFolders = products.filter((p) => p.folderId && ids.has(p.folderId)).map((p) => p.contentCode);
    const direct = state.items?.[g.id] ?? [];
    out[g.id] = [...new Set([...fromFolders, ...direct])];
  }
  // 그룹핑(폴더 단위 노출) 그룹 — groupRefs로 다시 묶은 일반 그룹들의 멤버를 합산
  for (const g of state.groups) {
    const refs = state.groupRefs?.[g.id] ?? [];
    if (refs.length === 0) continue;
    const merged = new Set(out[g.id] ?? []);
    for (const rid of refs) for (const c of out[rid] ?? []) merged.add(c);
    out[g.id] = [...merged];
  }
  return out;
}

const KEY = 'hp3-swap-groups';
/** 구조(시드/카테고리)를 바꾸면 올려서 옛 저장본 무효화 */
const SWAP_VERSION = 2;

/** #body.변수명 확인용 샘플 — 샘플 몸통(SMP-BODY-001)의 구성 슬롯이 참조하는 도어 묶음 */
const SAMPLE_BODYVAR_GROUP: SwapGroup = { id: 'sg-sample-bodyvar-door', name: '샘플 도어(#body 데모)', kind: '도어' };
const SAMPLE_BODYVAR_ITEMS: Record<string, string[]> = {
  'sg-sample-bodyvar-door': ['SMP-DOOR-L01', 'SMP-DOOR-R01', 'SMP-DOOR-X01'],
};

const SEED: SwapState = {
  groups: [
    { id: 'sg-signature-door', name: '시그니처도어', kind: '도어' },
    { id: 'sg-sliding-door', name: '슬라이딩도어', kind: '도어' },
    { id: 'sg-body-basic', name: '기본 몸통', kind: '몸통' },
    { id: 'sg-handle', name: '기본 손잡이', kind: '손잡이' },
    SAMPLE_BODYVAR_GROUP,
  ],
  folders: {},
  items: { ...SAMPLE_BODYVAR_ITEMS },
  styles: [
    { id: 'st-modern', name: '모던', kind: '기본 스타일', groupIds: [] },
  ],
  categories: ['몸통', '도어', '손잡이'],
  styleCategories: ['기본 스타일'],
};

export function loadSwapState(): SwapState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<SwapState> & { __v?: number }) | null;
    if (raw && raw.__v === SWAP_VERSION && Array.isArray(raw.groups)) {
      // 옛 저장본에 categories 없으면 그룹들의 kind에서 유추
      const categories = raw.categories && raw.categories.length
        ? raw.categories
        : [...new Set([...(SEED.categories), ...raw.groups.map((g) => g.kind).filter(Boolean)])];
      // #body 변수 데모 샘플 그룹 — 기존 저장본에 없으면 병합(비파괴)
      const groups = raw.groups.some((g) => g.id === SAMPLE_BODYVAR_GROUP.id)
        ? raw.groups
        : [...raw.groups, SAMPLE_BODYVAR_GROUP];
      const items = { ...raw.items };
      if (!items[SAMPLE_BODYVAR_GROUP.id]?.length) items[SAMPLE_BODYVAR_GROUP.id] = [...SAMPLE_BODYVAR_ITEMS[SAMPLE_BODYVAR_GROUP.id]];
      return { groups, folders: raw.folders ?? {}, folderModes: raw.folderModes ?? {}, items, groupRefs: raw.groupRefs ?? {}, styles: raw.styles ?? [], categories, styleCategories: raw.styleCategories ?? SEED.styleCategories };
    }
  } catch { /* ignore */ }
  return SEED;
}
export function saveSwapState(s: SwapState) {
  try { localStorage.setItem(KEY, JSON.stringify({ groups: s.groups, folders: s.folders, folderModes: s.folderModes ?? {}, items: s.items ?? {}, groupRefs: s.groupRefs ?? {}, styles: s.styles, categories: s.categories, styleCategories: s.styleCategories ?? [], __v: SWAP_VERSION })); } catch { /* ignore */ }
}
