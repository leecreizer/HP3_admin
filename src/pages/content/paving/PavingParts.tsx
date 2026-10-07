import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { evalExpr } from '../../../parts/formula';
import type { Folder, Item } from '../../../data/contentLibrary';
import { PV_PARAM_TYPES, type PvMachine, type PvParam, type PvParamType, type PvScheme, type PvSprite } from '../../../data/paving';
import { itemLW, subtreeIds } from '../decoUtil';
import { RESERVED, toSprite, validateShape } from './pavingUtil';
import { ProfileEditor } from '../../pm/ProfileEditor';
import { sectionContext, sectionShape, sectionStartPath } from '../../../pm/sections';
import { bounds, clipOutline, layoutScheme, type Scope, type V2 } from './pavingGeom';
import { drawScheme, fitView, type ImgCache, type View } from './pavingDraw';

/* ───────────────────────── 공통 ───────────────────────── */

export function PvModal({ title, onClose, children, footer, width = 520, className = '' }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; className?: string;
}) {
  return (
    <div className="pv-modal-bg" onPointerDown={(e) => e.stopPropagation()}>
      <div className={`pv-modal ${className}`} role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <header><b>{title}</b><button className="pv-x" aria-label="닫기" onClick={onClose}>×</button></header>
        <div className="pv-modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

const INF_LABEL = '무한';

/* ───────────────────────── 수식 입력칸 ───────────────────────── */

/**
 * 수식 입력칸 (쿠지알러 input-rich) — Enter·포커스 해제 때 확인, 계산기 아이콘 = 수식 편집기,
 * 개수 칸은 ‘무한’ 제안, 숫자 매개변수 제안. 잘못된 수식·범위 밖이면 빨간 테두리와 문구
 */
export function PvInput({ label, value, onCommit, scope, min, max, count, params, formulas, onSaveFormula, unit, disabled }: {
  label: string; value: string; onCommit: (v: string) => void; scope: Scope;
  min?: number; max?: number; count?: boolean; unit?: string; disabled?: boolean;
  params: PvParam[]; formulas: PvScheme['formulas']; onSaveFormula: (f: { name: string; expr: string }) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [sug, setSug] = useState(false);
  const [fx, setFx] = useState(false);
  const show = (v: string) => (count && v.trim().toUpperCase() === 'INF' ? INF_LABEL : v);
  const check = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return '값을 넣으세요';
    if (count && (t === INF_LABEL || t.toUpperCase() === 'INF')) return null;
    const v = evalExpr(t, scope);
    if (v == null) return '수식이 잘못되었습니다';
    if (min != null && v < min) return `범위를 벗어났습니다 (${min}${max != null ? `~${max}` : ' 이상'})`;
    if (max != null && v > max) return `범위를 벗어났습니다 (${min != null ? `${min}~` : ''}${max}${min == null ? ' 이하' : ''})`;
    return null;
  };
  const commit = (raw: string) => {
    const e = check(raw);
    setErr(e ?? '');
    if (e) return;
    const t = raw.trim();
    const out = count && (t === INF_LABEL || t.toUpperCase() === 'INF') ? 'INF' : t;
    if (out !== value) onCommit(out);
    setDraft(null);
  };
  const numParams = params.filter((p) => p.type === 'NUMERIC');
  const options = [...(count ? [{ v: 'INF', label: INF_LABEL }] : []), ...numParams.map((p) => ({ v: p.ref, label: `${p.name} (${p.ref})` }))];
  const preview = (() => { const t = (draft ?? value).trim(); if (!t || (count && (t === INF_LABEL || t.toUpperCase() === 'INF'))) return ''; const v = evalExpr(t, scope); return v != null && !/^-?\d+(\.\d+)?$/.test(t) ? `= ${Math.round(v * 100) / 100}` : ''; })();
  return (<>
    <label className={`pv-field${err ? ' bad' : ''}`} title={err || undefined}>
      <span className="pv-field-name">{label}{preview && <em>{preview}</em>}</span>
      <span className="pv-rich">
        <input value={draft ?? show(value)} disabled={disabled} aria-label={label} aria-invalid={!!err}
          onFocus={() => { setDraft(show(value)); }}
          onChange={(e) => { setDraft(e.target.value); setErr(''); }}
          onBlur={() => { if (draft != null) commit(draft); setTimeout(() => setSug(false), 150); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setDraft(null); setErr(''); (e.target as HTMLInputElement).blur(); } }} />
        <span className="pv-rich-tools">
          {unit && <i className="pv-unit">{unit}</i>}
          {options.length > 0 && !disabled && <button type="button" className="pv-rich-btn" aria-label={`${label} 제안`} onMouseDown={(e) => e.preventDefault()} onClick={() => setSug((x) => !x)}>▾</button>}
          {!disabled && <button type="button" className="pv-rich-btn" aria-label={`${label} 수식 편집기`} title="수식 편집기" onClick={() => setFx(true)}>𝑓</button>}
        </span>
        {sug && <ul className="pv-sug" role="listbox">{options.map((o) => (
          <li key={o.v} role="option" aria-selected={value === o.v} onMouseDown={(e) => { e.preventDefault(); setSug(false); setDraft(null); setErr(''); if (o.v !== value) onCommit(o.v); }}>{o.label}</li>
        ))}</ul>}
      </span>
      {err && <small className="pv-err">{err}</small>}
    </label>
    {fx && <FormulaModal value={draft ?? value} scope={scope} params={params} formulas={formulas} onSaveFormula={onSaveFormula}
      onClose={() => setFx(false)} onOk={(v) => { setFx(false); commit(v); }} />}
  </>);
}

/* ───────────────────────── 수식 편집기 ───────────────────────── */

const FN_HELP: Record<string, { text: string; ex: string; tri?: boolean }> = {
  sin: { text: 'A 각도와 a·c 중 한 변의 길이를 알 때, sin(A)*c 를 넣으면 a 의 길이, a/sin(A) 를 넣으면 c 의 길이를 얻습니다.', ex: 'sin(A)*c=a', tri: true },
  cos: { text: 'A 각도와 b·c 중 한 변의 길이를 알 때, cos(A)*c 를 넣으면 b 의 길이, b/cos(A) 를 넣으면 c 의 길이를 얻습니다.', ex: 'cos(A)*c=b', tri: true },
  tan: { text: 'A 각도와 a·b 중 한 변의 길이를 알 때, tan(A)*b 를 넣으면 a 의 길이, a/tan(A) 를 넣으면 b 의 길이를 얻습니다.', ex: 'tan(A)*b=a', tri: true },
  sqrt: { text: 'sqrt 는 제곱근을 구합니다.', ex: 'sqrt(9)=3' },
};

/** 수식 편집기 (쿠지알러 公式编辑器) — 입력란·수식 저장, 함수·매개변수·저장한 수식 탭, 개체 삽입. 각도는 도(°) */
export function FormulaModal({ value, scope, params, formulas, onSaveFormula, onClose, onOk }: {
  value: string; scope: Scope; params: PvParam[]; formulas: PvScheme['formulas'];
  onSaveFormula: (f: { name: string; expr: string }) => void; onClose: () => void; onOk: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [tab, setTab] = useState<'fn' | 'in' | 'fx'>('fn');
  const [pick, setPick] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const v = text.trim() ? evalExpr(text, scope) : null;
  const insert = (k = pick) => {
    if (!k) return;
    const ins = tab === 'fn' ? `${k}()` : k;
    const el = ta.current;
    const a = el?.selectionStart ?? text.length, b = el?.selectionEnd ?? text.length;
    const next = text.slice(0, a) + ins + text.slice(b);
    setText(next);
    requestAnimationFrame(() => { if (!el) return; el.focus(); const pos = a + (tab === 'fn' ? ins.length - 1 : ins.length); el.setSelectionRange(pos, pos); });
  };
  const list = tab === 'fn' ? Object.keys(FN_HELP).map((k) => ({ k, label: k }))
    : tab === 'in' ? params.filter((p) => p.type === 'NUMERIC').map((p) => ({ k: p.ref, label: `${p.name} (${p.ref}) = ${p.value}` }))
      : formulas.map((f) => ({ k: f.expr, label: `${f.name} : ${f.expr}` }));
  const help = tab === 'fn' && pick ? FN_HELP[pick] : null;
  return (
    <PvModal title="수식 편집기" onClose={onClose} width={620} className="pv-fx"
      footer={<><button className="pv-btn" onClick={onClose}>취소</button><button className="pv-btn primary" disabled={v == null && text.trim() !== ''} onClick={() => onOk(text)}>확인</button></>}>
      <div className="pv-fx-edit">
        <textarea ref={ta} value={text} aria-label="수식" onChange={(e) => setText(e.target.value)} placeholder="수식을 넣으세요" />
        <div className="pv-fx-bar">
          <span className={v == null && text.trim() ? 'pv-err' : 'pv-muted'}>{!text.trim() ? '수식을 넣으세요' : v == null ? '수식이 잘못되었습니다' : `계산 결과 ${Math.round(v * 1000) / 1000}`}</span>
          {naming == null
            ? <button className="pv-link" disabled={!text.trim() || v == null} onClick={() => setNaming('')}>수식 저장</button>
            : <span className="pv-fx-name"><input autoFocus value={naming} maxLength={30} placeholder="수식 이름" aria-label="수식 이름" onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && naming.trim()) { onSaveFormula({ name: naming.trim(), expr: text.trim() }); setNaming(null); } if (e.key === 'Escape') setNaming(null); }} />
              <button className="pv-link" disabled={!naming.trim()} onClick={() => { onSaveFormula({ name: naming.trim(), expr: text.trim() }); setNaming(null); }}>저장</button></span>}
        </div>
      </div>
      <div className="pv-fx-lower">
        <div className="pv-fx-list">
          <div className="pv-tabs" role="tablist">
            {([['fn', '함수'], ['in', '매개변수'], ['fx', '수식']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setPick(''); }}>{l}</button>)}
          </div>
          <ul>{list.map((x) => <li key={x.k}><button className={pick === x.k ? 'on' : ''} onClick={() => setPick(x.k)} onDoubleClick={() => { setPick(x.k); insert(x.k); }}>{x.label}</button></li>)}
            {!list.length && <li className="pv-muted">{tab === 'in' ? '숫자 매개변수가 없습니다' : '저장한 수식이 없습니다'}</li>}</ul>
          <button className="pv-btn block" disabled={!pick} onClick={() => insert()}>개체 삽입</button>
        </div>
        <div className="pv-fx-help">
          {help ? <>
            {help.tri && <svg viewBox="0 0 160 100" width="160" height="100" aria-hidden="true"><path d="M10 90 L150 90 L150 10 Z" fill="#eef4ff" stroke="#2f80ed" /><text x="22" y="86" fontSize="11">A</text><text x="80" y="102" fontSize="11" dominantBaseline="text-after-edge">b</text><text x="154" y="54" fontSize="11">a</text><text x="70" y="44" fontSize="11">c</text></svg>}
            <p>{help.text}</p><p className="pv-muted">예: {help.ex}</p>
          </> : <p className="pv-muted">항목을 고르고 ‘개체 삽입’을 누르면 입력란의 커서 자리에 넣습니다. 각도는 도(°) 단위입니다. 수식을 저장해 두면 ‘수식’ 탭에서 다시 쓸 수 있습니다.</p>}
        </div>
      </div>
    </PvModal>
  );
}

