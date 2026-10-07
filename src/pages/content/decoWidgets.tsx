import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type Folder, type Item } from '../../data/contentLibrary';
import { folderPathName, itemLW, liveSizeMsg, subtreeIds } from './decoUtil';

/**
 * 쿠지알러 꾸밈 소재 업로드 화면(혼합 재질·타일 등 decoration-cms)의 공통 부품.
 * 왼쪽 업로드 상자 + 오른쪽 입력 양식 + 아래 ‘계속 올리기’·‘완료’ 구성을 그대로 옮겼다.
 */

/** 바깥을 누르거나 Esc 면 닫기 — Esc 는 여기서 멈춰 업로드 화면 닫기(DecoShell)까지 가지 않는다 */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) closeRef.current(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return ref;
}

/* ───────────────────────── 화면 틀 ───────────────────────── */

/** 업로드 화면 틀 — × 또는 Esc 는 ‘업로드를 취소할까요?’ 확인 뒤 닫는다 (쿠지알러 确定取消上传吗?) */
export function DecoShell({ crumbs, onCancel, children }: { crumbs: string[]; onCancel: () => void; children: ReactNode }) {
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.cl-up-alert, .confirm-modal, .cl-st-dlg')) cancelRef.current(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="cl-cp" role="dialog" aria-modal="true" aria-label={crumbs.join(' › ')}>
      <header className="cl-cp-head">
        <nav className="cl-cp-crumb" aria-label="위치">{crumbs.map((c, i) => <span key={i} className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>)}</nav>
        <button className="cl-x" aria-label="닫기" onClick={onCancel}>×</button>
      </header>
      <div className="cl-cp-body"><div className="cl-up">{children}</div></div>
    </div>
  );
}

/** 제출 검사 알림 — 쿠지알러 경고창(alertWin)처럼 문구 + 확인 */
export function UpAlert({ msg, onClose }: { msg: string; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal confirm-modal cl-up-alert" role="alertdialog" aria-modal="true" aria-label="알림" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <p className="cl-up-alert-msg"><span aria-hidden="true">!</span>{msg}</p>
        <div className="modal-actions"><button ref={ref} className="btn-primary" onClick={onClose}>확인</button></div>
      </div>
    </div>
  );
}

/* ───────────────────────── 양식 줄 ───────────────────────── */

/** ? 표시 — 올리거나 초점을 주면 설명 */
export function Tip({ lines }: { lines: string[] }) {
  return (
    <span className="cl-tip" tabIndex={0} aria-label={lines.join(' ')}>?
      <span className="cl-tip-pop" aria-hidden="true">{lines.map((l, i) => <span key={i}>{l}</span>)}</span>
    </span>
  );
}

/** 입력 줄 — 왼쪽 이름(필수 * · ? 설명), 오른쪽 입력, 아래 빨간 오류 문구 */
export function UpRow({ label, req, tip, err, top, children }: { label: string; req?: boolean; tip?: string[]; err?: string; top?: boolean; children: ReactNode }) {
  return (
    <li className={`cl-up-row${top ? ' top' : ''}`}>
      <span className="cl-up-label">{req && <i className="req">*</i>}{label}{tip && <Tip lines={tip} />}</span>
      <div className="cl-up-ctl">{children}{err && <p className="cl-up-err" role="alert">{err}</p>}</div>
    </li>
  );
}

/**
 * 길이 ⇄ 폭 (mm). live(기본) = 입력할 때마다 10–5000 검사해 아래에 문구, 칸에 들어가면 문구를 지운다 (혼합 재질 등).
 * live=false 면 검사 없이 입력만 (타일 상품처럼 저장할 때 검사하는 화면). noSwap 이면 ⇄ 교환 단추를 숨긴다(비정형 상품의 CAD 형상).
 */
