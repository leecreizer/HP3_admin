import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BATCH_FIELDS, BIZ_TABS, EXPORT_GROUPS, LOCATIONS, TOOLBAR_LABEL, UNITS,
  exportFileName, fileToThumb, fmtDate, libName, newId, parseCsv, toCsv, walkFolders,
  type BatchField, type BizTab, type BrandSeries, type ContentState, type CustomField, type Folder,
  type Item, type ItemHistory, type Library, type LibrarySettings, type LogEntry, type Member, type Partner,
} from '../../data/contentLibrary';
import { CREATE_PORTALS, type CreateKind, type CreatePortal } from '../../data/contentCreate';
import { AssetViewer } from '../../components/AssetViewer';
import { MODELING_EDITOR_ENABLED } from '../../pm/editorFlag';
import { PV_TYPES } from '../../data/paving';

/* ───────────────────────── 공통 셸 ───────────────────────── */

export function Modal({ title, onClose, size, children, actions, sub }: {
  title: string; onClose: () => void; size?: 'wide' | 'xl'; children: ReactNode; actions?: ReactNode; sub?: ReactNode;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal cl-modal${size ? ` ${size}` : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head">
          <h2 className="modal-title">{title}</h2>
          {sub}
          <button className="cl-x" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        <div className="cl-modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** 폴더 트리 선택 리스트 (단일 선택) */
export function FolderSelect({ tree, value, onChange }: { tree: Folder[]; value: string; onChange: (id: string) => void }) {
  const rows: { f: Folder; depth: number }[] = [];
  walkFolders(tree, (f, path) => rows.push({ f, depth: path.length }));
  return (
    <ul className="cl-folder-select">
      {rows.map(({ f, depth }) => (
        <li key={f.id}>
          <button className={value === f.id ? 'on' : ''} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => onChange(f.id)}>
            📁 {f.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="cl-field">
    <span>{label}</span>
    <div>{children}{hint && <small>{hint}</small>}</div>
  </label>
);

function BrandSeriesPicker({ brands, brandId, seriesId, onChange }: {
  brands: BrandSeries[]; brandId: string; seriesId: string; onChange: (b: BrandSeries | undefined, seriesId: string) => void;
}) {
  const b = brands.find((x) => x.id === brandId);
  return (
    <div className="cl-inline2">
      <select className="inline-input full" value={brandId} onChange={(e) => { const nb = brands.find((x) => x.id === e.target.value); onChange(nb, nb?.series[0]?.id ?? ''); }}>
        <option value="">브랜드 선택</option>
        {brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <select className="inline-input full" value={seriesId} disabled={!b} onChange={(e) => onChange(b, e.target.value)}>
        {(b?.series ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

/* ───────────────────────── 빠른 편집 ───────────────────────── */

export function QuickEditModal({ item, brands, tagGroups, onClose, onSave }: {
  item: Item; brands: BrandSeries[]; tagGroups: ContentState['tagGroups']; onClose: () => void; onSave: (patch: Partial<Item>) => void;
}) {
  const [d, setD] = useState({ ...item });
  const [tagQ, setTagQ] = useState('');
  const set = <K extends keyof Item>(k: K, v: Item[K]) => setD((p) => ({ ...p, [k]: v }));
  const tagHits = useMemo(() => {
    const q = tagQ.trim().toLowerCase();
    if (!q) return [];
    return tagGroups.flatMap((g) => g.tags.filter((t) => t.toLowerCase().includes(q) && !d.tags.includes(t)).map((t) => ({ g: g.name, t }))).slice(0, 12);
  }, [tagQ, tagGroups, d.tags]);
  return (
    <Modal title="빠른 편집" onClose={onClose} size="wide"
      actions={<>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!d.name.trim()}
          onClick={() => onSave({
            name: d.name.trim(), model: d.model, code: d.code, brandId: d.brandId, brand: d.brand, seriesId: d.seriesId, series: d.series,
            size: d.size, price: d.price, unit: d.unit, buyLink: d.buyLink, appletLink: d.appletLink, description: d.description, tags: d.tags,
          })}>저장</button>
      </>}>
      <div className="cl-form">
        <Field label="* 상품명"><input className="inline-input full" maxLength={128} value={d.name} onChange={(e) => set('name', e.target.value)} /><small>{d.name.length}/128</small></Field>
        <Field label="모델번호" hint="설계 툴 검색·견적 매칭에 쓰이는 모델 번호"><input className="inline-input full" value={d.model} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="상품코드" hint="ERP 상품 코드"><input className="inline-input full" value={d.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="브랜드·시리즈">
          <BrandSeriesPicker brands={brands} brandId={d.brandId} seriesId={d.seriesId}
            onChange={(b, sid) => setD((p) => ({ ...p, brandId: b?.id ?? '', brand: b?.name ?? '', seriesId: sid, series: b?.series.find((s) => s.id === sid)?.name ?? '' }))} />
        </Field>
        <Field label="상품 크기"><input className="inline-input full" maxLength={200} placeholder="200자 이내" value={d.size} onChange={(e) => set('size', e.target.value)} /></Field>
        <Field label="판매가">
          <div className="cl-inline2">
            <input className="inline-input full" type="number" min={0} placeholder="가격 입력" value={d.price ?? ''} onChange={(e) => set('price', e.target.value === '' ? null : Number(e.target.value))} />
            <span className="cl-unit">KRW</span>
          </div>
        </Field>
        <Field label="단위">
          <select className="inline-input full" value={d.unit ?? '개'} onChange={(e) => set('unit', e.target.value)}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
        </Field>
        <Field label="구매 링크">
          <div className="cl-stack">
            <input className="inline-input full" placeholder="웹 링크 https://" value={d.buyLink} onChange={(e) => set('buyLink', e.target.value)} />
            <input className="inline-input full" placeholder="앱 링크" value={d.appletLink} onChange={(e) => set('appletLink', e.target.value)} />
          </div>
        </Field>
        <Field label="설명"><textarea className="inline-input full" rows={3} maxLength={1000} placeholder="1000자 이내" value={d.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="태그">
          <div className="cl-stack">
            <div>{d.tags.map((t) => <span key={t} className="tag removable">{t} <button className="cl-tag-x" aria-label={`${t} 제거`} onClick={() => set('tags', d.tags.filter((x) => x !== t))}>×</button></span>)}</div>
            <input className="inline-input full" placeholder="+ 태그 검색해서 추가" value={tagQ} onChange={(e) => setTagQ(e.target.value)} />
            {tagHits.length > 0 && (
              <div className="cl-chipbox">
                {tagHits.map(({ g, t }) => <button key={g + t} className="swap-chip" onClick={() => { set('tags', [...d.tags, t]); setTagQ(''); }}>{t} <small>· {g}</small></button>)}
              </div>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────── 일괄 편집 ───────────────────────── */

export function BatchEditModal({ field, count, brands, onClose, onApply }: {
  field: BatchField; count: number; brands: BrandSeries[]; onClose: () => void; onApply: (patch: (i: Item) => Partial<Item>) => void;
}) {
  const meta = BATCH_FIELDS.find((f) => f.key === field)!;
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'prefix' | 'suffix'>('replace');
  const [flag, setFlag] = useState(true);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '');
  const [seriesId, setSeriesId] = useState(brands[0]?.series[0]?.id ?? '');
  const [tagMode, setTagMode] = useState<'add' | 'remove' | 'replace'>('add');

  let body: ReactNode;
  let apply: ((i: Item) => Partial<Item>) | null = null;
  const lines = text.split(',').map((s) => s.trim()).filter(Boolean);
  switch (field) {
    case 'visible': case 'panorama': case 'sizeLock':
      body = <div className="seg">{[true, false].map((v) => <button key={String(v)} className={`seg-item${flag === v ? ' active' : ''}`} onClick={() => setFlag(v)}>{v ? (field === 'visible' ? '노출' : field === 'sizeLock' ? '잠금' : '표시') : (field === 'visible' ? '비노출' : field === 'sizeLock' ? '해제' : '숨김')}</button>)}</div>;
      apply = () => ({ [field]: flag });
      break;
    case 'location':
      body = <select className="inline-input full" value={text} onChange={(e) => setText(e.target.value)}><option value="">선택</option>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select>;
      apply = text ? () => ({ location: text }) : null;
      break;
    case 'unit':
      body = <select className="inline-input full" value={text} onChange={(e) => setText(e.target.value)}><option value="">선택</option>{UNITS.map((l) => <option key={l}>{l}</option>)}</select>;
      apply = text ? () => ({ unit: text }) : null;
      break;
    case 'brand':
      body = <BrandSeriesPicker brands={brands} brandId={brandId} seriesId={seriesId} onChange={(b, sid) => { setBrandId(b?.id ?? ''); setSeriesId(sid); }} />;
      apply = brandId ? () => { const b = brands.find((x) => x.id === brandId)!; return { brandId, brand: b.name, seriesId, series: b.series.find((s) => s.id === seriesId)?.name ?? '' }; } : null;
      break;
    case 'price':
      body = <input className="inline-input full" type="number" min={0} placeholder="KRW" value={text} onChange={(e) => setText(e.target.value)} />;
      apply = text !== '' ? () => ({ price: Number(text) }) : null;
      break;
    case 'tags':
      body = <>
        <div className="seg" style={{ marginBottom: 8 }}>{(['add', 'remove', 'replace'] as const).map((m) => <button key={m} className={`seg-item${tagMode === m ? ' active' : ''}`} onClick={() => setTagMode(m)}>{{ add: '추가', remove: '제거', replace: '교체' }[m]}</button>)}</div>
        <input className="inline-input full" placeholder="쉼표로 구분 (예: 4인용, MVME)" value={text} onChange={(e) => setText(e.target.value)} />
      </>;
      apply = lines.length || tagMode === 'replace' ? (i) => ({
        tags: tagMode === 'add' ? [...new Set([...i.tags, ...lines])] : tagMode === 'remove' ? i.tags.filter((t) => !lines.includes(t)) : lines,
      }) : null;
      break;
    case 'name': case 'model': case 'code': case 'size': case 'material': case 'buyLink': case 'description':
      body = <>
        <div className="seg" style={{ marginBottom: 8 }}>{(['replace', 'prefix', 'suffix'] as const).map((m) => <button key={m} className={`seg-item${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>{{ replace: '전체 바꾸기', prefix: '앞에 붙이기', suffix: '뒤에 붙이기' }[m]}</button>)}</div>
        <input className="inline-input full" value={text} onChange={(e) => setText(e.target.value)} placeholder={`${meta.label} 값`} />
      </>;
      apply = text || (mode === 'replace' && field !== 'name') ? (i) => {
        const cur = String(i[field] ?? '');
        return { [field]: mode === 'replace' ? text : mode === 'prefix' ? text + cur : cur + text };
      } : null;
      break;
    default:
      body = <p className="cl-note">‘{meta.label}’은(는) 모델 데이터를 직접 다루는 작업이라 에디터(파츠 모델러·조립)와 연동한 뒤 사용할 수 있습니다.</p>;
  }
  return (
    <Modal title={`일괄 편집 · ${meta.label}`} onClose={onClose}
      sub={<span className="cl-sub">선택한 {count}개 상품에 적용</span>}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!apply} onClick={() => apply && onApply(apply)}>적용</button>
      </>}>
      {body}
    </Modal>
  );
}

/* ───────────────────────── 권한 부여 ───────────────────────── */

export function AuthorizeModal({ partners, count, onClose, onApply }: { partners: Partner[]; count: number; onClose: () => void; onApply: (accounts: string[], revoke: boolean) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const keys = partners.map((p, i) => `${p.account}#${i}`);
  const label = (k: string) => k.split('#')[0];
  return (
    <Modal title="권한 부여" onClose={onClose} sub={<span className="cl-sub">선택 {count}개 상품을 파트너 계정에 공유</span>}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-ghost danger" disabled={!sel.length} onClick={() => onApply(sel.map(label), true)}>권한 회수</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!sel.length} onClick={() => onApply(sel.map(label), false)}>권한 부여</button>
      </>}>
      <ul className="cl-checklist">
        {partners.map((p, i) => (
          <li key={keys[i]}>
            <label className="check-item">
              <input type="checkbox" checked={sel.includes(keys[i])} onChange={(e) => setSel((s) => e.target.checked ? [...s, keys[i]] : s.filter((x) => x !== keys[i]))} />
              <b>{p.account}</b> <span className="cl-muted">{p.brands.join(' · ')}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ───────────────────────── 폴더 선택 (추가/이동/다른 이름 저장) ───────────────────────── */

export function FolderPickModal({ title, tree, onClose, onPick, okLabel }: { title: string; tree: Folder[]; onClose: () => void; onPick: (id: string) => void; okLabel: string }) {
  const [v, setV] = useState('');
  return (
    <Modal title={title} onClose={onClose}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!v} onClick={() => onPick(v)}>{okLabel}</button>
      </>}>
      <FolderSelect tree={tree} value={v} onChange={setV} />
    </Modal>
  );
}

/* ───────────────────────── 패키지 / 스타일에 추가 ───────────────────────── */

export function AddToModal({ kind, options, count, onClose, onApply }: { kind: 'package' | 'style'; options: string[]; count: number; onClose: () => void; onApply: (name: string, isNew: boolean) => void }) {
  const [v, setV] = useState(options[0] ?? '');
  const [nv, setNv] = useState('');
  const label = kind === 'package' ? '패키지' : '스타일';
  return (
    <Modal title={`${label}에 추가`} onClose={onClose} sub={<span className="cl-sub">선택 {count}개</span>}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!v && !nv.trim()} onClick={() => onApply(nv.trim() || v, !!nv.trim())}>추가</button>
      </>}>
      <div className="cl-form">
        <Field label={`기존 ${label}`}>
          <select className="inline-input full" value={v} onChange={(e) => setV(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label={`새 ${label}`} hint="입력하면 새로 만들어 추가합니다"><input className="inline-input full" value={nv} onChange={(e) => setNv(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ───────────────────────── 컨텐츠 제작 ───────────────────────── */

const SHAPED_NAME = { hexagon: '육각형', star: '네 꼭지 별', radius: '둥근 모서리 사각', custom: '사용자 정의' } as const;
const CARD_ICON: Record<CreateKind, string> = { paramModel: '⬢', material: '▣', model3d: '◈', profile: '⌇', modelCutting: '✂', virtualModel: '⚙', pattern: '▦', hybrid: '◐', tile: '▤', border: '⌜', tilePattern: '▩', waterjet: '✺', shaped: '⬡', paving: '⊞', unverified: '▢' };

/**
 * 컨텐츠 제작(쿠지알러 创建素材) — 업무 탭별 카드. 카드를 누르면 쿠지알러처럼 그 카드의 생성 화면이 열린다
 * (파라메트릭 모델 = 에디터 + 모델 유형 선택, 나머지 = 업로드 화면 — CreatePages.tsx).
 */
export function CreateMaterialModal({ tabKey, onClose, onPick }: { tabKey: string; onClose: () => void; onPick: (tab: BizTab, portal: CreatePortal) => void }) {
  const [tab, setTab] = useState<BizTab>(BIZ_TABS.find((t) => t.key === tabKey) ?? BIZ_TABS[0]);
  // 에디터를 뺀 배포(main)에서는 파라메트릭 모델 카드를 숨긴다
  const cards = (CREATE_PORTALS[tab.key] ?? []).filter((c) => MODELING_EDITOR_ENABLED || c.kind !== 'paramModel');
  return (
    <Modal title="컨텐츠 제작" onClose={onClose} size="xl">
      <div className="seg cl-tabs-scroll" role="tablist">
        {BIZ_TABS.map((t) => <button key={t.key} role="tab" aria-selected={t.key === tab.key} className={`seg-item${t.key === tab.key ? ' active' : ''}`} onClick={() => setTab(t)}>{t.label}</button>)}
      </div>
      <div className="cl-create-grid">
        {cards.map((c) => (
          <button key={c.id} className={`cl-create-card${c.kind === 'unverified' ? ' unv' : ''}`} onClick={() => onPick(tab, c)} title={`쿠지알러 ‘${c.origin}’`}>
            <span className="cl-create-ico" aria-hidden="true">{CARD_ICON[c.kind]}</span>
            <span><b>{c.title}{c.kind === 'paramModel' && <em className="cl-ed-badge">에디터</em>}{c.kind === 'unverified' && <em className="cl-unv-badge">화면 미확인</em>}</b><small>{c.desc}</small></span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ───────────────────────── 가져오기 / 내보내기 ───────────────────────── */

export function ImportExportModal({ st, tabKey, onClose, onImportItems, onImportFolders, onLog, userName }: {
  st: ContentState; tabKey: string; userName: string; onClose: () => void;
  onImportItems: (rows: Record<string, string>[], lib: number, folder: string) => { created: number; updated: number };
  onImportFolders: (paths: string[][], lib: number) => number;
  onLog: (e: LogEntry) => void;
}) {
  const [view, setView] = useState<'items' | 'folders'>('items');
  const [kind, setKind] = useState<'all' | '가져오기' | '내보내기'>('all');
  const [wizard, setWizard] = useState<null | 'export' | 'import' | 'folders'>(null);
  const lib = st.libraries.find((l) => l.id === st.activeLibrary)!;
  const logs = st.logs.filter((l) => (view === 'folders' ? l.kind === '폴더 가져오기' : l.kind !== '폴더 가져오기') && (kind === 'all' || l.kind === kind));
  const [preview, setPreview] = useState<{ total: number; name: string } | null>(null);
  const [page, setPage] = useState(1);
  const PER = 12;
  const shown = logs.slice((page - 1) * PER, page * PER);
  return (
    <Modal title="가져오기 / 내보내기" onClose={onClose} size="xl">
      {wizard === 'export' ? <ExportWizard st={st} tabKey={tabKey} onBack={() => setWizard(null)} onDone={(count, label) => {
        onLog({ id: newId('LOG'), kind: '내보내기', at: Date.now(), by: userName, library: lib.name, count, status: '성공', detail: label }); setWizard(null);
      }} /> : wizard ? <ImportWizard st={st} tabKey={tabKey} mode={wizard} onBack={() => setWizard(null)} onRun={(rows, l, f) => {
        if (wizard === 'folders') {
          const n = onImportFolders(rows.map((r) => (r['폴더 경로'] ?? Object.values(r)[0] ?? '').split('/').map((s) => s.trim()).filter(Boolean)), l);
          onLog({ id: newId('LOG'), kind: '폴더 가져오기', at: Date.now(), by: userName, library: lib.name, count: n, status: n ? '성공' : '실패' });
        } else {
          const r = onImportItems(rows, l, f);
          onLog({ id: newId('LOG'), kind: '가져오기', at: Date.now(), by: userName, library: lib.name, count: r.created + r.updated, status: r.created + r.updated ? '성공' : '실패', detail: `신규 ${r.created} · 갱신 ${r.updated}` });
          setPreview({ total: r.created + r.updated, name: `신규 ${r.created}건 · 갱신 ${r.updated}건` });
        }
        setWizard(null);
      }} /> : (
        <>
          <div className="cl-row">
            <div className="seg">{(['items', 'folders'] as const).map((v) => <button key={v} className={`seg-item${view === v ? ' active' : ''}`} onClick={() => { setView(v); setPage(1); }}>{v === 'items' ? '상품' : '폴더'}</button>)}</div>
            {view === 'items' && <div className="seg">{(['all', '가져오기', '내보내기'] as const).map((k) => <button key={k} className={`seg-item${kind === k ? ' active' : ''}`} onClick={() => { setKind(k); setPage(1); }}>{k === 'all' ? '전체' : k}</button>)}</div>}
            <span style={{ marginLeft: 'auto' }} />
            {view === 'items' ? <>
              <button className="btn-ghost" onClick={() => setWizard('export')}>⤓ 상품 내보내기</button>
              <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => setWizard('import')}>⤒ 상품 가져오기</button>
            </> : <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => setWizard('folders')}>⤒ 폴더 구조 가져오기</button>}
          </div>
          {preview && <p className="cl-ok">가져오기 완료 — {preview.name}</p>}
          <table className="cl-table">
            <thead><tr><th>작업</th><th>작업 시간</th><th>작업자</th><th>라이브러리</th><th>{view === 'folders' ? '생성 폴더 수' : '성공 상품 수'}</th><th>상태</th><th>내용</th></tr></thead>
            <tbody>
              {shown.map((l) => <tr key={l.id}><td>{l.kind}</td><td className="num-inline">{fmtDate(l.at, true)}</td><td>{l.by}</td><td>{l.library}</td><td className="num-inline">{l.count}</td><td><span className={`pill ${l.status === '성공' ? 'st-done' : 'st-fail'}`}>{l.status}</span></td><td className="cl-muted">{l.detail ?? '-'}</td></tr>)}
              {!shown.length && <tr><td colSpan={7} className="empty-row">기록이 없습니다.</td></tr>}
            </tbody>
          </table>
          {logs.length > PER && <div className="cl-pager">{Array.from({ length: Math.ceil(logs.length / PER) }, (_, i) => <button key={i} className={page === i + 1 ? 'on' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>}
        </>
      )}
    </Modal>
  );
}

function ExportWizard({ st, tabKey, onBack, onDone }: { st: ContentState; tabKey: string; onBack: () => void; onDone: (count: number, label: string) => void }) {
  const [step, setStep] = useState(1);
  const [tab, setTab] = useState(BIZ_TABS.find((t) => t.key === tabKey) ?? BIZ_TABS[0]);
  const [libs, setLibs] = useState<number[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const allAttrs = EXPORT_GROUPS.flatMap((g) => g.attrs.map((a) => a.key));
  const [attrs, setAttrs] = useState<string[]>(['tab', 'lib', 'name', 'id', 'model', 'code', 'brand', 'series']);
  const items = (st.activeLibrary === 'main' ? st.items : st.extraItems[st.activeLibrary] ?? []).filter((i) => !i.deletedAt);
  const trees = st.trees[st.activeLibrary] ?? {};
  const target = items.filter((i) => libs.includes(i.lib) || folders.includes(i.folder));
  const toggle = <T,>(arr: T[], v: T, on: boolean) => (on ? [...arr, v] : arr.filter((x) => x !== v));
  const download = () => {
    const blob = new Blob([toCsv(target, attrs)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName(tab.label);
    a.click();
    URL.revokeObjectURL(a.href);
    onDone(target.length, `${tab.label} · 속성 ${attrs.length}개`);
  };
  return (
    <div>
      <ol className="cl-steps">{['분류 선택', '내보낼 속성 선택', '표 내보내기'].map((s, i) => <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><b>{i + 1}</b>{s}</li>)}</ol>
      {step === 1 && <>
        <p className="cl-note">※ 라이브러리를 넘나드는 내보내기는 지원하지 않습니다 (현재: {st.libraries.find((l) => l.id === st.activeLibrary)?.name}).</p>
        <div className="seg cl-tabs-scroll">{BIZ_TABS.map((t) => <button key={t.key} className={`seg-item${t.key === tab.key ? ' active' : ''}`} onClick={() => { setTab(t); setLibs([]); setFolders([]); }}>{t.label}</button>)}</div>
        <div className="cl-export-tree">
          {tab.libs.map((l) => (
            <div key={l.lib}>
              <label className="check-item"><input type="checkbox" checked={libs.includes(l.lib)} onChange={(e) => setLibs((s) => toggle(s, l.lib, e.target.checked))} /> <b>{l.group ? `${l.group} › ` : ''}{l.name}</b></label>
              {!libs.includes(l.lib) && (trees[l.lib] ?? []).length > 1 && (
                <div className="cl-export-sub">
                  {(trees[l.lib] ?? []).map((f) => <label key={f.id} className="check-item"><input type="checkbox" checked={folders.includes(f.id)} onChange={(e) => {
                    const ids: string[] = []; walkFolders([f], (x) => ids.push(x.id));
                    setFolders((s) => (e.target.checked ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x))));
                  }} /> {f.name}</label>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </>}
      {step === 2 && <>
        <label className="check-item" style={{ marginBottom: 10 }}><input type="checkbox" checked={attrs.length === allAttrs.length} onChange={(e) => setAttrs(e.target.checked ? allAttrs : [])} /> 전체 속성 선택 (선택 {attrs.length}/100)</label>
        {EXPORT_GROUPS.map((g) => (
          <div key={g.group} className="cl-attr-group">
            <div className="cl-label">{g.group}</div>
            <div className="check-list">{g.attrs.map((a) => <label key={a.key} className="check-item"><input type="checkbox" checked={attrs.includes(a.key)} onChange={(e) => setAttrs((s) => toggle(s, a.key, e.target.checked))} /> {a.label}</label>)}</div>
          </div>
        ))}
        {st.customFields.length > 0 && <p className="cl-muted" style={{ fontSize: '0.74rem' }}>사용자 정의 필드({st.customFields.map((f) => f.name).join(', ')})는 상세 화면에서 관리하며 다음 버전에서 내보내기에 포함됩니다.</p>}
      </>}
      {step === 3 && <div className="cl-export-sum">
        <p><b>{target.length.toLocaleString()}</b>개 상품 · 속성 <b>{attrs.length}</b>개를 CSV(엑셀 호환)로 내보냅니다.</p>
        <p className="cl-muted">대상: {[...libs.map(libName), ...(folders.length ? [`폴더 ${folders.length}개`] : [])].join(', ')}</p>
      </div>}
      <div className="modal-actions">
        <button className="btn-ghost" onClick={step === 1 ? onBack : () => setStep(step - 1)}>{step === 1 ? '취소' : '이전'}</button>
        {step < 3
          ? <button className="btn-primary" style={{ marginLeft: 0 }} disabled={step === 1 ? !libs.length && !folders.length : !attrs.length} onClick={() => setStep(step + 1)}>다음</button>
          : <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!target.length} onClick={download}>표 내보내기</button>}
      </div>
    </div>
  );
}

function ImportWizard({ st, tabKey, mode, onBack, onRun }: {
  st: ContentState; tabKey: string; mode: 'import' | 'folders'; onBack: () => void; onRun: (rows: Record<string, string>[], lib: number, folder: string) => void;
}) {
  const tab = BIZ_TABS.find((t) => t.key === tabKey) ?? BIZ_TABS[0];
  const [lib, setLib] = useState(tab.libs[0].lib);
  const [folder, setFolder] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const trees = st.trees[st.activeLibrary] ?? {};
  const template = mode === 'folders' ? '폴더 경로\n가구/침실/침대\n가구/거실/소파' : '상품명,모델번호,상품코드,브랜드,시리즈,상품 크기,재질,판매가,설명,태그,상품 ID\n예시 소파 3인,IGD,BBIL00001,HANSSEM,-,2200x900x800,패브릭,1290000,,3인용|패브릭,';
  const read = async (f: File) => {
    setErr('');
    const grid = parseCsv(await f.text());
    if (grid.length < 2) { setErr('데이터 행이 없습니다. 첫 행은 머리글이어야 합니다.'); setRows([]); return; }
    const [head, ...body] = grid;
    const out = body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
    if (mode === 'import' && !head.map((h) => h.trim()).includes('상품명')) { setErr("'상품명' 머리글이 필요합니다."); setRows([]); return; }
    setRows(out);
  };
  return (
    <div>
      <div className="cl-create-form">
        <div className="cl-form">
          <p className="cl-note">{mode === 'folders' ? "CSV 첫 열 '폴더 경로'에 '상위/하위/하위' 형식으로 적으면 폴더 구조를 만듭니다." : "CSV(UTF-8) 머리글로 상품을 만들거나, '상품 ID'가 기존 상품과 같으면 값을 갱신합니다."}</p>
          <Field label="대상 라이브러리">
            <select className="inline-input full" value={lib} onChange={(e) => { setLib(Number(e.target.value)); setFolder(''); }}>
              {tab.libs.map((l) => <option key={l.lib} value={l.lib}>{l.group ? `${l.group} › ` : ''}{l.name}</option>)}
            </select>
          </Field>
          <Field label="파일">
            <div className="cl-inline2">
              <button className="btn-ghost" onClick={() => fileRef.current?.click()}>CSV 선택</button>
              <a className="btn-ghost" href={`data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + template)}`} download={mode === 'folders' ? '폴더구조_양식.csv' : '상품가져오기_양식.csv'}>양식 받기</a>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ''; }} />
          </Field>
          {err && <p className="cl-err">{err}</p>}
          {rows.length > 0 && <p className="cl-ok">{rows.length}행을 읽었습니다.</p>}
        </div>
        {mode === 'import' && <div><div className="cl-label">* 저장 폴더 (신규 상품)</div><FolderSelect tree={trees[lib] ?? []} value={folder} onChange={setFolder} /></div>}
      </div>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onBack}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!rows.length || (mode === 'import' && !folder)} onClick={() => onRun(rows, lib, folder)}>가져오기</button>
      </div>
    </div>
  );
}

/* ───────────────────────── 라이브러리 관리 ───────────────────────── */

export function LibraryManageModal({ lib, onClose, onSave, onDelete }: { lib: Library; onClose: () => void; onSave: (l: Library) => void; onDelete?: () => void }) {
  const [d, setD] = useState<Library>(lib);
  const [tab, setTab] = useState<'basic' | 'members' | 'external'>('basic');
  const [form, setForm] = useState<Omit<Member, 'id'>>({ name: '', email: '', dept: '', perm: '조회' });
  const list = d.members.filter((m) => (tab === 'external' ? m.external : !m.external));
  const add = () => {
    if (!form.name.trim()) return;
    setD((p) => ({ ...p, members: [...p.members, { ...form, id: newId('M'), external: tab === 'external' }] }));
    setForm({ name: '', email: '', dept: '', perm: '조회' });
  };
  return (
    <Modal title={`라이브러리 관리 · ${lib.name}`} onClose={onClose} size="wide"
      actions={<>
        {onDelete && <button className="btn-ghost danger" style={{ marginRight: 'auto' }} onClick={onDelete}>라이브러리 삭제</button>}
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!d.name.trim()} onClick={() => onSave({ ...d, name: d.name.trim() })}>저장</button>
      </>}>
      <div className="seg" style={{ marginBottom: 14 }}>{([['basic', '기본 정보'], ['members', '인원 설정'], ['external', '외부 계정']] as const).map(([k, l]) => <button key={k} className={`seg-item${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'basic' ? (
        <div className="cl-form">
          <Field label="* 이름"><input className="inline-input full" maxLength={12} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /><small>{d.name.length}/12</small></Field>
          {lib.main && <p className="cl-note">기업 라이브러리는 주 라이브러리라 삭제할 수 없습니다. 추가 라이브러리는 상품을 동기화해 별도 조직·부서에 따로 공개할 때 씁니다.</p>}
        </div>
      ) : (
        <>
          {tab === 'members'
            ? <p className="cl-note">기업 내부는 기본적으로 모두 볼 수 있습니다. 여기에 넣은 인원은 이 라이브러리의 편집·관리 권한을 받습니다.</p>
            : <label className="check-item" style={{ marginBottom: 10 }}><input type="checkbox" checked={d.externalDefaultVisible} onChange={(e) => setD({ ...d, externalDefaultVisible: e.target.checked })} /> 외부 계정에 기본 노출</label>}
          <table className="cl-table">
            <thead><tr><th>이름</th><th>이메일</th><th>부서</th><th>권한</th><th /></tr></thead>
            <tbody>
              {list.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.email}</td><td>{m.dept || '-'}</td>
                <td><select className="inline-input" value={m.perm} onChange={(e) => setD((p) => ({ ...p, members: p.members.map((x) => x.id === m.id ? { ...x, perm: e.target.value as Member['perm'] } : x) }))}>{['관리', '편집', '조회'].map((v) => <option key={v}>{v}</option>)}</select></td>
                <td><button className="link-mini" onClick={() => setD((p) => ({ ...p, members: p.members.filter((x) => x.id !== m.id) }))}>삭제</button></td></tr>)}
              {!list.length && <tr><td colSpan={5} className="empty-row">등록된 인원이 없습니다.</td></tr>}
              <tr className="cl-add-row">
                <td><input className="inline-input full" placeholder="이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
                <td><input className="inline-input full" placeholder="이메일" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></td>
                <td><input className="inline-input full" placeholder="부서" value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} /></td>
                <td><select className="inline-input" value={form.perm} onChange={(e) => setForm({ ...form, perm: e.target.value as Member['perm'] })}>{['관리', '편집', '조회'].map((v) => <option key={v}>{v}</option>)}</select></td>
                <td><button className="btn-mini" style={{ padding: '6px 10px' }} onClick={add}>추가</button></td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

/* ───────────────────────── 설정 ───────────────────────── */

const SETTING_SECTIONS = ['콘텐츠 표시', '폴더 표지', '목록 작업 항목', '도구 측 정렬', '통화', '가격 정렬 통화', '조합 모델 동기화 규칙', '조합 모델 무효 검사', '혼합 조합 무효 검사'];

function Radio<T extends string | boolean>({ value, opts, onChange }: { value: T; opts: [T, string][]; onChange: (v: T) => void }) {
  return <div className="cl-radios">{opts.map(([v, l]) => <label key={String(v)} className="check-item"><input type="radio" checked={value === v} onChange={() => onChange(v)} /> {l}</label>)}</div>;
}
function Sec({ title, children }: { title: string; children: ReactNode }) {
  return <section id={`cl-set-${SETTING_SECTIONS.indexOf(title)}`} className="cl-set-sec"><h3>{title}</h3>{children}</section>;
}

export function SettingsModal({ settings, onClose, onSave }: { settings: LibrarySettings; onClose: () => void; onSave: (s: LibrarySettings) => void }) {
  const [s, setS] = useState(settings);
  const [sec, setSec] = useState(SETTING_SECTIONS[0]);
  const dragKey = useRef<string | null>(null);
  return (
    <Modal title="설정" onClose={onClose} size="xl"
      actions={<><button className="btn-ghost" onClick={onClose}>취소</button><button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => onSave(s)}>확인</button></>}>
      <div className="cl-settings">
        <nav>{SETTING_SECTIONS.map((t) => <button key={t} className={sec === t ? 'on' : ''} onClick={() => { setSec(t); document.getElementById(`cl-set-${SETTING_SECTIONS.indexOf(t)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{t}</button>)}</nav>
        <div className="cl-settings-body">
          <Sec title="콘텐츠 표시">
            <div className="cl-set-row"><span>내용 영역에 하위 폴더 표시</span><Radio value={s.showFoldersInContent} opts={[[true, '표시'], [false, '숨김']]} onChange={(v) => setS({ ...s, showFoldersInContent: v })} /></div>
          </Sec>
          <Sec title="폴더 표지">
            <div className="cl-set-row"><span>자동 표지 설정 <small>폴더 첫 상품 이미지를 표지로 씁니다</small></span><Radio value={s.autoCover} opts={[['on', '켜기'], ['off', '끄기만'], ['clear', '끄고 표지 비우기']]} onChange={(v) => setS({ ...s, autoCover: v })} /></div>
          </Sec>
          <Sec title="목록 작업 항목">
            <p className="cl-muted" style={{ fontSize: '0.76rem', marginBottom: 8 }}>끌어서 순서를 바꾸고, 체크를 끄면 툴바에서 숨깁니다.</p>
            <div className="cl-toolbar-order">
              {s.toolbar.map((t) => (
                <div key={t.key} className="cl-order-chip" draggable
                  onDragStart={() => { dragKey.current = t.key; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const src = dragKey.current; if (!src || src === t.key) return;
                    const list = s.toolbar.filter((x) => x.key !== src);
                    list.splice(list.findIndex((x) => x.key === t.key), 0, s.toolbar.find((x) => x.key === src)!);
                    setS({ ...s, toolbar: list });
                  }}>
                  <span aria-hidden="true">≡</span>
                  <label><input type="checkbox" checked={t.visible} onChange={(e) => setS({ ...s, toolbar: s.toolbar.map((x) => x.key === t.key ? { ...x, visible: e.target.checked } : x) })} /> {TOOLBAR_LABEL[t.key]}</label>
                </div>
              ))}
            </div>
          </Sec>
          <Sec title="도구 측 정렬">
            <div className="cl-set-row"><span>상품별 사용자 정렬 가중치 사용</span><Radio value={s.customSortWeight} opts={[[true, '켜기'], [false, '끄기']]} onChange={(v) => setS({ ...s, customSortWeight: v })} /></div>
          </Sec>
          <Sec title="통화">
            <div className="cl-set-row"><span>설계 도구 표시 규칙</span><Radio value={s.currency} opts={[['system', '시스템 지역 언어 기준'], ['same', '관리자 화면과 동일']]} onChange={(v) => setS({ ...s, currency: v })} /></div>
          </Sec>
          <Sec title="가격 정렬 통화">
            <div className="cl-set-row"><span>통화 종류 <small>변경 후 24시간 안에 반영</small></span>
              <select className="inline-input" value={s.priceSortCurrency} onChange={(e) => setS({ ...s, priceSortCurrency: e.target.value })}>{['KRW', 'USD', 'CNY', 'JPY', 'EUR'].map((c) => <option key={c}>{c}</option>)}</select></div>
          </Sec>
          <Sec title="조합 모델 동기화 규칙">
            <div className="cl-set-row"><span>하위 모델을 ‘도구 비노출’로 바꾸면 조합 모델도 비노출</span><Radio value={s.syncHiddenToCombo} opts={[[true, '예'], [false, '아니오']]} onChange={(v) => setS({ ...s, syncHiddenToCombo: v })} /></div>
            <div className="cl-set-row"><span>하위 모델을 삭제하면 조합 모델도 삭제</span><Radio value={s.syncDeleteToCombo} opts={[[true, '예'], [false, '아니오']]} onChange={(v) => setS({ ...s, syncDeleteToCombo: v })} /></div>
          </Sec>
          <Sec title="조합 모델 무효 검사">
            <div className="cl-set-row"><span>조합 모델 무효 검사</span><Radio value={s.comboCheck} opts={[[true, '켜기'], [false, '끄기']]} onChange={(v) => setS({ ...s, comboCheck: v })} /></div>
          </Sec>
          <Sec title="혼합 조합 무효 검사">
            <div className="cl-set-row"><span>혼합 조합 모델 무효 검사</span><Radio value={s.mixedComboCheck} opts={[[true, '켜기'], [false, '끄기']]} onChange={(v) => setS({ ...s, mixedComboCheck: v })} /></div>
          </Sec>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────── 상품 상세 ───────────────────────── */

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="cl-dl"><dt>{k}</dt><dd>{v === '' || v == null ? '-' : v}</dd></div>;
}

export function DetailModal({ item, path, related, history, customFields, onClose, onEdit, onPatch, onOpen, onEditModel, onEditPaving }: {
  item: Item; path: string[]; related: Item[]; history: ItemHistory[]; customFields: CustomField[];
  onClose: () => void; onEdit: () => void; onPatch: (p: Partial<Item>, action: string) => void; onOpen: (id: string) => void;
  /** 파라메트릭 모델 상품 — 에디터로 모델 설정 */
  onEditModel?: () => void;
  /** 파라메트릭 방안 상품 — 파라메트릭 편집기로 방안 편집 */
  onEditPaving?: () => void;
}) {
  const [panel, setPanel] = useState<null | 'history' | 'related' | 'size' | 'cover'>(null);
  const [menu, setMenu] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [size, setSize] = useState(item.modelSize);
  const [custom, setCustom] = useState<Record<string, string>>(item.custom ?? {});
  const [detail, setDetail] = useState(item.detailText ?? '');
  const photos = item.photos ?? [];
  const yn = (b: boolean) => (b ? '예' : '아니오');
  return (
    <Modal title="상품 상세" onClose={onClose} size="xl">
      <div className="cl-detail">
        <div className="cl-detail-left">
          <div className="cl-detail-img">
            {view3d && item.model3d?.asset
              ? <AssetViewer key={item.model3d.asset} asset={{ id: item.model3d.asset, name: `${item.name}.glb`, type: '모델링' }} />
              : item.img ? <img src={item.img} alt={item.name} /> : <span>이미지 없음</span>}
            {item.model3d?.asset && (
              <div className="seg cl-img-toggle" role="tablist" aria-label="보기">
                <button className={`seg-item${!view3d ? ' active' : ''}`} onClick={() => setView3d(false)}>원본</button>
                <button className={`seg-item${view3d ? ' active' : ''}`} onClick={() => setView3d(true)}>3D</button>
              </div>
            )}
          </div>
          {item.model3d?.kind === 'param' && <p className="cl-model-tag">⬢ 파라메트릭 모델 · {item.renderCat || '분류 없음'}</p>}
          {item.model3d?.kind === 'glb' && <p className="cl-model-tag">◈ 3D 모델 업로드 · {item.model3d.file}</p>}
          {item.profile && <p className="cl-model-tag">⌇ 몰딩 프로파일 단면 {item.profile.w} × {item.profile.h} mm · 점 {item.profile.points.length}개</p>}
          {item.mix && <p className="cl-model-tag">◐ 혼합 재질 · 검은 영역 {item.mix.black.name} · 흰 영역 {item.mix.white.name}</p>}
          {item.border && <p className="cl-model-tag">⌜ 보더 패턴 · 보더 타일 {item.border.edge.name}{item.border.cornerTile ? ` · 코너 타일 ${item.border.cornerTile.name}` : ' · 코너 없음'}</p>}
          {item.shaped && <p className="cl-model-tag">⬡ 비정형 상품 · {SHAPED_NAME[item.shaped.kind]}{item.shaped.params ? ` · 직선 변 ${item.shaped.params.straight}mm · 호 높이 ${item.shaped.params.arc}mm` : ''}{item.shaped.kind === 'radius' && item.shaped.params ? ` · 짝 맞는 작은 타일 ${item.shaped.params.side}mm` : ''}{item.shaped.cad ? ` · CAD ${item.shaped.cad.name}` : ''} · 면 {item.shaped.faces.length}장 · 줄눈 {item.shaped.gapWidth}mm</p>}
          {item.medallion && <p className="cl-model-tag">✺ 워터젯 패턴 · 영역 {item.medallion.regions}개 · 구멍 {item.medallion.fills.filter((f) => f === 'hollow').length}개 · {item.medallion.w}×{item.medallion.h} mm</p>}
          {item.paving && <p className="cl-model-tag">⊞ 파라메트릭 방안 · {PV_TYPES.find((t) => t.v === item.paving!.type)?.name ?? '방안'} · 캔버스 {item.modelSize} · 포설 방식 {item.paving.nodes.filter((n) => n.kind === 'paving').length}개 · 매개변수 {item.paving.params.length}개{item.paving.label ? ' · 표기 미리보기 있음' : ''}</p>}
          {item.tilePattern && <p className="cl-model-tag">▩ 타일 배열 패턴 · {item.tilePattern.template} · 타일 {Object.keys(item.tilePattern.tiles).length}종</p>}
          {(item.tile?.pbr ?? item.shaped?.pbr) && <p className="cl-model-tag">◍ 실시간 재질 세부 조정 · 바꾼 값 {Object.keys((item.tile?.pbr ?? item.shaped?.pbr)!.values).length}개</p>}
          {item.tile && <p className="cl-model-tag">▤ 타일 상품 · 줄눈 {item.tile.gapWidth}mm {item.tile.gapColor}{item.tile.faces ? ` · 면 ${item.tile.faces.length}장` : ''}{item.tile.order ? ` · 맞춤 배열 ${item.tile.order.rows}×${item.tile.order.cols}` : ''}</p>}
          <div className="cl-detail-ops">
            <div className="cl-dd">
              <button className="btn-ghost" onClick={() => setMenu((m) => !m)}>소재 관리 ▾</button>
              {menu && <div className="cl-dd-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setPanel('cover'); setMenu(false); }}>표지 설정</button>
                <button onClick={() => { setPanel('size'); setMenu(false); }}>모델 크기 수정</button>
                <button disabled title="에디터 연동 후 사용">모델 분할</button>
                {onEditPaving && <button onClick={() => { setMenu(false); onEditPaving(); }}>방안 편집 (파라메트릭 편집기)</button>}
                {onEditModel
                  ? <button onClick={() => { setMenu(false); onEditModel(); }}>모델 설정 (에디터)</button>
                  : <button disabled title={MODELING_EDITOR_ENABLED ? '파라메트릭 모델 상품만 에디터로 편집할 수 있습니다' : '에디터 미사용'}>모델 설정</button>}
                <button disabled title="에디터 연동 후 사용">3D 재질 교체</button>
                <button disabled title="에디터 연동 후 사용">범례 태그</button>
              </div>}
            </div>
            {onEditPaving && <button className="btn-ghost" onClick={onEditPaving}>방안 편집</button>}
            <button className="btn-ghost" onClick={() => onPatch({ kupinshow: !item.kupinshow }, item.kupinshow ? '3D 쇼룸 해제' : '3D 쇼룸 생성')}>{item.kupinshow ? '3D 쇼룸 해제' : '3D 쇼룸 생성'}</button>
            <button className="btn-ghost" onClick={() => setPanel(panel === 'related' ? null : 'related')}>관련 상품</button>
            <button className="btn-ghost" onClick={() => setPanel(panel === 'history' ? null : 'history')}>작업 이력</button>
          </div>
          {panel === 'cover' && <div className="cl-side-panel">
            <div className="cl-label">표지 이미지 교체</div>
            <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onPatch({ img: await fileToThumb(f) }, '표지 변경'); }} />
          </div>}
          {panel === 'size' && <div className="cl-side-panel">
            <div className="cl-label">모델 크기 (W X D X H mm)</div>
            <div className="cl-inline2"><input className="inline-input full" value={size} onChange={(e) => setSize(e.target.value)} /><button className="btn-mini" onClick={() => { onPatch({ modelSize: size }, '모델 크기 수정'); setPanel(null); }}>적용</button></div>
          </div>}
          {panel === 'history' && <div className="cl-side-panel">
            <div className="cl-label">작업 이력</div>
            <ul className="cl-history">{history.slice().reverse().map((h, i) => <li key={i}><span className="num-inline">{fmtDate(h.at, true)}</span> {h.by} · {h.action}</li>)}{!history.length && <li className="cl-muted">이 화면에서 기록된 이력이 없습니다.</li>}</ul>
          </div>}
          {panel === 'related' && <div className="cl-side-panel">
            <div className="cl-label">같은 시리즈·모델 상품</div>
            <ul className="cl-related">{related.map((r) => <li key={r.id}><button onClick={() => onOpen(r.id)}>{r.img && <img src={r.img} alt="" />}<span>{r.name}</span></button></li>)}{!related.length && <li className="cl-muted">관련 상품이 없습니다.</li>}</ul>
          </div>}
        </div>
        <div className="cl-detail-main">
          <div className="cl-detail-title"><h3>{item.name}</h3><button className="btn-primary" onClick={onEdit}>편집</button></div>
          <dl>
            <Row k="생성 시간" v={fmtDate(item.created, true)} />
            <Row k="생성자" v={item.creator} />
            <Row k="상품 ID" v={<><span className="num-inline">{item.id}</span> <button className="link-mini" onClick={() => void navigator.clipboard?.writeText(item.id)}>복사</button></>} />
          </dl>
          <h4>사용 설정</h4>
          <dl><Row k="도구 노출" v={yn(item.visible)} /><Row k="전경도 표시" v={yn(item.panorama)} /></dl>
          <h4>소재 정보</h4>
          <dl><Row k="렌더 분류" v={item.renderCat} /><Row k="모델 크기" v={item.modelSize} /><Row k="모델 크기 잠금" v={yn(item.sizeLock)} /><Row k="배치 위치" v={item.location} /></dl>
          <h4>상품 정보</h4>
          <dl>
            <Row k="모델번호" v={item.model} /><Row k="상품코드" v={item.code} />
            <Row k="브랜드·시리즈" v={item.brand ? `${item.brand} | ${item.series}` : ''} />
            <Row k="권한 부여 대상" v={(item.authorizedTo ?? []).join(', ')} />
            <Row k="상품 크기" v={item.size} /><Row k="재질" v={item.material} />
            <Row k="판매가" v={item.price == null ? '' : `${item.price.toLocaleString()} KRW`} /><Row k="단위" v={item.unit} />
            <Row k="구매 링크" v={item.buyLink ? <a href={item.buyLink} target="_blank" rel="noreferrer">{item.buyLink}</a> : ''} />
            <Row k="설명" v={item.description} />
            <Row k="태그" v={item.tags.map((t) => <span key={t} className="tag">{t}</span>)} />
          </dl>
          <h4>사용자 정의 정보</h4>
          <dl>
            {customFields.map((f) => <div key={f.id} className="cl-dl"><dt title={f.description}>{f.name}<small>{f.description !== f.name ? f.description : ''}</small></dt>
              <dd><input className="inline-input full" value={custom[f.id] ?? ''} placeholder="-" onChange={(e) => setCustom({ ...custom, [f.id]: e.target.value })}
                onBlur={() => { if ((item.custom ?? {})[f.id] !== custom[f.id]) onPatch({ custom }, `사용자 정의 '${f.name}' 수정`); }} /></dd></div>)}
          </dl>
          <h4>상품 위치</h4>
          <p className="cl-path">{path.join(' › ')}</p>
          <h4>실물 이미지 관리 <small>설계 툴·전경도에 표시 (1:1 권장)</small></h4>
          <div className="cl-photos">
            {photos.map((p, i) => <figure key={i}><img src={p} alt="" /><button aria-label="삭제" onClick={() => onPatch({ photos: photos.filter((_, j) => j !== i) }, '실물 이미지 삭제')}>×</button></figure>)}
            <label className="cl-photo-add">+<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) onPatch({ photos: [...photos, await fileToThumb(f)] }, '실물 이미지 추가'); }} /></label>
          </div>
          <h4>상세 소개</h4>
          <textarea className="inline-input full" rows={3} placeholder="마케팅 화면에 보여줄 소개 문구" value={detail} onChange={(e) => setDetail(e.target.value)}
            onBlur={() => onPatch({ detailText: detail }, '상세 소개 수정')} />
          <h4>관련 방안</h4>
          <p className="cl-muted" style={{ fontSize: '0.8rem' }}>이 상품을 쓴 HP3 도면 — 설계 연동 후 표시됩니다.</p>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────── 새 라이브러리 ───────────────────────── */

export function NewLibraryModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [n, setN] = useState('');
  return (
    <Modal title="새 상품 라이브러리" onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>취소</button><button className="btn-primary" style={{ marginLeft: 0 }} disabled={!n.trim()} onClick={() => onCreate(n.trim())}>만들기</button></>}>
      <p className="cl-note">기업 라이브러리와 별도로 상품을 모아 특정 조직·외부 계정에만 공개할 때 씁니다.</p>
      <div className="cl-form"><Field label="* 이름"><input className="inline-input full" maxLength={12} autoFocus value={n} onChange={(e) => setN(e.target.value)} /><small>{n.length}/12</small></Field></div>
    </Modal>
  );
}