/* ───────────────────────── 매개변수 ───────────────────────── */

/** 새 매개변수·매개변수 편집 (쿠지알러 新建参数) — 편집 때 참조명·유형은 잠금 */
export function ParamForm({ init, preset, params, scope, tree, items, onClose, onOk }: {
  init?: PvParam;
  /** 칸에서 ‘＋ 매개변수 추가’ — 유형 고정·현재값 미리 채움 */
  preset?: { type: PvParamType; value?: string; sprites?: PvSprite[] };
  params: PvParam[]; scope: Scope; tree: Folder[]; items: Item[];
  onClose: () => void; onOk: (p: PvParam) => void;
}) {
  const edit = !!init;
  const [name, setName] = useState(init?.name ?? '');
  const [ref, setRef] = useState(init?.ref ?? '');
  const [type, setType] = useState<PvParamType>(init?.type ?? preset?.type ?? 'NUMERIC');
  const [value, setValue] = useState(init?.value ?? preset?.value ?? (preset?.type === 'GAP_MATERIAL' ? '#000000' : preset?.type === 'BOOL' ? 'false' : '0'));
  const [sprites, setSprites] = useState<PvSprite[]>(init?.sprites ?? preset?.sprites ?? []);
  const [pickMat, setPickMat] = useState(false);
  const nameErr = !name.trim() ? '필수 항목입니다' : !/^[가-힣A-Za-z0-9]+$/.test(name.trim()) ? '한글·영문·숫자만 넣을 수 있습니다' : '';
  const refErr = edit ? '' : !ref ? '필수 항목입니다' : !/^[A-Za-z]+$/.test(ref) ? '영문자만 넣을 수 있습니다'
    : RESERVED.some((r) => r.toLowerCase() === ref.toLowerCase()) ? '시스템 예약어입니다' : params.some((p) => p.ref === ref) ? '참조명이 겹칩니다' : '';
  const valErr = type === 'NUMERIC' ? (evalExpr(value, scope) == null ? '수식이 잘못되었습니다' : '') : type === 'MULTI_SPRITE' ? (sprites.length ? '' : '소재를 고르세요') : '';
  const ok = !nameErr && !refErr && !valErr;
  const changeType = (t: PvParamType) => { setType(t); setValue(t === 'NUMERIC' ? '0' : t === 'GAP_MATERIAL' ? '#000000' : t === 'BOOL' ? 'false' : ''); };
  return (
    <PvModal title={edit ? '매개변수 편집' : '새 매개변수'} onClose={onClose} width={380}
      footer={<><button className="pv-btn" onClick={onClose}>취소</button><button className="pv-btn primary" disabled={!ok} onClick={() => onOk({ name: name.trim(), ref: edit ? init!.ref : ref, type, value: type === 'MULTI_SPRITE' ? '' : value, ...(type === 'MULTI_SPRITE' ? { sprites } : {}) })}>확인</button></>}>
      <div className="pv-form">
        <label>이름<span className="pv-count">{name.length}/30</span><input value={name} maxLength={30} autoFocus onChange={(e) => setName(e.target.value)} />{name && nameErr && <small className="pv-err">{nameErr}</small>}</label>
        <label>참조명<span className="pv-count">{ref.length}/10</span><input value={ref} maxLength={10} disabled={edit} onChange={(e) => setRef(e.target.value)} />{ref && refErr && <small className="pv-err">{refErr}</small>}</label>
        <label>값 유형<select value={type} disabled={edit || !!preset} onChange={(e) => changeType(e.target.value as PvParamType)}>{PV_PARAM_TYPES.map((t) => <option key={t.v} value={t.v}>{t.name}</option>)}</select></label>
        <div className="pv-form-row"><span>현재값</span>
          {type === 'NUMERIC' && <input value={value} aria-label="현재값" onChange={(e) => setValue(e.target.value)} />}
          {type === 'GAP_MATERIAL' && <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} aria-label="현재값 색" onChange={(e) => setValue(e.target.value)} />}
          {type === 'BOOL' && <span className="pv-radios"><label><input type="radio" checked={value === 'true'} onChange={() => setValue('true')} />예</label><label><input type="radio" checked={value !== 'true'} onChange={() => setValue('false')} />아니오</label></span>}
          {type === 'MULTI_SPRITE' && <button className="pv-btn" onClick={() => setPickMat(true)}>{sprites.length ? `소재 ${sprites.length}종 · 바꾸기` : '소재 고르기'}</button>}
        </div>
        {type === 'MULTI_SPRITE' && sprites.length > 0 && <ul className="pv-chips">{sprites.map((s) => <li key={s.id}><img src={s.img} alt="" />{s.name}{sprites.length > 1 && <em>비율 {s.weight}</em>}</li>)}</ul>}
        {valErr && type !== 'MULTI_SPRITE' && <small className="pv-err">{valErr}</small>}
      </div>
      {pickMat && <MaterialModal tree={tree} items={items} initial={sprites} multi={sprites.length > 1} allowToggle
        onClose={() => setPickMat(false)} onOk={(list) => { setSprites(list); setPickMat(false); }} />}
    </PvModal>
  );
}