export function SizePair({ l, w, onChange, labels = ['길이', '폭'], live = true, disabled, noSwap }: { l: string; w: string; onChange: (l: string, w: string) => void; labels?: [string, string]; live?: boolean; disabled?: boolean; noSwap?: boolean }) {
  const [quiet, setQuiet] = useState(true);
  const msg = quiet || !live ? '' : liveSizeMsg([l, w]);
  const set = (a: string, b: string) => { setQuiet(false); onChange(a, b); };
  return (
    <div className="cl-size-wrap">
      <div className="cl-size">
        <label><span>{labels[0]}</span><input className="inline-input" inputMode="decimal" value={l} disabled={disabled} aria-label={`${labels[0]} mm`} onFocus={() => setQuiet(true)} onChange={(e) => set(e.target.value, w)} onBlur={() => setQuiet(false)} />mm</label>
        {!noSwap && <button type="button" className="cl-size-x" title="교환" disabled={disabled} aria-label={`${labels[0]}·${labels[1]} 교환`} onClick={() => set(w, l)}>⇄</button>}
        <label><span>{labels[1]}</span><input className="inline-input" inputMode="decimal" value={w} disabled={disabled} aria-label={`${labels[1]} mm`} onFocus={() => setQuiet(true)} onChange={(e) => set(l, e.target.value)} onBlur={() => setQuiet(false)} />mm</label>
      </div>
      {msg && <p className="cl-up-err" role="alert">{msg}</p>}
    </div>
  );
}

export type CascOption = { value: string; label: string; title?: string; img?: string; children?: CascOption[] };

/**
 * 단계식 고르기 — 마우스를 올리면(expand='click' 이면 누르면) 다음 단계가 열리고, 끝 단계를 누르면 고른다 (쿠지알러 muya Cascader).
 * 렌더 분류는 올리면 열리고(expandTrigger hover), 실시간 재질 분류는 눌러야 열리며 재질마다 재질 공 아이콘이 붙는다.
 * 값은 단계별 value 배열, 표시는 ‘상위/하위’.
 */
