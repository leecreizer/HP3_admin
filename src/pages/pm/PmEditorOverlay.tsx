import { PmEditor } from './PmEditor';
import type { Item } from '../../data/contentLibrary';
import type { NewItemDraft } from '../content/createTypes';
import type { ModelOpenRequest, ModelResult } from '../../pm/link';

/**
 * 파라메트릭 모델 에디터 창 — 컨텐츠 라이브러리에서만 연다
 * (컨텐츠 제작 ‘파라메트릭 모델’ 카드 · 상품 ‘모델 편집’ · 상세 ‘모델 설정 (에디터)’).
 * ‘저장 후 입고’를 누르면 GLB·썸네일·크기를 onDone 으로 넘기고, 컨텐츠 라이브러리가 상품을 만들거나 갱신한다.
 */
export function PmEditorOverlay({ request, userName, onDone, onClose, onAddItems }: {
  request: ModelOpenRequest; userName?: string; onDone: (r: ModelResult) => void | Promise<void>; onClose: () => void;
  /** 단면 그리기로 만든 몰딩 상품을 컨텐츠 라이브러리에 */
  onAddItems?: (drafts: NewItemDraft[], msg: string) => Item[];
}) {
  return (
    <div className="pm-overlay" role="dialog" aria-modal="true" aria-label="파라메트릭 모델 에디터">
      <PmEditor request={request} userName={userName} onRegister={onDone} onClose={onClose} onAddItems={onAddItems} />
    </div>
  );
}