/* ───────────────────────── 소재 선택 (다중 타일 혼합 비율) ───────────────────────── */

const PAGE = 18;
/**
 * 소재 선택 (쿠지알러 选择素材) — 왼쪽 분류 트리, 가운데 검색·격자·쪽 이동, 오른쪽 비율 설정(1~100 정수),
 * 아래 ‘다중 타일 혼합(소재 2종 이상)’. 단일이면 고르면 바로 바뀐다
 */
export function MaterialModal({ tree, items, initial, multi: multi0, allowToggle, onClose, onOk, title = '소재 선택' }: {
  tree: Folder[]; items: Item[]; initial: PvSprite[]; multi: boolean; allowToggle?: boolean; title?: string;
  onClose: () => void; onOk: (list: PvSprite[], multi: boolean) => void;
}) {
  const [multi, setMulti] = useState(multi0);
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<PvSprite[]>(initial);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const ids = folder ? subtreeIds(tree, folder) : null;
    const k = q.trim().toLowerCase();
    return items.filter((i) => itemLW(i) && (!ids || ids.has(i.folder) || (i.extraFolders ?? []).some((f) => ids.has(f))) && (!k || i.name.toLowerCase().includes(k)));
  }, [items, tree, folder, q]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = list.slice(page * PAGE, page * PAGE + PAGE);
  const add = (i: Item) => {
    const s = toSprite(i); if (!s) return;
    if (!multi) { setSel([s]); return; }
    setSel((l) => (l.some((x) => x.id === s.id) ? l : [...l, s]));
  };
  const okEnabled = multi ? sel.length >= 2 : sel.length >= 1;
  const node = (f: Folder, d: number): ReactNode => (
    <li key={f.id}>
      <button className={folder === f.id ? 'on' : ''} style={{ paddingLeft: 6 + d * 12 }} onClick={() => { setFolder(f.id); setPage(0); if (f.children?.length) setOpen((o) => { const n = new Set(o); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }); }}>
        {f.children?.length ? (open.has(f.id) ? '▾ ' : '▸ ') : '　'}{f.name}
      </button>
      {f.children?.length && open.has(f.id) ? <ul>{f.children.filter((c) => !c.hidden).map((c) => node(c, d + 1))}</ul> : null}
    </li>
  );
  return (
    <PvModal title={title} onClose={onClose} width={980} className="pv-mat"
      footer={<>
        {allowToggle && <label className="pv-check"><input type="checkbox" checked={multi} onChange={(e) => { setMulti(e.target.checked); if (!e.target.checked) setSel((l) => l.slice(0, 1)); }} />다중 타일 혼합 (소재 2종 이상)</label>}
        <span className="pv-grow" />
        <button className="pv-btn" onClick={onClose}>취소</button>
        <button className="pv-btn primary" disabled={!okEnabled} onClick={() => onOk(sel.map((s) => ({ ...s, weight: Math.min(100, Math.max(1, Math.round(s.weight || 1))) })), multi)}>확인</button>
      </>}>
      <div className="pv-mat-body">
        <ul className="pv-mat-tree">
          <li><button className={folder == null ? 'on' : ''} onClick={() => { setFolder(null); setPage(0); }}>기업 라이브러리 전체</button></li>
          {tree.filter((f) => !f.hidden).map((f) => node(f, 0))}
        </ul>
        <div className="pv-mat-grid">
          <input className="pv-search" placeholder="검색" value={q} aria-label="소재 검색" onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          <ul>{cur.map((i) => <li key={i.id}><button className={sel.some((s) => s.id === i.id) ? 'on' : ''} title={`${i.name}\n${i.modelSize || i.size}`} onClick={() => add(i)}><img src={i.img} alt="" loading="lazy" /><span>{i.name}</span></button></li>)}
            {!cur.length && <li className="pv-muted pv-empty">조건에 맞는 소재가 없습니다</li>}</ul>
          <div className="pv-pager"><button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="이전 쪽">‹</button><span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="다음 쪽">›</button></div>
        </div>
        <div className="pv-mat-sel">
          <b>{multi ? '비율 설정' : '고른 소재'}{multi && <span className="pv-info" title="입력칸에는 아무 숫자나 넣을 수 있고, 배분 비율은 1~100 의 정수입니다">ⓘ</span>}</b>
          <ul>{sel.map((s) => <li key={s.id}>
            <img src={s.img} alt="" /><span>{s.name}<small>{s.w}×{s.h}mm</small></span>
            {multi && <input type="number" min={1} max={100} step={1} value={s.weight} aria-label={`${s.name} 비율`} onChange={(e) => setSel((l) => l.map((x) => (x.id === s.id ? { ...x, weight: Number(e.target.value) } : x)))} />}
            <button className="pv-x" aria-label={`${s.name} 빼기`} onClick={() => setSel((l) => l.filter((x) => x.id !== s.id))}>×</button>
          </li>)}{!sel.length && <li className="pv-muted">고른 소재가 없습니다 — 왼쪽에서 고르세요</li>}</ul>
        </div>
      </div>
    </PvModal>
  );
}