export function HoverCascader({ options, value, onChange, placeholder = '선택하세요', label, disabled, expand = 'hover' }: { options: CascOption[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string; disabled?: boolean; expand?: 'hover' | 'click' }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string[]>([]);
  const ref = useOutside(open, () => setOpen(false));
  const chain: CascOption[] = [];
  let list = options;
  for (const v of value) { const o = list.find((x) => x.value === v); if (!o) break; chain.push(o); list = o.children ?? []; }
  const cols: CascOption[][] = [options];
  let cur = options;
  for (const v of hover) { const o = cur.find((x) => x.value === v); if (!o?.children?.length) break; cols.push(o.children); cur = o.children; }
  return (
    <div className="cl-ks" ref={ref}>
      <button type="button" className={`cl-ks-btn${chain.length ? '' : ' ph'}`} disabled={disabled} aria-haspopup="tree" aria-expanded={open} aria-label={label}
        onClick={() => { setOpen((o) => !o); setHover(value.slice(0, -1)); }}>
        <span>{chain.length ? chain.map((c) => c.label).join('/') : placeholder}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="cl-hc-pop" role="tree" aria-label={label}>
          {cols.map((col, d) => (
            <ul key={d}>
              {col.map((o) => {
                const on = (hover[d] ?? value[d]) === o.value;
                return (
                  <li key={o.value}>
                    <button type="button" className={on ? 'on' : ''} title={o.title ?? o.label}
                      onMouseEnter={expand === 'hover' ? () => setHover([...hover.slice(0, d), o.value]) : undefined}
                      onClick={() => { const path = [...hover.slice(0, d), o.value]; if (o.children?.length) setHover(path); else { onChange(path); setOpen(false); } }}>
                      {o.img && <img className="cl-hc-img" src={o.img} alt="" loading="lazy" />}<span>{o.label}</span>{o.children?.length ? <em aria-hidden="true">›</em> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}

export type KOption = { value: string; label: string; title?: string };

/** 드롭다운 한 개 고르기 (쿠지알러 k-select) */
export function KSelect({ value, options, onChange, placeholder = '선택하세요', label }: { value: string; options: KOption[]; onChange: (v: string) => void; placeholder?: string; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const cur = options.find((o) => o.value === value);
  return (
    <div className="cl-ks" ref={ref}>
      <button type="button" className={`cl-ks-btn${cur ? '' : ' ph'}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <span>{cur?.label ?? placeholder}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="cl-ks-pop" role="listbox" aria-label={label}>
          {options.map((o) => <li key={o.value}><button type="button" role="option" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * 소속 분류 — 소재 라이브러리 폴더 트리를 체크박스로 여러 개 고른다 (쿠지알러 所属类目).
 * 루트 줄의 체크박스는 눌러도 변화가 없고(쿠지알러와 같음), ‘미분류’는 목록에 없다(아무것도 안 고르면 미분류).
 * 고른 폴더는 ‘상위/하위’ 경로를 ‘、’로 이어 보여 준다.
 */
export function FolderChecks({ tree, rootLabel, value, onChange, placeholder, label = '소속 분류' }: { tree: Folder[]; rootLabel: string; value: string[]; onChange: (ids: string[]) => void; placeholder: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<Set<string>>(() => new Set(['__root']));
  const ref = useOutside(open, () => setOpen(false));
  const text = value.map((id) => folderPathName(tree, id)).filter(Boolean).join('、');
  const flip = (id: string) => setExp((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const node = (f: Folder, depth: number): ReactNode => {
    const kids = f.children ?? [];
    const on = value.includes(f.id);
    return (
      <li key={f.id}>
        <div className={`cl-fc-row${on ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
          <input type="checkbox" checked={on} aria-label={f.name} onChange={() => onChange(on ? value.filter((v) => v !== f.id) : [...value, f.id])} />
          {kids.length ? <button type="button" className={`cl-fc-arrow${exp.has(f.id) ? ' on' : ''}`} aria-label={`${f.name} ${exp.has(f.id) ? '접기' : '펼치기'}`} onClick={() => flip(f.id)}>▸</button> : <span className="cl-fc-arrow" />}
          <span className="cl-fc-name" title={f.name}>📁 {f.name}</span>
        </div>
        {kids.length > 0 && exp.has(f.id) && <ul>{kids.map((k) => node(k, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <div className="cl-ks" ref={ref}>
      <button type="button" className={`cl-ks-btn${text ? '' : ' ph-strong'}`} aria-haspopup="tree" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <span>{text || placeholder}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="cl-ks-pop cl-fc" role="tree" aria-label={rootLabel}>
          <div className="cl-fc-row root">
            <input type="checkbox" checked={false} readOnly aria-label={rootLabel} />
            <button type="button" className={`cl-fc-arrow${exp.has('__root') ? ' on' : ''}`} aria-label={`${rootLabel} ${exp.has('__root') ? '접기' : '펼치기'}`} onClick={() => flip('__root')}>▸</button>
            <span className="cl-fc-name">{rootLabel}</span>
          </div>
          {exp.has('__root') && <ul>{tree.filter((f) => f.name !== '미분류').map((f) => node(f, 1))}</ul>}
        </div>
      )}
    </div>
  );
}

/**
 * 단계식 분류 고르기 (쿠지알러 RenderCatSelectDropdown) — 위에 단계 탭, 아래 3열 선택지.
 * 하위가 있는 분류를 고르면 다음 단계로 넘어가고, 끝 분류를 고르면 닫힌다. 값은 ‘상위/하위’ 경로.
 */
export function FolderCascader({ tree, path, onChange, placeholder = '분류를 고르세요' }: { tree: Folder[]; path: string[]; onChange: (p: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(0);
  const ref = useOutside(open, () => setOpen(false));
  const chain: Folder[] = [];
  let list = tree;
  for (const id of path) { const f = list.find((x) => x.id === id); if (!f) break; chain.push(f); list = f.children ?? []; }
  const optionsAt = (lv: number) => (lv === 0 ? tree : chain[lv - 1]?.children ?? []);
  const tabs = chain.length && (chain[chain.length - 1].children ?? []).length ? chain.length + 1 : Math.max(1, chain.length);
  const lv = Math.min(level, tabs - 1);
  const pick = (f: Folder) => {
    const next = [...chain.slice(0, lv).map((c) => c.id), f.id];
    onChange(next);
    if ((f.children ?? []).length) setLevel(lv + 1); else setOpen(false);
  };
  return (
    <div className="cl-ks cl-cc" ref={ref}>
      <button type="button" className={`cl-ks-btn${chain.length ? '' : ' ph-strong'}`} aria-expanded={open} aria-label="재질 분류 거르기" onClick={() => { setOpen((o) => !o); setLevel(Math.max(0, chain.length - 1)); }}>
        <span>{chain.length ? chain.map((c) => c.name).join('/') : placeholder}</span><span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="cl-ks-pop cl-cc-pop">
          <div className="cl-cc-tabs" role="tablist">
            {Array.from({ length: tabs }, (_, i) => <button type="button" key={i} role="tab" aria-selected={i === lv} className={i === lv ? 'on' : ''} title={chain[i]?.name} onClick={() => setLevel(i)}>{chain[i]?.name ?? '선택하세요'} ▾</button>)}
          </div>
          <ul className="cl-cc-opts">
            {optionsAt(lv).map((f) => <li key={f.id}><button type="button" className={chain[lv]?.id === f.id ? 'on' : ''} title={f.name} onClick={() => pick(f)}>{f.name}</button></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 쪽 번호 — 처음·끝과 현재 앞뒤만 보이고 사이는 … */
function pageList(page: number, pages: number): (number | '…')[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) { if (p - prev > 1) out.push('…'); out.push(p); prev = p; }
  return out;
}

/** 쪽 넘김 ‹ 1 2 … N › + 쪽 이동 */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const [jump, setJump] = useState('');
  const go = () => { const n = parseInt(jump, 10); if (n >= 1 && n <= pages) onPage(n); setJump(''); };
  return (
    <nav className="cl-pager" aria-label="쪽 넘김">
      <button type="button" disabled={page <= 1} aria-label="이전 쪽" onClick={() => onPage(page - 1)}>‹</button>
      {pageList(page, pages).map((p, i) => (p === '…' ? <span key={`e${i}`}>…</span> : <button type="button" key={p} className={p === page ? 'on' : ''} aria-current={p === page ? 'page' : undefined} onClick={() => onPage(p)}>{p}</button>))}
      <button type="button" disabled={page >= pages} aria-label="다음 쪽" onClick={() => onPage(page + 1)}>›</button>
      <input className="inline-input" value={jump} aria-label="이동할 쪽" placeholder="쪽" onChange={(e) => setJump(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
      <button type="button" onClick={go}>이동</button>
    </nav>
  );
}

/** 줄눈 색 — 견본을 누르면 색 고르기(색상 판·#HEX·R G B) */
export function GapColor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const hex = value.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  const setRgb = (k: number, v: string) => { const n = Math.max(0, Math.min(255, parseInt(v, 10) || 0)); const c = [...rgb]; c[k] = n; onChange(`#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`); };
  return (
    <div className="cl-gc" ref={ref}>
      <button type="button" className="cl-gc-sw" aria-label="줄눈 색" aria-expanded={open} onClick={() => setOpen((o) => !o)}><span style={{ background: value }} /><i aria-hidden="true">▾</i></button>
      {open && (
        <div className="cl-gc-pop" role="dialog" aria-label="줄눈 색 고르기">
          <input type="color" value={value} aria-label="색상" onChange={(e) => onChange(e.target.value)} />
          <div className="cl-gc-row">
            <label>#<input className="inline-input" value={hex} maxLength={6} aria-label="HEX" onChange={(e) => { const v = e.target.value.replace(/[^0-9a-fA-F]/g, ''); if (v.length === 6) onChange(`#${v.toLowerCase()}`); }} /></label>
            {['R', 'G', 'B'].map((k, i) => <label key={k}>{k}:<input className="inline-input" value={rgb[i]} maxLength={3} aria-label={k} onChange={(e) => setRgb(i, e.target.value)} /></label>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 재질 고르기 ───────────────────────── */

export type MatPick = { id: string; name: string; img: string };

const sizeTip = (i: Item) => { const lw = itemLW(i); return lw ? `${i.name} 크기: ${lw[0]} x ${lw[1]}` : i.name; };

/**
 * 재질 한 줄 (쿠지알러 TileSelectCollapse) — 썸네일·이름·영역·‘편집’. 편집을 누르면 줄 아래로 펼쳐
 * 검색(이름·코드)·단계식 분류·4열 썸네일(쪽마다 20개)에서 고르고 ‘확인’으로 접는다. 한 번에 한 줄만 펼친다.
 */
export function MaterialPick({ area, value, open, onOpen, onApply, items, tree, noCat, placeholder = '재질을 고르세요' }: {
  area: string; value: MatPick | null; open: boolean; onOpen: () => void; onApply: (v: MatPick) => void; items: Item[]; tree: Folder[];
  /** 분류 거르기 없이 검색·목록만 (보더 패턴의 타일 고르기) */
  noCat?: boolean; placeholder?: string;
}) {
  if (!open) {
    return (
      <div className="cl-mp">
        <div className="cl-mp-head">
          {value?.img ? <img src={value.img} alt="" /> : <span className="cl-mp-noimg" />}
          <div className="cl-mp-name"><b className={value ? '' : 'ph'}>{value?.name ?? placeholder}</b><small>{area}</small></div>
          <button type="button" className="cl-mp-edit" onClick={onOpen}>✎ 편집</button>
        </div>
      </div>
    );
  }
  return <MaterialPicker area={area} value={value} items={items} tree={tree} onApply={onApply} noCat={noCat} placeholder={placeholder} />;
}

const PER_PAGE = 20;

function MaterialPicker({ area, value, items, tree, onApply, noCat, placeholder }: { area: string; value: MatPick | null; items: Item[]; tree: Folder[]; onApply: (v: MatPick) => void; noCat?: boolean; placeholder?: string }) {
  const [pending, setPending] = useState<MatPick | null>(value);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const scope = cat.length ? subtreeIds(tree, cat[cat.length - 1]) : null;
  const ql = q.trim().toLowerCase();
  const list = items.filter((i) => (!scope || scope.has(i.folder) || (i.extraFolders ?? []).some((f) => scope.has(f)))
    && (!ql || i.name.toLowerCase().includes(ql) || i.code.toLowerCase().includes(ql) || i.id.toLowerCase().includes(ql)));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const shown = list.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);
  return (
    <div className="cl-mp open">
      <div className="cl-mp-head">
        {pending?.img ? <img src={pending.img} alt="" /> : <span className="cl-mp-noimg" />}
        <div className="cl-mp-name"><b className={pending ? '' : 'ph'}>{pending?.name ?? placeholder}</b><small>{area}</small></div>
        <button type="button" className="btn-primary" disabled={!pending} onClick={() => pending && onApply(pending)}>확인</button>
      </div>
      <div className="cl-mp-body">
        <label className="search inset cl-mp-q"><input type="search" placeholder="기본 시공 재질 이름 또는 코드 검색" aria-label="재질 이름 또는 코드 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        {!noCat && <FolderCascader tree={tree} path={cat} onChange={(p) => { setCat(p); setPage(1); }} />}
        {shown.length ? (
          <ul className="cl-mp-grid" role="listbox" aria-label={`${area} 재질`}>
            {shown.map((i) => (
              <li key={i.id}>
                <button type="button" role="option" aria-selected={pending?.id === i.id} className={pending?.id === i.id ? 'on' : ''} data-tip={sizeTip(i)} aria-label={sizeTip(i)}
                  onClick={() => setPending({ id: i.id, name: i.name, img: i.img })}>
                  {i.img ? <img src={i.img} alt="" loading="lazy" /> : <span className="cl-mp-noimg" />}
                  {pending?.id === i.id && <i className="cl-mp-check" aria-hidden="true">✓</i>}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="cl-muted cl-mp-empty">{noCat ? '검색 결과가 없습니다!' : '재질이 없습니다'}</p>}
        {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
      </div>
    </div>
  );
}

/* ───────────────────────── 왼쪽 업로드 상자 ───────────────────────── */

export type UpPreview = { src: string; w: number; h: number };

/**
 * 파일 하나 올리는 상자 (쿠지알러 ImgUploader) — 빈 상태: 안내·조건(? 설명)·‘파일 추가’.
 * 올린 뒤: 미리보기를 입력한 길이×폭 비율로 늘여 보여 주고(크기를 안 넣었으면 원래 비율),
 * 마우스를 올리면 ‘다시 올리기’와 현재 이미지 크기. 상자 어디를 눌러도 파일을 다시 고른다.
 */
export function UpBox({ title, desc, tip, accept, onFile, preview, aspect, busy, err }: {
  title: string; desc: string; tip?: string[]; accept: string; onFile: (f: File) => void;
  preview: UpPreview | null; aspect: number | null; busy?: string; err?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = () => ref.current?.click();
  const ar = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : preview ? preview.w / preview.h : 1;
  const BOX = 340;
  const pw = ar >= 1 ? BOX : Math.max(1, BOX * ar), ph = ar >= 1 ? Math.max(1, BOX / ar) : BOX;
  return (
    <div className="cl-ub">
      <div className="cl-ub-in">
        {busy ? <p className="cl-ub-busy" role="status">{busy}</p> : preview ? (
          <button type="button" className="cl-ub-prev" onClick={pick} aria-label="다시 올리기">
            <img src={preview.src} alt="올린 이미지 미리보기" style={{ width: pw, height: ph }} />
            <span className="cl-ub-mask"><span className="cl-ub-re">+ 다시 올리기</span><small>현재 이미지 크기: {preview.w} × {preview.h}</small></span>
          </button>
        ) : (
          <div className="cl-ub-empty">
            <h4>{title}</h4>
            <p>{desc}{tip && <Tip lines={tip} />}</p>
            <button type="button" className="btn-ghost" onClick={pick}>+ 파일 추가</button>
          </div>
        )}
        <input ref={ref} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
      </div>
      {err && <p className="cl-err cl-cp-err" role="alert">{err}</p>}
    </div>
  );
}
