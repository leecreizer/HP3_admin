import type { BizTab, ContentState, Item } from '../../data/contentLibrary';
import type { CreatePortal } from '../../data/contentCreate';

/** 컨텐츠 제작 화면이 만든 소재 (폴더를 정하지 않으면 그 라이브러리의 ‘미분류’) */
export type NewItemDraft = Pick<Item, 'name' | 'lib'> & Partial<Item>;

/**
 * 만든 뒤 화면 처리 — 쿠지알러 업로드 화면의 두 버튼
 *  keep   ‘계속 올리기’(继续上传): 저장하고 같은 화면을 빈 양식으로
 *  detail ‘완료’(完成上传): 저장하고 새 상품 상세로
 *  silent 다른 창(파라메트릭 에디터 단면 그리기)이 만든 상품 — 알림·창 닫기 없이 넣기만
 */
export type CreateOpts = { keep?: boolean; detail?: boolean; silent?: boolean };

export type PageProps = {
  tab: BizTab;
  portal: CreatePortal;
  st: ContentState;
  onClose: () => void;
  onCreate: (drafts: NewItemDraft[], msg: string, opts?: CreateOpts) => string[];
  /** 만든 상품 고치기 — 파라메트릭 편집기의 두 번째 저장부터 */
  onUpdate?: (id: string, patch: Partial<Item>, action: string) => void;
  /** 만든 상품으로 가기 — 화면을 닫고 그 상품의 폴더를 연다 (쿠지알러 ‘상품 목록 보기’) */
  onReveal: (itemId: string) => void;
};