/* ───────────────────────── 저장 · 기록 ───────────────────────── */

/** 방안 저장 (쿠지알러 铺法保存) — 이름(128자)·소속 분류(파라메트릭 방안 폴더) */
export function SaveModal({ name: n0, folder: f0, tree, onClose, onOk }: { name: string; folder: string; tree: Folder[]; onClose: () => void; onOk: (name: string, folder: string) => void }) {
  const [name, setName] = useState(n0);
  const [folder, setFolder] = useState(f0);
  const opts: { id: string; label: string }[] = [];
  const walk = (fs: Folder[], d: number) => fs.forEach((f) => { opts.push({ id: f.id, label: `${'　'.repeat(d)}${f.name}` }); if (f.children) walk(f.children, d + 1); });
  walk(tree, 0);
  return (
    <PvModal title="방안 저장" onClose={onClose} width={420}
      footer={<><button className="pv-btn" onClick={onClose}>취소</button><button className="pv-btn primary" disabled={!name.trim()} onClick={() => onOk(name.trim(), folder)}>저장</button></>}>
      <div className="pv-form">
        <label>방안 이름<input value={name} maxLength={128} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onOk(name.trim(), folder); }} /></label>
        <label>소속 분류<select value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">파라메트릭 방안 (미분류)</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select></label>
        <p className="pv-muted">컨텐츠 라이브러리 ‘타일·바닥 › 파라메트릭 방안’에 들어갑니다 — 컨텐츠 라이브러리 상단 ‘저장’으로 영구 반영</p>
      </div>
    </PvModal>
  );
}

