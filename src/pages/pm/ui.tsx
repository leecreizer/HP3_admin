import { useContext, useState, type ReactNode } from 'react';
import { syntaxError } from '../../pm/expr';
import { PmCtx, UNV } from './ctx';

/** 접는 묶음 — 쿠지알러 속성 패널·파라미터 설정의 묶음 머리 */
export function Sec({ title, actions, children, defaultOpen = true, className = '' }: { title: ReactNode; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`pm-sec ${open ? '' : 'closed'} ${className}`}>
      <header>
        <span className="t">{title}</span>
        {actions}
        <button className="pm-icon" aria-label={open ? '접기' : '펼치기'} aria-expanded={open} onClick={() => setOpen(!open)}><span className="chev" aria-hidden="true">⌃</span></button>
      </header>
      <div className="pm-sec-body">{children}</div>
    </section>
  );
}

export function Modal({ title, sub, children, footer, onClose, size = '', label }: { title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; size?: '' | 'wide' | 'mid'; label?: string }) {
  return (
    <div className="pm-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`pm-modal ${size}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        <header>
          <div><b>{title}</b>{sub && <small>{sub}</small>}</div>
          <button className="pm-x" aria-label="닫기" onClick={onClose}>×</button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/** 화면 안 확인 창 (window.confirm 대신) */
export function Confirm({ text, ok = '확인', cancel = '취소', onOk, onCancel, danger }: { text: ReactNode; ok?: string; cancel?: string; onOk: () => void; onCancel: () => void; danger?: boolean }) {
  return (
    <div className="pm-confirm" role="alertdialog" aria-modal="true">
      <div>
        <div>{text}</div>
        <footer>
          <button className="pm-btn" onClick={onCancel}>{cancel}</button>
          <button className={danger ? 'pm-btn danger' : 'pm-primary'} onClick={onOk}>{ok}</button>
        </footer>
      </div>
    </div>
  );
}

/**
 * 수식 입력 칸 — 쿠지알러 속성 패널의 ‘값 + 계산기 아이콘’.
 * 입력은 바로 반영(onChange), 계산기 아이콘은 수식 창. preview 가 있으면 계산값을 아래에 보인다.
 */
export function Fx({ value, onChange, title, unit, placeholder, preview, error, disabled, ariaLabel }: {
  value: string; onChange: (v: string) => void; title: string; unit?: string; placeholder?: string;
  preview?: string; error?: string; disabled?: boolean; ariaLabel?: string;
}) {
  const ctx = useContext(PmCtx);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value ?? '';
  const syn = text.trim() ? syntaxError(text) : null;
  const commit = () => { if (draft != null && draft !== value) onChange(draft); setDraft(null); };
  return (
    <>
      <div className={`pm-fx ${syn || error ? 'bad' : ''}`}>
        <input value={text} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel ?? title} spellCheck={false}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
        {unit && <span className="unit">{unit}</span>}
        {ctx && !disabled && (
          <button className="calc" title="수식 편집" aria-label={`${title} 수식 편집`}
            onClick={() => ctx.openFormula({ title, value: text, onSave: (v) => { setDraft(null); onChange(v); } })}>🖩</button>
        )}
      </div>
      {(syn || error) && <span className="err">{syn ?? error}</span>}
      {!syn && !error && preview != null && preview !== '' && preview !== text.trim() && <span className="val">= {preview}</span>}
    </>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`pm-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Unverified({ text = '미확인' }: { text?: string }) {
  return <span className="pm-unv" title={UNV}>{text}</span>;
}
