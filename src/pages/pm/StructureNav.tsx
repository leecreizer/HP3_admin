import { useState } from 'react';
import { NAV_GROUPS, elementDef } from '../../pm/defs';
import type { PmNode } from '../../pm/types';
import { usePm } from './ctx';

export type NavAction = 'copy' | 'rename' | 'replace' | 'array' | 'unarray' | 'toggle' | 'up' | 'down' | 'delete';

/**
 * 구조 탐색(结构导航) — 모델 이름 아래 묶음: 부품 · 모델 외곽 틀 · 윤곽 제한 · 흡착선 · 내부 공간 · 문 개구부 · 간섭 영역 · 연결 부품 · 사용자 정의 구조.
 * 항목마다 눈(보기 숨김). 오른쪽 클릭: 복제 · 이름 바꾸기 · 교체 · 배열 · 배열 해제 · 표시/숨김 · 위/아래 · 삭제 (교육 문서의 ‘右击…复制/阵列’)
 */
export function StructureNav({ sel, onSelect, onAction, onClose, onRename }: {
  sel: string | null;
  onSelect: (id: string | null) => void;
  onAction: (a: NavAction, node: PmNode) => void;
  onRename: (node: PmNode, name: string) => void;
  onClose: () => void;
}) {
  const { model, ev } = usePm();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [ctx, setCtx] = useState<{ x: number; y: number; node: PmNode } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const toggleGroup = (k: string) => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const item = (n: PmNode) => {
    const hidden = ev.bool(n, 'ignore');
    const sup = ev.bool(n, 'KJL_model_suppress_param');
    const def = elementDef(n.def);
    return (
      <div key={n.id} className={`pm-nav-item ${sel === n.id ? 'on' : ''} ${hidden ? 'hid' : ''} ${sup ? 'sup' : ''}`}
        onClick={() => onSelect(n.id)} onDoubleClick={() => setRenaming({ id: n.id, name: n.name })}
        onContextMenu={(e) => { e.preventDefault(); onSelect(n.id); setCtx({ x: e.clientX, y: e.clientY, node: n }); }}
        title={`${n.name}${n.sub ? ` — ${n.sub.name}` : ` — ${def?.name ?? ''}`}${hidden ? ' (숨김 조건 참)' : ''}${sup ? ' (억제)' : ''}`}>
        <span aria-hidden="true" style={{ flex: 'none' }}>{n.sub ? (n.sub.kind === 'mesh' ? '▣' : '⧉') : def?.section === 'paramModels' ? '▭' : '⌗'}</span>
        {renaming?.id === n.id
          ? <input value={renaming.name} autoFocus aria-label="이름" onClick={(e) => e.stopPropagation()} onChange={(e) => setRenaming({ id: n.id, name: e.target.value })}
            onBlur={() => { if (renaming.name.trim()) onRename(n, renaming.name.trim()); setRenaming(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          : <span>{n.name}{n.array && ' ⋯'}</span>}
        {n.refName && <span className="ref">@{n.refName}</span>}
        <button className={`pm-icon eye ${n.viewHidden ? 'off' : ''}`} aria-label={n.viewHidden ? '보이기' : '감추기'} title="에디터에서 보기/감추기 (H)"
          onClick={(e) => { e.stopPropagation(); onAction('toggle', n); }}>{n.viewHidden ? '◌' : '👁'}</button>
      </div>
    );
  };

  return (
    <div className="pm-float pm-nav" role="complementary" aria-label="구조 탐색">
      <header><b>구조 탐색</b><button className="pm-x" aria-label="구조 탐색 닫기" onClick={onClose}>×</button></header>
      <div className="pm-nav-body">
        <div className={`pm-nav-root ${sel == null ? 'on' : ''}`} onClick={() => onSelect(null)}>≋ {model.name}</div>
        {NAV_GROUPS.map((g) => {
          const nodes = g.key === 'frame' ? [] : model.nodes.filter((n) => g.sections.includes(n.sub ? 'modelInstances' : elementDef(n.def)?.section ?? ''));
          const open = !closed.has(g.key);
          return (
            <div key={g.key}>
              <div className="pm-nav-g" onClick={() => toggleGroup(g.key)}><span aria-hidden="true">{open ? '▾' : '▸'}</span>{g.label}{g.key !== 'frame' && <small>{nodes.length || ''}</small>}</div>
              {open && g.key === 'frame' && (
                <div className={`pm-nav-item ${sel === '__frame' ? 'on' : ''}`} onClick={() => onSelect('__frame')}><span aria-hidden="true">⬚</span><span>사각 외곽 틀</span></div>
              )}
              {open && nodes.map(item)}
            </div>
          );
        })}
      </div>
      {ctx && <>
        <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
        <div className="pm-ctx" style={{ left: ctx.x, top: ctx.y }}>
          {([
            ['copy', '복제', 'Ctrl+V'], ['rename', '이름 바꾸기', ''], ['replace', '교체', 'C'], ['array', '배열', 'A'], ['unarray', '배열 해제', 'Ctrl+Shift+A'],
            ['toggle', ctx.node.viewHidden ? '보이기' : '감추기', 'H'], ['up', '위로', ''], ['down', '아래로', ''],
          ] as [NavAction, string, string][]).map(([a, label, key]) => (
            <button key={a} disabled={(a === 'replace' && ctx.node.sub?.kind !== 'param') || (a === 'unarray' && !ctx.node.array) || (a === 'array' && !!ctx.node.array)}
              onClick={() => { if (a === 'rename') setRenaming({ id: ctx.node.id, name: ctx.node.name }); else onAction(a, ctx.node); setCtx(null); }}>
              {label}{key && <kbd>{key}</kbd>}
            </button>
          ))}
          <hr />
          <button className="danger" onClick={() => { onAction('delete', ctx.node); setCtx(null); }}>삭제<kbd>Delete</kbd></button>
        </div>
      </>}
    </div>
  );
}