export type PvVersion = { at: number; label: string; scheme: PvScheme };
/** 기록 버전 (쿠지알러 历史版本) — 저장할 때마다·자동 백업 */
export function HistoryModal({ versions, onOpen, onClose }: { versions: PvVersion[]; onOpen: (v: PvVersion) => void; onClose: () => void }) {
  const fmt = (t: number) => new Date(t).toLocaleString('ko-KR', { hour12: false });
  return (
    <PvModal title="기록 버전" onClose={onClose} width={460}>
      {versions.length ? <ul className="pv-hist">{versions.map((v, i) => <li key={`${v.at}-${i}`}><span>{fmt(v.at)}</span><em>{v.label}</em><button className="pv-link" onClick={() => onOpen(v)}>열기</button></li>)}</ul>
        : <p className="pv-muted">기록 버전이 없습니다</p>}
    </PvModal>
  );
}

/* ───────────────────────── 모양 도식 · 사용자 정의 모양 ───────────────────────── */

/** 모양 도식 — 실제 외곽(가공 매개변수 계산값)과 외곽 사각형 */
export function ShapeDiagram({ machine, size, scope }: { machine: PvMachine; size: [number, number]; scope: Scope }) {
  const pts = clipOutline(machine, size, scope);
  if (pts.length < 3) return null;
  const b = bounds(pts), w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  const W = 200, H = 120, k = Math.min((W - 40) / w, (H - 30) / h);
  const ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  const P = ([x, y]: V2) => `${(ox + (x - b.x0) * k).toFixed(1)},${(H - oy - (y - b.y0) * k).toFixed(1)}`;
  return (
    <svg className="pv-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="모양 도식">
      <rect x={ox - 4} y={oy - 4} width={w * k + 8} height={h * k + 8} fill="none" stroke="#7fc8a9" strokeDasharray="3 2" />
      <polygon points={pts.map(P).join(' ')} fill="#f4f6f8" stroke="#555" />
      <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="10" fill="#888">{Math.round(w)}</text>
      <text x={6} y={H / 2} fontSize="10" fill="#888">{Math.round(h)}</text>
    </svg>
  );
}

