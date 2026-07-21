/**
 * 상품 스토어(hp3-products-state) 연동 헬퍼 — 조립 모델을 기본 상품으로 등록하기 위한 최소 R/W.
 * Products.tsx의 load/save는 export되지 않아 localStorage를 직접 다룬다(스냅샷 보존 + __v 유지).
 */
const PKEY = 'hp3-products-state';
const PVER = 6;

interface FolderLike { id: string; name: string; parentId: string | null; kind?: string; hidden?: boolean }

/** 유효한(버전 6) 상품 스냅샷을 반환. 없거나 버전 불일치면 null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadProductsSnapshot(): any | null {
  try {
    const s = JSON.parse(localStorage.getItem(PKEY) ?? 'null');
    if (s && s.__v === PVER && Array.isArray(s.products) && Array.isArray(s.folders)) return s;
  } catch { /* ignore */ }
  return null;
}

export interface CatFolder { id: string; path: string }

/** 저장 위치로 고를 수 있는 카테고리(외부 트리의 말단 폴더) 목록 — id + 표시 경로. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function categoryFolders(s: any): CatFolder[] {
  const folders: FolderLike[] = s.folders ?? [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const hasChild = new Set(folders.map((f) => f.parentId).filter(Boolean));
  const path = (f: FolderLike): string => {
    const names: string[] = []; let cur: FolderLike | undefined = f; let g = 0;
    while (cur && g++ < 20) { names.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return names.join(' / ');
  };
  return folders
    .filter((f) => f.kind !== 'internal' && !f.hidden && f.id !== 'f-root' && !hasChild.has(f.id))
    .map((f) => ({ id: f.id, path: path(f) }));
}

/** 상품 분류(기본정보 필수 필드용) — 상품군·견적그룹(군별)·상품구분(군별). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function productTaxonomy(s: any): { groups: string[]; quoteByGroup: Record<string, string[]>; kindsByGroup: Record<string, string[]> } {
  const qg = s.quoteGroups ?? {};
  const quoteByGroup: Record<string, string[]> = {};
  for (const g of Object.keys(qg)) {
    const arr = Array.isArray(qg[g]) ? qg[g] : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quoteByGroup[g] = arr.map((q: any) => (typeof q === 'string' ? q : q?.name)).filter(Boolean);
  }
  return { groups: s.productGroups ?? [], quoteByGroup, kindsByGroup: s.kindsByGroup ?? {} };
}

/** 기존 상품과 겹치지 않는 contentCode 생성(MDL + 6자리). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function genContentCode(s: any): string {
  const used = new Set((s.products ?? []).map((p: { contentCode: string }) => p.contentCode));
  let n = 0; let code = '';
  do { code = 'MDL' + String((Date.now() + n) % 1000000).padStart(6, '0'); n++; } while (used.has(code));
  return code;
}

/** 상품 배열을 저장(다른 필드·__v 보존). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeProducts(s: any, products: any[]): void {
  localStorage.setItem(PKEY, JSON.stringify({ ...s, products, __v: PVER }));
}

/** 스냅샷에 상품을 추가 저장. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function appendProduct(s: any, product: any): void {
  writeProducts(s, [...s.products, product]);
}

/** modelGroupId로 기존 상품 찾기(조립 모델 재수정 시 갱신 대상). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findProductByGroup(s: any, groupId: string): any | undefined {
  return (s.products ?? []).find((p: { modelGroupId?: string }) => p.modelGroupId === groupId);
}