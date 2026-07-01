import { useState, type ReactNode } from 'react';

type ConfirmOpts = {
  title?: string;
  /** 무엇을 지우는지 설명 (문자열 또는 JSX) */
  message: ReactNode;
  /** 확인 버튼 라벨 (기본 '예, 삭제') */
  confirmLabel?: string;
  onConfirm: () => void;
};

/**
 * 삭제 등 파괴적 동작 공통 확인 팝업.
 * const { confirm, confirmDialog } = useConfirm();
 * 삭제 버튼 onClick: confirm({ message: '이 폴더를 삭제할까요?', onConfirm: () => doDelete() })
 * 렌더 어딘가에 {confirmDialog}
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const confirm = (o: ConfirmOpts) => setOpts(o);
  const confirmDialog = opts ? (
    <div className="modal-backdrop" onClick={() => setOpts(null)}>
      <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-label="삭제 확인" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">{opts.title ?? '삭제 확인'}</h2>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-2)', margin: '4px 0 16px', lineHeight: 1.6 }}>{opts.message}</p>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={() => setOpts(null)}>아니오</button>
          <button className="btn-danger" style={{ marginLeft: 0 }} onClick={() => { opts.onConfirm(); setOpts(null); }}>
            {opts.confirmLabel ?? '예, 삭제'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, confirmDialog };
}