/** 사용자 정의 모양 편집 — 윤곽 편집기(점 추가·삭제·끌기·직각 스냅·원호·둥근 모서리) 재사용, 왼쪽 아래 (0,0) mm */
export function CustomShapeEditor({ init, onDone, onClose }: { init?: [number, number][]; onDone: (pts: [number, number][]) => void; onClose: () => void }) {
  const [path] = useState(() => sectionStartPath(init?.length ? { points: init } : { points: [[0, 0], [600, 0], [600, 600], [0, 600]] }));
  const ctx = useMemo(() => sectionContext(path), [path]);
  const check = (v: string) => { try { return validateShape(sectionShape(v).points); } catch (e) { return (e as Error).message; } };
  return (
    <ProfileEditor ev={ctx.ev} node={ctx.node} param="section" kind="line" closedDefault section title="사용자 정의 모양"
      sectionHint="타일 모양(mm) — 왼쪽 아래가 (0,0). 점을 찍거나 끌어서 외형을 만들고, 원호·둥근 모서리로 다듬습니다 · 3D 미리보기는 두께 10mm"
      sectionDepth={10}
      onValidate={check}
      onSave={(v) => onDone(sectionShape(v).points)} onClose={onClose} />
  );
}

/* ───────────────────────── 표기 미리보기 이미지 ───────────────────────── */

type Anno =
  | { k: 'dim'; a: V2; b: V2 }
  | { k: 'text'; p: V2; text: string }
  | { k: 'arrow'; a: V2; b: V2 }
  | { k: 'leader'; a: V2; b: V2; text: string };
type AnnoTool = 'dim' | 'text' | 'arrow' | 'leader';
const ANNO_TOOLS: { k: AnnoTool; label: string; hint: string }[] = [
  { k: 'dim', label: '치수 표기', hint: '두 점을 차례로 누르면 길이(mm)를 표기합니다' },
  { k: 'text', label: '글자 표기', hint: '누른 곳에 글자를 넣습니다' },
  { k: 'arrow', label: '지시 표기', hint: '시작점과 끝점을 누르면 화살표를 그립니다' },
  { k: 'leader', label: '인출선 표기', hint: '가리킬 점과 글자 자리를 누른 뒤 글자를 넣습니다' },
];
const VW = 760, VH = 480;

