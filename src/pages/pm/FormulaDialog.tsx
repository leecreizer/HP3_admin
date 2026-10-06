import { useMemo, useState } from 'react';
import { FUNCTIONS, elementDef } from '../../pm/defs';
import { fmt, syntaxError } from '../../pm/expr';
import type { PmEval } from '../../pm/resolve';
import { Modal } from './ui';

const SCOPE_LABEL = { system: '시스템 변수', basic: '기본 변수', custom: '사용자 정의 변수', middle: '중간 변수', report: '보고 변수' } as const;

/**
 * 수식 편집 창 — 쿠지알러 속성 칸의 계산기 아이콘.
 * 왼쪽: 수식 입력 + 계산 결과(실시간) · 오른쪽: 변수 / 부품 참조(@) / 함수(46개, 설명·예제) 목록 — 누르면 커서 위치에 넣는다.
 */
export function FormulaDialog({ title, value, hint, ev, onSave, onClose }: { title: string; value: string; hint?: string; ev: PmEval; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [tab, setTab] = useState<'var' | 'ref' | 'fn'>('var');
  const [q, setQ] = useState('');
  const [ta, setTa] = useState<HTMLTextAreaElement | null>(null);
  const syn = text.trim() ? syntaxError(text) : null;
  const res = !syn && text.trim() ? ev.try(text) : {};

  const insert = (s: string) => {
    const el = ta;
    if (!el) { setText(text + s); return; }
    const a = el.selectionStart ?? text.length, b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + s.length, a + s.length); });
  };

  const query = q.trim().toLowerCase();
  const vars = useMemo(() => ev.model.vars.filter((v) => !query || v.name.toLowerCase().includes(query) || v.label.toLowerCase().includes(query)), [ev, query]);
  const refs = useMemo(() => ev.model.nodes.filter((n) => n.refName && (!query || n.refName.toLowerCase().includes(query) || n.name.toLowerCase().includes(query))), [ev, query]);
  const fns = useMemo(() => FUNCTIONS.filter((f) => !query || f.name.toLowerCase().includes(query) || f.desc.toLowerCase().includes(query)), [query]);

  return (
    <Modal title={`수식 — ${title}`} size="mid" onClose={onClose}
      footer={<>
        <span className="left pm-hint">{hint ?? '숫자 · #변수 · @참조명.변수 · 함수 · 조건식(? :) 을 쓸 수 있습니다'}</span>
        <button className="pm-btn" onClick={onClose}>취소</button>
        <button className="pm-primary" disabled={!!syn} onClick={() => { onSave(text.trim()); onClose(); }}>확인</button>
      </>}>
      <div className="pm-fdlg">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea ref={setTa} value={text} spellCheck={false} autoFocus aria-label="수식" onChange={(e) => setText(e.target.value)} />
          <div className="pm-keys" aria-label="연산자">
            {['+', '-', '*', '/', '%', '^', '(', ')', '==', '!=', '>', '<', '>=', '<=', ' AND ', ' OR ', ' ? ', ' : '].map((k) => <button key={k} onClick={() => insert(k)}>{k.trim()}</button>)}
          </div>
          {syn ? <div className="pm-fres bad">문법 오류: {syn}</div>
            : res.error ? <div className="pm-fres bad">계산 오류: {res.error}</div>
              : text.trim() ? <div className="pm-fres">= {fmt(res.value)} <small style={{ color: '#7a8494', marginLeft: 8 }}>{res.value?.k === 'n' ? (res.value.int ? '정수' : '실수') : res.value?.k === 's' ? '문자' : res.value?.k === 'b' ? '참·거짓' : ''}</small></div>
                : <div className="pm-fres" style={{ color: '#7a8494' }}>값을 입력하세요</div>}
          <p className="pm-hint">정수끼리 나누면 몫만 남습니다(예: 7/2 = 3). 소수 결과가 필요하면 7/2.0 처럼 소수점을 쓰세요. 실수를 문자와 이으면 “.0”이 붙으니 float2Int 를 쓰세요.</p>
        </div>
        <div className="pm-flist">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'var'} className={tab === 'var' ? 'on' : ''} onClick={() => setTab('var')}>변수</button>
            <button role="tab" aria-selected={tab === 'ref'} className={tab === 'ref' ? 'on' : ''} onClick={() => setTab('ref')}>부품 참조</button>
            <button role="tab" aria-selected={tab === 'fn'} className={tab === 'fn' ? 'on' : ''} onClick={() => setTab('fn')}>함수</button>
          </div>
          <input className="pm-in" style={{ border: 0, borderBottom: '1px solid #e3e6ea', borderRadius: 0 }} placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="목록 검색" />
          <ul>
            {tab === 'var' && (Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((sc) => {
              const list = vars.filter((v) => v.scope === sc);
              if (!list.length) return null;
              return [<li key={sc} className="grp">{SCOPE_LABEL[sc]}</li>, ...list.map((v) => {
                const r = ev.varEval(v.name);
                return <li key={v.id}><button onClick={() => insert(`#${v.name}`)}><b>#{v.name}</b><small>{v.label} = {r?.error ? '오류' : fmt(r?.value)}</small></button></li>;
              })];
            })}
            {tab === 'var' && [<li key="env" className="grp">환경 (설계 툴 배치 시)</li>,
              ...['#selfPosition.x', '#selfPosition.y', '#selfPosition.z', '#selfRotate.x', '#selfRotate.y', '#selfRotate.z'].map((k) => <li key={k}><button onClick={() => insert(k)}><b>{k}</b><small>{k.includes('Position') ? '배치 위치' : '배치 회전'} — 에디터에서는 0</small></button></li>)]}
            {tab === 'ref' && refs.map((n) => {
              const def = elementDef(n.def);
              const params = n.sub?.kind === 'param' ? ['W', 'D', 'H', ...(ev.child(n)?.model.vars.filter((v) => v.scope === 'custom').map((v) => v.name) ?? [])]
                : def?.params.filter((p) => ['float', 'int', 'material', 'boolean'].includes(p.type)).map((p) => p.name) ?? [];
              return [<li key={n.id} className="grp">@{n.refName} · {n.name}</li>, ...params.slice(0, 14).map((p) => (
                <li key={`${n.id}.${p}`}><button onClick={() => insert(`@${n.refName}.${p}`)}><b>@{n.refName}.{p}</b><small>{def?.params.find((x) => x.name === p)?.label ?? p}</small></button></li>
              )), ...(n.sub ? [<li key={`${n.id}.ps`}><button onClick={() => insert(`#${n.refName}.paramStyle.name`)}><b>#{n.refName}.paramStyle.name</b><small>하위 부품 상품 이름</small></button></li>] : [])];
            })}
            {tab === 'ref' && !refs.length && <li className="pm-empty">참조명이 있는 부품이 없습니다. 부품 속성에서 참조명을 정하면 @참조명.변수 로 읽을 수 있습니다.</li>}
            {tab === 'fn' && fns.map((f) => (
              <li key={f.name}><button title={f.example} onClick={() => insert(/^[A-Za-z]/.test(f.name) && !['AND', 'OR'].includes(f.name) ? `${f.name}()` : ` ${f.name === '?:' ? '? :' : f.name} `)}>
                <b>{f.name}</b><small>{f.desc}</small>{f.example && <small style={{ fontFamily: 'var(--num)' }}>예) {f.example.split('\n')[0].slice(0, 80)}</small>}
              </button></li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
