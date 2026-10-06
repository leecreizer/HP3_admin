import { PmEditor } from './pm/PmEditor';
import type { ModelOpenRequest, ModelResult } from '../pm/link';

/** 에디터 › 파라메트릭 모델 에디터 — 쿠지알러 参数化模型编辑器를 참고해 새로 만든 에디터 */
export function PmStudio({ userName }: { userName?: string }) {
  return (
    <main className="main pm-page">
      <PmEditor userName={userName} />
    </main>
  );
}

/**
 * 컨텐츠 라이브러리(소재 만들기 ‘파라메트릭 모델’ · 상세 ‘모델 설정’)에서 여는 전체 화면 에디터.
 * ‘저장 후 입고’를 누르면 GLB·썸네일·크기를 onDone 으로 넘기고, 컨텐츠 라이브러리가 상품을 만들거나 갱신한다.
 */
export function PmEditorOverlay({ request, userName, onDone, onClose }: { request: ModelOpenRequest; userName?: string; onDone: (r: ModelResult) => void | Promise<void>; onClose: () => void }) {
  return (
    <div className="pm-overlay" role="dialog" aria-modal="true" aria-label="파라메트릭 모델 에디터">
      <PmEditor request={request} userName={userName} onRegister={onDone} onClose={onClose} />
    </div>
  );
}