function drawAnnos(g: CanvasRenderingContext2D, list: Anno[], mmPerPx: number) {
  g.save();
  g.lineWidth = 1.6; g.strokeStyle = '#1f5fbf'; g.fillStyle = '#1f5fbf'; g.font = '14px sans-serif'; g.textBaseline = 'bottom';
  const halo = (t: string, x: number, y: number, align: CanvasTextAlign = 'left') => { g.textAlign = align; g.save(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeText(t, x, y); g.restore(); g.fillText(t, x, y); };
  const head = (a: V2, b: V2) => { const t = Math.atan2(b[1] - a[1], b[0] - a[0]); g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 10 * Math.cos(t - 0.35), b[1] - 10 * Math.sin(t - 0.35)); g.lineTo(b[0] - 10 * Math.cos(t + 0.35), b[1] - 10 * Math.sin(t + 0.35)); g.closePath(); g.fill(); };
  for (const x of list) {
    if (x.k === 'dim') {
      const [a, b] = [x.a, x.b], t = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(t) * 6, ny = Math.cos(t) * 6;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.moveTo(a[0] - nx, a[1] - ny); g.lineTo(a[0] + nx, a[1] + ny); g.moveTo(b[0] - nx, b[1] - ny); g.lineTo(b[0] + nx, b[1] + ny); g.stroke();
      const mm = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * mmPerPx);
      g.save(); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); g.rotate(t > Math.PI / 2 || t < -Math.PI / 2 ? t + Math.PI : t); halo(`${mm}`, 0, -4, 'center'); g.restore();
    } else if (x.k === 'text') halo(x.text, x.p[0], x.p[1]);
    else if (x.k === 'arrow') { g.beginPath(); g.moveTo(x.a[0], x.a[1]); g.lineTo(x.b[0], x.b[1]); g.stroke(); head(x.a, x.b); }
    else {
      const w = g.measureText(x.text).width + 8, dir = x.b[0] >= x.a[0] ? 1 : -1;
      g.beginPath(); g.arc(x.a[0], x.a[1], 3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(x.a[0], x.a[1]); g.lineTo(x.b[0], x.b[1]); g.lineTo(x.b[0] + w * dir, x.b[1]); g.stroke();
      halo(x.text, dir > 0 ? x.b[0] + 4 : x.b[0] - 4, x.b[1] - 3, dir > 0 ? 'left' : 'right');
    }
  }
  g.restore();
}

/**
 * 표기 미리보기 이미지 편집 (쿠지알러 编辑预览图) — 1단계 범위(확대 0.2~4, 끌어 옮기기) → ‘밑그림 생성’ →
 * 2단계 치수·글자·지시·인출선 표기 → ‘완료’로 이미지. 2단계에서 닫으면 확인
 */
export function LabelEditor({ scheme, images, onClose, onDone }: { scheme: PvScheme; images: ImgCache; onClose: () => void; onDone: (dataUrl: string) => void }) {
  const L = useMemo(() => layoutScheme(scheme), [scheme]);
  const base = useMemo(() => fitView(L.canvas, VW, VH, 20), [L.canvas]);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<V2>([base.cx, base.cy]);
  const [shot, setShot] = useState<{ url: string; mmPerPx: number } | null>(null);
  const [annos, setAnnos] = useState<Anno[]>([]);
  const [tool, setTool] = useState<AnnoTool>('dim');
  const [pend, setPend] = useState<V2 | null>(null);
  const [typing, setTyping] = useState<{ p: V2; b?: V2; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const drag = useRef<{ x: number; y: number; c: V2 } | null>(null);
  const view: View = { cx: center[0], cy: center[1], scale: base.scale * zoom };
  const drawBase = (c: HTMLCanvasElement | null) => {
    if (!c || shot) return;
    const g = c.getContext('2d'); if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = VW * dpr; c.height = VH * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScheme(g, VW, VH, scheme, L, view, { images, selIds: [], showSel: false, grid: false, guides: false });
  };
  const drawTop = (c: HTMLCanvasElement | null) => {
    if (!c || !shot) return;
    const g = c.getContext('2d'); if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = VW * dpr; c.height = VH * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAnnos(g, annos, shot.mmPerPx);
    if (pend) { g.fillStyle = '#1f5fbf'; g.beginPath(); g.arc(pend[0], pend[1], 3, 0, Math.PI * 2); g.fill(); }
  };
  const makeShot = () => {
    const c = document.createElement('canvas'); c.width = VW * 2; c.height = VH * 2;
    const g = c.getContext('2d')!; g.setTransform(2, 0, 0, 2, 0, 0);
    const own: ImgCache = new Map();
    for (const [k, e] of images) if (e !== 'loading' && e !== 'error') own.set(k, { img: e.img, pattern: null, avg: e.avg });
    drawScheme(g, VW, VH, scheme, L, view, { images: own, selIds: [], showSel: false, grid: false, guides: false });
    let url: string;
    try { url = c.toDataURL('image/png'); } catch {
      const c2 = document.createElement('canvas'); c2.width = VW * 2; c2.height = VH * 2;
      const g2 = c2.getContext('2d')!; g2.setTransform(2, 0, 0, 2, 0, 0);
      drawScheme(g2, VW, VH, scheme, L, view, { images: new Map(), selIds: [], showSel: false, grid: false, guides: false });
      url = c2.toDataURL('image/png');
    }
    setShot({ url, mmPerPx: 1 / view.scale });
    setAnnos([]);
  };
  const finish = async () => {
    if (!shot) return;
    const img = new Image(); img.src = shot.url; await img.decode();
    // 상품 데이터(localStorage)에 들어가므로 화면 크기(1배) JPEG 로 줄인다
    const c = document.createElement('canvas'); c.width = VW; c.height = VH;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0, VW, VH);
    drawAnnos(g, annos, shot.mmPerPx);
    onDone(c.toDataURL('image/jpeg', 0.85));
  };
  const at = (e: RPointerEvent<HTMLElement>): V2 => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onDraw = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // 누르는 순간 포커스가 캔버스 밖으로 가 방금 연 글자 입력칸이 닫히지 않게
    if (typing) return;
    const p = at(e);
    if (tool === 'text') { setTyping({ p, text: '' }); return; }
    if (!pend) { setPend(p); return; }
    if (tool === 'dim') setAnnos((l) => [...l, { k: 'dim', a: pend, b: p }]);
    else if (tool === 'arrow') setAnnos((l) => [...l, { k: 'arrow', a: pend, b: p }]);
    else setTyping({ p: pend, b: p, text: '' });
    setPend(null);
  };
  const doneTyping = () => {
    if (!typing) return;
    const t = typing.text.trim();
    if (t) setAnnos((l) => [...l, typing.b ? { k: 'leader', a: typing.p, b: typing.b, text: t } : { k: 'text', p: typing.p, text: t }]);
    setTyping(null);
  };
  const close = () => { if (shot) setConfirmClose(true); else onClose(); };
  return (
    <PvModal title="미리보기 편집" onClose={close} width={VW + 40} className="pv-label"
      footer={shot
        ? <><span className="pv-muted">{ANNO_TOOLS.find((t) => t.k === tool)?.hint}</span><span className="pv-grow" />
          <button className="pv-btn" disabled={!annos.length} onClick={() => setAnnos((l) => l.slice(0, -1))}>되돌리기</button>
          <button className="pv-btn" onClick={() => { setShot(null); setAnnos([]); setPend(null); }}>이전 단계</button>
          <button className="pv-btn primary" onClick={() => void finish()}>완료</button></>
        : <><button className="pv-btn primary" onClick={makeShot}>밑그림 생성</button><span className="pv-grow" />
          <div className="pv-zoom">
            <button aria-label="처음 보기" onClick={() => { setZoom(1); setCenter([base.cx, base.cy]); }}>⟲</button>
            <button aria-label="축소" onClick={() => setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 10) / 10))}>−</button>
            <input type="range" min={0.2} max={4} step={0.1} value={zoom} aria-label="확대 비율" onChange={(e) => setZoom(Number(e.target.value))} />
            <button aria-label="확대" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 10) / 10))}>＋</button>
          </div></>}>
      {shot && <div className="pv-anno-bar" role="toolbar" aria-label="표기 도구">{ANNO_TOOLS.map((t) => <button key={t.k} className={tool === t.k ? 'on' : ''} aria-pressed={tool === t.k} onClick={() => { setTool(t.k); setPend(null); }}>{t.label}</button>)}</div>}
      <div className="pv-label-stage" style={{ width: VW, height: VH }}>
        {!shot && <canvas ref={drawBase} style={{ width: VW, height: VH, cursor: 'grab' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, c: center }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; setCenter([d.c[0] - (e.clientX - d.x) / view.scale, d.c[1] + (e.clientY - d.y) / view.scale]); }}
          onPointerUp={() => { drag.current = null; }} aria-label="범위 고르기" />}
        {shot && <>
          <img src={shot.url} alt="밑그림" style={{ width: VW, height: VH }} />
          <canvas ref={drawTop} style={{ width: VW, height: VH, cursor: 'crosshair' }} onPointerDown={onDraw} aria-label="표기 그리기" />
          {typing && <input className="pv-anno-input" autoFocus style={{ left: (typing.b ?? typing.p)[0], top: (typing.b ?? typing.p)[1] - 28 }} value={typing.text} placeholder="글자 입력 후 Enter"
            onChange={(e) => setTyping({ ...typing, text: e.target.value })} onBlur={doneTyping} onKeyDown={(e) => { if (e.key === 'Enter') doneTyping(); if (e.key === 'Escape') setTyping(null); }} />}
        </>}
      </div>
      {confirmClose && <PvModal title="미리보기 편집 끝내기" onClose={() => setConfirmClose(false)} width={360}
        footer={<><button className="pv-btn" onClick={() => setConfirmClose(false)}>취소</button><button className="pv-btn primary" onClick={onClose}>확인</button></>}>
        <p>미리보기 편집을 끝낼까요? 지금 편집한 내용은 저장되지 않습니다.</p>
      </PvModal>}
    </PvModal>
  );
}
