import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './contentLibrary.css';
import { Pagination, usePagination } from '../../components/Pagination';
import { SearchIcon } from '../../components/icons';
import { useConfirm } from '../../components/confirm';
import {
  BASE_COLUMNS, BATCH_FIELDS, BIZ_TABS, DEFAULT_VISIBLE_COLUMNS,
  findFolderPath, findModelItem, fmtDate, folderIdsWithChildren, itemsOf, libName, loadContentState, mapFolders, newId, newItem, resetContentState,
  saveContentState, tabOfLib, uncategorizedFolder, upsertModelItem, walkFolders, withItems,
  type BatchField, type BizTab, type ColumnKey, type ContentState, type Folder, type Item, type ToolbarKey,
} from '../../data/contentLibrary';
import type { CreatePortal } from '../../data/contentCreate';
import { putAsset } from '../../data/assetStore';
import { MODELING_EDITOR_ENABLED } from '../../pm/editorFlag';
import type { ModelOpenRequest, ModelResult } from '../../pm/link';
import { PmEditorOverlay } from '../pm/PmEditorOverlay';
import {
  AddToModal, AuthorizeModal, BatchEditModal, CreateMaterialModal, DetailModal, FolderPickModal,
  ImportExportModal, LibraryManageModal, Modal, NewLibraryModal, QuickEditModal, SettingsModal,
} from './ContentModals';
import { CreatePage } from './CreatePages';
import { PavingEditor } from './paving/PavingEditor';
import { pavingItemPatch } from './paving/pavingUtil';
import type { CreateOpts, NewItemDraft } from './createTypes';

/**
 * 컨텐츠 라이브러리 — 쿠지알러 ‘기업 상품 라이브러리(企业商品库)’ 분석을 바탕으로 만든 HP3 상품·소재 관리 화면.
 * 분석 문서: public/kujiale-brandgoods-analysis.html
 *
 * 화면 구성: 라이브러리 탭 → 업무 탭 → [좌] 소재 라이브러리·폴더 트리·휴지통 / [우] 툴바·목록(표/카드)·페이지.
 * 자동저장 없음 — 상단 ‘저장’ 버튼으로만 localStorage 에 영속화한다.
 */

type Filters = {
  visible: 'all' | 'y' | 'n';
  brandId: string;
  seriesId: string;
  partner: string;
  render: 'all' | 'running' | 'done' | 'fail';
  pub: 'all' | 'y' | 'n';
  tags: string[];
};
const NO_FILTER: Filters = { visible: 'all', brandId: '', seriesId: '', partner: '', render: 'all', pub: 'all', tags: [] };
type SortKey = 'newest' | 'oldest' | 'az' | 'za';
const SORT_LABEL: Record<SortKey, string> = { newest: '생성 시간 (최신순)', oldest: '생성 시간 (오래된순)', az: '이름 (가나다순)', za: '이름 (역순)' };
type Scope = 'all' | 'name' | 'model' | 'code';
const SCOPE_LABEL: Record<Scope, string> = { all: '전체', name: '이름', model: '모델번호', code: '상품코드' };

const VIEW_KEY = 'hp3-content-view';
const COL_KEY = 'hp3-content-columns';
const readLocal = <T,>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fb; } catch { return fb; } };
const writeLocal = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 브라우저 저장소 차단 시 무시 */ } };

/** 툴바 드롭다운 */
function Dropdown({ label, disabled, children }: { label: string; disabled?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 바깥을 누르면 닫힘
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="cl-dd" ref={ref}>
      <button className="btn-ghost" disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open && <div className="cl-dd-menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function ContentLibrary({ userName }: { userName: string }) {
  const [st, setSt] = useState<ContentState | null>(null);
  const [err, setErr] = useState('');
  const savedSig = useRef('');
  useEffect(() => {
    loadContentState().then((s) => { savedSig.current = JSON.stringify(s); setSt(s); }).catch((e: Error) => setErr(e.message));
  }, []);
  const sig = useMemo(() => (st ? JSON.stringify(st) : ''), [st]);
  const dirty = !!st && sig !== savedSig.current;
  const save = () => {
    if (!st) return;
    try { saveContentState(st); savedSig.current = sig; setToast('저장했습니다'); setSt({ ...st }); }
    catch { setToast('브라우저 저장 공간이 부족해 저장하지 못했습니다'); }
  };

  const [tabKey, setTabKey] = useState(BIZ_TABS[0].key);
  const tab = BIZ_TABS.find((t) => t.key === tabKey)!;
  const [libNo, setLibNo] = useState(tab.libs[0].lib);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([`L${tab.libs[0].lib}`]));
  const [folderQ, setFolderQ] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [sort, setSort] = useState<SortKey>('newest');
  const [view, setView] = useState<'list' | 'card'>(() => readLocal(VIEW_KEY, 'list'));
  const [cols, setCols] = useState<ColumnKey[]>(() => readLocal(COL_KEY, DEFAULT_VISIBLE_COLUMNS));
  const [withSub, setWithSub] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => writeLocal(VIEW_KEY, view), [view]);
  useEffect(() => writeLocal(COL_KEY, cols), [cols]);

  type ModalState =
    | null | { k: 'quick' | 'detail'; id: string } | { k: 'batch'; field: BatchField } | { k: 'pick'; mode: 'add' | 'move' | 'saveAs' }
    | { k: 'addTo'; kind: 'package' | 'style' } | { k: 'filter' | 'columns' | 'settings' | 'io' | 'libManage' | 'create' | 'authorize' | 'newLib' | 'newFolder' }
    | { k: 'renameFolder' | 'coverFolder'; id: string } | { k: 'subFolder'; parent: string | null };
  const [modal, setModal] = useState<ModalState>(null);
  /** 컨텐츠 제작 카드의 생성 화면 / 파라메트릭 모델 에디터 */
  const [creating, setCreating] = useState<{ tab: BizTab; portal: CreatePortal } | null>(null);
  const [editorReq, setEditorReq] = useState<ModelOpenRequest | null>(null);
  /** 파라메트릭 편집기로 고치는 방안 상품 id */
  const [pavingEdit, setPavingEdit] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ id: string | null; lib: number; x: number; y: number } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  /* ── 파생 데이터 ── */
  const activeLib = st?.libraries.find((l) => l.id === st.activeLibrary);
  const allItems = useMemo(() => (!st ? [] : st.activeLibrary === 'main' ? st.items : st.extraItems[st.activeLibrary] ?? []), [st]);
  const trees = useMemo(() => st?.trees[st.activeLibrary] ?? {}, [st]);
  const tree = trees[libNo] ?? [];
  const tabLibs = tab.libs.map((l) => l.lib);

  const scopeItems = useMemo(() => {
    if (trash) return allItems.filter((i) => i.deletedAt && tabLibs.includes(i.lib));
    const live = allItems.filter((i) => !i.deletedAt && i.lib === libNo);
    if (!folderId) return live;
    const f = findFolderPath(tree, folderId)?.at(-1);
    const ids = new Set(f ? (withSub ? folderIdsWithChildren(f) : [f.id]) : [folderId]);
    return live.filter((i) => ids.has(i.folder) || (i.extraFolders ?? []).some((x) => ids.has(x)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, trash, libNo, folderId, tree, withSub, tabKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (i: Item) => {
      if (!q) return true;
      const f = { name: i.name, model: i.model, code: i.code };
      return scope === 'all' ? [f.name, f.model, f.code, i.id].some((v) => v.toLowerCase().includes(q)) : f[scope].toLowerCase().includes(q);
    };
    const out = scopeItems.filter((i) => hit(i)
      && (filters.visible === 'all' || i.visible === (filters.visible === 'y'))
      && (!filters.brandId || i.brandId === filters.brandId)
      && (!filters.seriesId || i.seriesId === filters.seriesId)
      && (!filters.partner || (i.authorizedTo ?? []).includes(filters.partner))
      && (filters.render === 'all' || i.renderState === filters.render)
      && (filters.pub === 'all' || i.public === (filters.pub === 'y'))
      && (!filters.tags.length || filters.tags.every((t) => i.tags.includes(t))));
    const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
      newest: (a, b) => b.created - a.created, oldest: (a, b) => a.created - b.created,
      az: (a, b) => a.name.localeCompare(b.name, 'ko'), za: (a, b) => b.name.localeCompare(a.name, 'ko'),
    };
    return out.sort((a, b) => (trash ? (b.deletedAt ?? 0) - (a.deletedAt ?? 0) : Number(b.top) - Number(a.top) || cmp[sort](a, b)));
  }, [scopeItems, query, scope, filters, sort, trash]);

  const resetKey = `${tabKey}|${libNo}|${folderId}|${trash}|${query}|${scope}|${JSON.stringify(filters)}|${sort}|${st?.activeLibrary}`;
  const { page, setPage, pageSize, setPageSize, pageCount, start, end } = usePagination(filtered.length, resetKey);
  const pageItems = filtered.slice(start, end);
  useEffect(() => setSelected(new Set()), [resetKey]);
  const selItems = allItems.filter((i) => selected.has(i.id));
  const filterCount = (filters.visible !== 'all' ? 1 : 0) + (filters.brandId ? 1 : 0) + (filters.partner ? 1 : 0) + (filters.render !== 'all' ? 1 : 0) + (filters.pub !== 'all' ? 1 : 0) + filters.tags.length;

  /** 폴더별 상품 수 (하위 포함) */
  const folderCounts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const i of allItems) if (!i.deletedAt) for (const f of [i.folder, ...(i.extraFolders ?? [])]) direct.set(f, (direct.get(f) ?? 0) + 1);
    const total = new Map<string, number>();
    const sum = (f: Folder): number => { const n = (direct.get(f.id) ?? 0) + (f.children ?? []).reduce((a, c) => a + sum(c), 0); total.set(f.id, n); return n; };
    for (const t of Object.values(trees)) for (const f of t) sum(f);
    return total;
  }, [allItems, trees]);
  const libCount = (lib: number) => allItems.filter((i) => !i.deletedAt && i.lib === lib).length;
  const trashCount = allItems.filter((i) => i.deletedAt && tabLibs.includes(i.lib)).length;

  /* ── 변경 헬퍼 ── */
  const mutateItems = (fn: (list: Item[]) => Item[]) => setSt((s) => {
    if (!s) return s;
    return s.activeLibrary === 'main' ? { ...s, items: fn(s.items) } : { ...s, extraItems: { ...s.extraItems, [s.activeLibrary]: fn(s.extraItems[s.activeLibrary] ?? []) } };
  });
  const log = (ids: string[], action: string) => setSt((s) => {
    if (!s) return s;
    const h = { ...s.history };
    for (const id of ids) h[id] = [...(h[id] ?? []), { at: Date.now(), by: userName, action }].slice(-30);
    return { ...s, history: h };
  });
  const patchItems = (ids: string[], patch: (i: Item) => Partial<Item>, action: string) => {
    const set = new Set(ids);
    mutateItems((list) => list.map((i) => (set.has(i.id) ? { ...i, ...patch(i), modified: Date.now() } : i)));
    log(ids, action);
  };
  const setTree = (lib: number, fn: (t: Folder[]) => Folder[]) => setSt((s) => s && ({ ...s, trees: { ...s.trees, [s.activeLibrary]: { ...s.trees[s.activeLibrary], [lib]: fn(s.trees[s.activeLibrary]?.[lib] ?? []) } } }));
  const ids = [...selected];
  const done = (msg: string) => { setModal(null); setSelected(new Set()); setToast(msg); };

  /* ── 탐색 ── */
  const pickTab = (k: string) => {
    const t = BIZ_TABS.find((x) => x.key === k)!;
    setTabKey(k); setLibNo(t.libs[0].lib); setFolderId(null); setTrash(false);
    setExpanded(new Set([`L${t.libs[0].lib}`]));
  };
  const pickLib = (lib: number) => { setLibNo(lib); setFolderId(null); setTrash(false); };
  const toggle = (key: string) => setExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const openFolder = (lib: number, id: string) => {
    setLibNo(lib); setFolderId(id); setTrash(false);
    const path = findFolderPath(trees[lib] ?? [], id) ?? [];
    setExpanded((s) => new Set([...s, `L${lib}`, ...path.slice(0, -1).map((f) => f.id)]));
  };
  const crumbs = folderId ? findFolderPath(tree, folderId) ?? [] : [];

  /* ── 컨텐츠 제작 ── */
  const showMade = (item: Item, msg: string) => {
    setTabKey(tabOfLib(item.lib).key); openFolder(item.lib, item.folder);
    setToast(msg);
  };
  /**
   * 업로드 화면 결과 — 폴더를 정하지 않은 소재는 그 라이브러리의 ‘미분류’로.
   * keep(계속 올리기): 화면을 닫지 않음 / detail(완료): 새 상품 상세를 연다
   */
  const addDrafts = (drafts: NewItemDraft[], msg: string, via: string, opts?: CreateOpts): string[] => createItems(drafts, msg, via, opts).map((i) => i.id);
  const createItems = (drafts: NewItemDraft[], msg: string, via: string, opts?: CreateOpts): Item[] => {
    if (!st) return [];
    let s = st;
    const made: Item[] = [];
    for (const d of drafts) {
      let folder = d.folder;
      if (!folder) { const u = uncategorizedFolder(s, d.lib); s = u.state; folder = u.folder; }
      made.push(newItem(s, { ...d, folder }, userName));
    }
    const now = Date.now();
    const history = { ...s.history };
    for (const i of made) history[i.id] = [{ at: now, by: userName, action: `컨텐츠 제작: ${via}` }];
    setSt(withItems({ ...s, history }, [...made, ...itemsOf(s)]));
    if (opts?.silent) return made;
    if (opts?.keep) { setToast(`${msg} — 이어서 올릴 수 있습니다 (상단 ‘저장’으로 영구 반영)`); return made; }
    setCreating(null);
    if (made[0]) {
      showMade(made[0], `${msg} — 상단 ‘저장’으로 영구 반영`);
      if (opts?.detail) setModal({ k: 'detail', id: made[0].id });
    }
    return made;
  };
  /** 에디터 ‘저장 후 입고’ — 모델 유형 선택에서 고른 라이브러리의 ‘미분류’에 상품을 만들거나 갱신 */
  const onModelDone = async (r: ModelResult) => {
    if (!st || r.lib == null) return;
    const ex = findModelItem(st, r.id);
    const asset = r.glb ? (ex?.model3d?.asset ?? newId('GLB')) : ex?.model3d?.asset;
    if (r.glb && asset) await putAsset(asset, r.glb);
    const res = upsertModelItem(st, { id: r.id, name: r.name, lib: r.lib, categoryId: r.categoryId, category: r.category, thumb: r.thumb, bbox: r.bbox, asset }, userName);
    setSt(res.state);
    setEditorReq(null);
    showMade(res.item, res.created
      ? `‘${res.item.name}’을(를) ${libName(res.item.lib)} › 미분류에 입고했습니다 (${r.category}) — 상단 ‘저장’으로 영구 반영`
      : `‘${res.item.name}’ 상품의 모델을 갱신했습니다 — 상단 ‘저장’으로 영구 반영`);
  };
  const editModel = (i: Item) => { if (i.model3d?.kind === 'param') setEditorReq({ mode: 'edit', id: i.model3d.id }); };

  /* ── 폴더 작업 ── */
  const addFolder = (lib: number, parent: string | null, name: string) => {
    const f: Folder = { id: newId('F'), name };
    setTree(lib, (t) => (parent ? mapFolders(t, parent, (p) => ({ ...p, children: [...(p.children ?? []), f] })) : [...t, f]));
    if (parent) setExpanded((s) => new Set([...s, parent]));
    setToast(`‘${name}’ 폴더를 만들었습니다`);
  };
  const deleteFolder = (lib: number, id: string) => {
    const f = findFolderPath(trees[lib] ?? [], id)?.at(-1);
    if (!f) return;
    const gone = new Set(folderIdsWithChildren(f));
    const fallback = (trees[lib] ?? []).find((x) => !gone.has(x.id))?.id ?? '';
    setTree(lib, (t) => mapFolders(t, id, () => null));
    mutateItems((list) => list.map((i) => (i.lib === lib && gone.has(i.folder) ? { ...i, folder: fallback, extraFolders: (i.extraFolders ?? []).filter((x) => !gone.has(x)) } : i)));
    if (folderId && gone.has(folderId)) setFolderId(null);
    setToast(`‘${f.name}’ 폴더를 삭제했습니다 — 안의 상품은 ‘${(trees[lib] ?? []).find((x) => x.id === fallback)?.name ?? '첫 폴더'}’로 옮겼습니다`);
  };

  /* ── 렌더 ── */
  if (err) return <main className="main"><div className="page-head"><h1>컨텐츠 라이브러리</h1></div><section className="panel"><p className="cl-err">불러오기 실패: {err}</p></section></main>;
  if (!st || !activeLib) return <main className="main"><div className="page-head"><h1>컨텐츠 라이브러리</h1></div><section className="panel"><p className="cl-muted">불러오는 중…</p></section></main>;

  const visibleCols = cols.filter((c) => BASE_COLUMNS.some((b) => b.key === c) || st.customFields.some((f) => `cf:${f.id}` === c));
  const colLabel = (c: ColumnKey) => BASE_COLUMNS.find((b) => b.key === c)?.label ?? st.customFields.find((f) => `cf:${f.id}` === c)?.name ?? c;
  const allPageSelected = pageItems.length > 0 && pageItems.every((i) => selected.has(i.id));
  const subFolders = folderId ? (findFolderPath(tree, folderId)?.at(-1)?.children ?? []) : tree;

  const cell = (i: Item, c: ColumnKey): ReactNode => {
    switch (c) {
      case 'id': return <span className="num-inline cl-id">{i.id}</span>;
      case 'visible': return <button className={`switch${i.visible ? ' on' : ''}`} role="switch" aria-checked={i.visible} aria-label="도구 노출" onClick={(e) => { e.stopPropagation(); patchItems([i.id], () => ({ visible: !i.visible }), i.visible ? '도구 비노출' : '도구 노출'); }} />;
      case 'panorama': return i.panorama ? '예' : '아니오';
      case 'brand': return i.brand ? `${i.brand} / ${i.series}` : '-';
      case 'tags': return i.tags.length ? i.tags.map((t) => <span key={t} className="tag">{t}</span>) : '-';
      case 'price': return i.price == null ? '-' : `${i.price.toLocaleString()}원`;
      case 'buyLink': return i.buyLink ? <a href={i.buyLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>링크</a> : '-';
      case 'public': return i.publicPending ? <span className="pill st-wait">신청중</span> : i.public ? '공개' : '비공개';
      case 'created': return <span className="num-inline">{fmtDate(i.created)}</span>;
      case 'sizeLock': return i.sizeLock ? '예' : '아니오';
      case 'kupinshow': return i.kupinshow ? '예' : '아니오';
      case 'synced': return i.synced.length ? i.synced.join(', ') : '-';
      case 'description': return <span className="cl-ellipsis">{i.description || '-'}</span>;
      default:
        if (c.startsWith('cf:')) return i.custom?.[c.slice(3)] || '-';
        return (i as unknown as Record<string, string>)[c] || '-';
    }
  };

  const toolbarBtn = (key: ToolbarKey): ReactNode => {
    const none = !selected.size;
    switch (key) {
      case 'authorize': return <button key={key} className="btn-ghost" disabled={none} onClick={() => setModal({ k: 'authorize' })}>권한 부여</button>;
      case 'saveAs': return <button key={key} className="btn-ghost" disabled={none} onClick={() => setModal({ k: 'pick', mode: 'saveAs' })}>다른 이름으로 저장</button>;
      case 'folder': return <Dropdown key={key} label="폴더 설정" disabled={none}>{(close) => <>
        <button onClick={() => { close(); setModal({ k: 'pick', mode: 'add' }); }}>폴더에 추가</button>
        <button onClick={() => { close(); setModal({ k: 'pick', mode: 'move' }); }}>폴더로 이동</button>
      </>}</Dropdown>;
      case 'sort': return <Dropdown key={key} label="정렬" disabled={none}>{(close) => <>
        <button onClick={() => { close(); patchItems(ids, () => ({ top: true }), '상단 고정'); done(`${ids.length}개를 상단에 고정했습니다`); }}>상단 고정</button>
        <button onClick={() => { close(); patchItems(ids, () => ({ top: false }), '상단 고정 해제'); done('상단 고정을 해제했습니다'); }}>고정 해제</button>
      </>}</Dropdown>;
      case 'addTo': return <Dropdown key={key} label="추가" disabled={none}>{(close) => <>
        <button onClick={() => { close(); setModal({ k: 'addTo', kind: 'package' }); }}>패키지에 추가</button>
        <button onClick={() => { close(); setModal({ k: 'addTo', kind: 'style' }); }}>스타일에 추가</button>
      </>}</Dropdown>;
      case 'batchEdit': return <Dropdown key={key} label="✎ 일괄 편집" disabled={none}>{(close) => <div className="cl-dd-scroll">
        {BATCH_FIELDS.map((f) => <button key={f.key} onClick={() => { close(); setModal({ k: 'batch', field: f.key }); }}>{f.label}{f.needsEditor && <small> · 에디터</small>}</button>)}
      </div>}</Dropdown>;
      case 'applyPublic': return <button key={key} className="btn-ghost" disabled={none} onClick={() => { patchItems(ids, () => ({ publicPending: true }), '공용 라이브러리 공개 신청'); done(`${ids.length}개 상품 공개 신청을 접수했습니다`); }}>공개 신청</button>;
      case 'delete': return <button key={key} className="btn-ghost danger" disabled={none} title="휴지통으로 이동" onClick={() => confirm({
        message: <>선택한 <b>{ids.length}</b>개 상품을 휴지통으로 옮길까요? 휴지통에서 복원할 수 있습니다.</>, confirmLabel: '휴지통으로',
        onConfirm: () => { patchItems(ids, () => ({ deletedAt: Date.now() }), '삭제(휴지통)'); done(`${ids.length}개를 휴지통으로 옮겼습니다`); },
      })}>🗑 삭제</button>;
    }
  };

  const renderFolder = (lib: number, f: Folder, depth: number): ReactNode => {
    const q = folderQ.trim().toLowerCase();
    const kids = f.children ?? [];
    if (q) {
      const matches = (x: Folder): boolean => x.name.toLowerCase().includes(q) || (x.children ?? []).some(matches);
      if (!matches(f)) return null;
    }
    const open = !!q || expanded.has(f.id);
    const active = !trash && libNo === lib && folderId === f.id;
    return (
      <li key={f.id}>
        <div className={`tree-item cl-tree-item${active ? ' active' : ''}${f.hidden ? ' cl-hidden' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
          role="button" tabIndex={0} onClick={() => openFolder(lib, f.id)} onKeyDown={(e) => { if (e.key === 'Enter') openFolder(lib, f.id); }}>
          <button className={`tree-caret${open ? ' open' : ''}${kids.length ? '' : ' placeholder'}`} aria-label={open ? '접기' : '펼치기'} onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>›</button>
          {f.cover ? <img className="cl-fcover" src={f.cover} alt="" /> : <span aria-hidden="true">📁</span>}
          <span className="t">{f.name}{f.hidden && <small> (숨김)</small>}</span>
          <span className="count">{folderCounts.get(f.id) || ''}</span>
          <button className="cl-more" aria-label={`${f.name} 폴더 메뉴`} onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setFolderMenu({ id: f.id, lib, x: r.right, y: r.bottom }); }}>⋯</button>
        </div>
        {open && kids.length > 0 && <ul className="tree">{kids.map((k) => renderFolder(lib, k, depth + 1))}</ul>}
      </li>
    );
  };

  let lastGroup: string | undefined;
  const menuFolder = folderMenu?.id ? findFolderPath(trees[folderMenu.lib] ?? [], folderMenu.id)?.at(-1) : null;

  return (
    <main className="main cl-main">
      <div className="page-head">
        <h1>컨텐츠 라이브러리</h1>
        <span className="date">상품 {allItems.filter((i) => !i.deletedAt).length.toLocaleString()}개 · 폴더 트리 {Object.values(trees).reduce((a, t) => { let n = 0; walkFolders(t, () => n++); return a + n; }, 0).toLocaleString()}개</span>
        <a className="cl-doc-link" href={`${import.meta.env.BASE_URL}kujiale-brandgoods-analysis.html`} target="_blank" rel="noreferrer">쿠지알러 분석 문서 ↗</a>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }}>● 미저장 변경</span>}
        <button className="btn-ghost" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={save}>저장</button>
        <button className="btn-ghost" title="저장본을 지우고 쿠지알러 시드로 다시 시작" onClick={() => confirm({
          title: '초기화', message: '저장한 컨텐츠 라이브러리 데이터를 지우고 시드 데이터로 다시 불러올까요?', confirmLabel: '초기화',
          onConfirm: () => { resetContentState(); setSt(null); loadContentState().then((s) => { savedSig.current = JSON.stringify(s); setSt(s); }); },
        })}>초기화</button>
      </div>

      {/* 라이브러리 탭 */}
      <div className="cl-libtabs" role="tablist" aria-label="상품 라이브러리">
        {st.libraries.map((l) => (
          <button key={l.id} role="tab" aria-selected={l.id === st.activeLibrary} className={`cl-libtab${l.id === st.activeLibrary ? ' on' : ''}`}
            onClick={() => { setSt({ ...st, activeLibrary: l.id }); setFolderId(null); setTrash(false); }}>
            {l.name}{l.main && <span className="cl-badge">주 라이브러리</span>}
          </button>
        ))}
        <button className="cl-libtab add" onClick={() => setModal({ k: 'newLib' })}>＋ 새 라이브러리</button>
      </div>

      {/* 업무 탭 + 우측 작업 */}
      <div className="cl-bizbar">
        <div className="seg cl-tabs-scroll" role="tablist" aria-label="업무 탭">
          {BIZ_TABS.map((t) => <button key={t.key} role="tab" aria-selected={t.key === tabKey} className={`seg-item${t.key === tabKey ? ' active' : ''}`} onClick={() => pickTab(t.key)}>{t.label}</button>)}
        </div>
        <div className="cl-bizbar-actions">
          <button className="btn-ghost" onClick={() => setModal({ k: 'io' })}>가져오기/내보내기</button>
          <button className="btn-ghost" onClick={() => setModal({ k: 'libManage' })}>라이브러리 관리</button>
          <button className="btn-ghost" onClick={() => setModal({ k: 'settings' })}>설정</button>
          <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => setModal({ k: 'create' })}>＋ 컨텐츠 제작</button>
        </div>
      </div>

      <div className="cl-layout">
        {/* ── 좌측: 소재 라이브러리 · 폴더 트리 ── */}
        <section className="panel cl-side">
          <label className="search inset cl-fsearch"><SearchIcon /><input type="search" placeholder="폴더 검색" aria-label="폴더 검색" value={folderQ} onChange={(e) => setFolderQ(e.target.value)} /></label>
          <ul className="tree cl-tree">
            {tab.libs.map((l) => {
              const head = l.group && l.group !== lastGroup ? <li key={`g-${l.group}`} className="cl-tree-group">{l.group}</li> : null;
              lastGroup = l.group;
              const key = `L${l.lib}`;
              const open = !!folderQ.trim() || expanded.has(key);
              const t = trees[l.lib] ?? [];
              return [head, (
                <li key={key}>
                  <div className={`tree-item cl-tree-item cl-lib${!trash && libNo === l.lib && !folderId ? ' active' : ''}`} role="button" tabIndex={0}
                    onClick={() => { pickLib(l.lib); if (!expanded.has(key)) toggle(key); }} onKeyDown={(e) => { if (e.key === 'Enter') pickLib(l.lib); }}>
                    <button className={`tree-caret${open ? ' open' : ''}`} aria-label={open ? '접기' : '펼치기'} onClick={(e) => { e.stopPropagation(); toggle(key); }}>›</button>
                    <span className="t">{l.name}</span>
                    <span className="count">{libCount(l.lib) || ''}</span>
                    <button className="cl-more" aria-label={`${l.name} 메뉴`} onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setFolderMenu({ id: null, lib: l.lib, x: r.right, y: r.bottom }); }}>⋯</button>
                  </div>
                  {open && <ul className="tree">{t.map((f) => renderFolder(l.lib, f, 1))}</ul>}
                </li>
              )];
            })}
          </ul>
          <div className="cl-trash">
            <div className={`tree-item${trash ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => { setTrash(true); setFolderId(null); }} onKeyDown={(e) => { if (e.key === 'Enter') setTrash(true); }}>
              <span aria-hidden="true">🗑</span><span className="t">휴지통</span><span className="count">{trashCount || ''}</span>
            </div>
          </div>
        </section>

        {/* ── 우측: 목록 ── */}
        <section className="panel cl-content">
          <div className="cl-head-row">
            <nav className="cl-crumb" aria-label="현재 위치">
              {trash ? <b>휴지통</b> : <>
                <button onClick={() => setFolderId(null)}>{libName(libNo)}</button>
                {crumbs.map((f, idx) => <span key={f.id}> › {idx === crumbs.length - 1 ? <b>{f.name}</b> : <button onClick={() => setFolderId(f.id)}>{f.name}</button>}</span>)}
              </>}
              <span className="cl-count">({filtered.length.toLocaleString()})</span>
              <span className="sel-info">선택 {selected.size}개</span>
            </nav>
            <div className="cl-search">
              <select className="inline-input" aria-label="검색 범위" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
              </select>
              <label className="search inset"><SearchIcon /><input type="search" placeholder="이름 / 모델번호 / 상품코드" aria-label="상품 검색" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            </div>
          </div>

          <div className="cl-toolbar">
            <label className="btn-ghost cl-chk"><input type="checkbox" checked={allPageSelected} onChange={(e) => setSelected((s) => { const n = new Set(s); for (const i of pageItems) { if (e.target.checked) n.add(i.id); else n.delete(i.id); } return n; })} /> 현재 페이지 전체 선택</label>
            {trash ? <>
              <button className="btn-ghost" disabled={!selected.size} onClick={() => { patchItems(ids, () => ({ deletedAt: undefined }), '휴지통에서 복원'); done(`${ids.length}개를 복원했습니다`); }}>복원</button>
              <button className="btn-ghost" disabled={!filtered.length} onClick={() => { const all = filtered.map((i) => i.id); patchItems(all, () => ({ deletedAt: undefined }), '휴지통에서 복원'); done(`${all.length}개를 모두 복원했습니다`); }}>전체 복원</button>
              <button className="btn-ghost danger" disabled={!selected.size} onClick={() => confirm({
                message: <>선택한 <b>{ids.length}</b>개 상품을 영구 삭제할까요? 되돌릴 수 없습니다.</>, confirmLabel: '영구 삭제',
                onConfirm: () => { const s = new Set(ids); mutateItems((list) => list.filter((i) => !s.has(i.id))); done(`${ids.length}개를 영구 삭제했습니다`); },
              })}>영구 삭제</button>
            </> : <>
              {st.settings.toolbar.filter((t) => t.visible).map((t) => toolbarBtn(t.key))}
              {tab.extraActions?.includes('render') && <button className="btn-ghost" disabled={!selected.size} onClick={() => { patchItems(ids, () => ({ renderState: 'running' }), '렌더링 요청'); done(`${ids.length}개 렌더링을 요청했습니다`); setTimeout(() => patchItems(ids, () => ({ renderState: 'done' }), '렌더링 완료'), 2500); }}>렌더링</button>}
              {tab.extraActions?.includes('stock') && <button className="btn-ghost" disabled={!selected.size} onClick={() => { patchItems(ids, () => ({ visible: true }), '입고(도구 노출)'); done(`${ids.length}개를 입고 처리했습니다`); }}>입고</button>}
              {tab.extraActions?.includes('partUpdate') && <button className="btn-ghost" disabled={!selected.size} onClick={() => { log(ids, '부품 업데이트 요청'); done(`${ids.length}개 부품 업데이트를 요청했습니다`); }}>부품 업데이트</button>}
            </>}
            <span className="cl-spacer" />
            <div className="cl-dd">
              <button className={`btn-ghost${filterCount ? ' cl-on' : ''}`} onClick={() => setModal({ k: 'filter' })}>필터{filterCount ? ` ${filterCount}` : ''} ▾</button>
            </div>
            {!trash && <select className="inline-input cl-sort" aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>}
            <div className="seg" role="tablist" aria-label="보기 방식">
              <button className={`seg-item${view === 'card' ? ' active' : ''}`} aria-label="카드 보기" onClick={() => setView('card')}>▦</button>
              <button className={`seg-item${view === 'list' ? ' active' : ''}`} aria-label="표 보기" onClick={() => setView('list')}>☰</button>
            </div>
          </div>
          {!trash && folderId && <label className="check-item cl-withsub"><input type="checkbox" checked={withSub} onChange={(e) => setWithSub(e.target.checked)} /> 하위 폴더 상품 포함</label>}

          {/* 내용 영역 하위 폴더 (설정: 콘텐츠 표시) */}
          {!trash && st.settings.showFoldersInContent && subFolders.length > 0 && (
            <div className="cl-subfolders">
              {subFolders.map((f) => <button key={f.id} onClick={() => openFolder(libNo, f.id)}>{f.cover ? <img src={f.cover} alt="" /> : <span>📁</span>}<b>{f.name}</b><small>{folderCounts.get(f.id) ?? 0}</small></button>)}
            </div>
          )}

          {view === 'list' ? (
            <div className="cl-table-wrap">
              <table className="cl-table cl-list">
                <thead>
                  <tr>
                    <th className="w-check" />
                    {visibleCols.map((c) => <th key={c} className={c === 'name' ? 'cl-col-name' : ''}>{colLabel(c)}</th>)}
                    <th className="cl-col-op">작업 <button className="cl-gear" aria-label="컬럼 설정" onClick={() => setModal({ k: 'columns' })}>⚙</button></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((i) => (
                    <tr key={i.id} className={selected.has(i.id) ? 'cl-sel' : ''} onClick={() => setModal({ k: 'detail', id: i.id })}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`${i.name} 선택`} checked={selected.has(i.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} /></td>
                      {visibleCols.map((c) => c === 'name'
                        ? <td key={c} className="cl-col-name"><div className="cl-namecell">{i.img ? <img src={i.img} alt="" loading="lazy" /> : <span className="cl-noimg">없음</span>}<span>{i.top && <span className="cl-top">고정</span>}{i.name}{i.renderState === 'running' && <span className="pill st-run">렌더링중</span>}{trash && <small className="cl-muted"> · 삭제 {fmtDate(i.deletedAt, true)}</small>}</span></div></td>
                        : <td key={c}>{cell(i, c)}</td>)}
                      <td className="cl-col-op" onClick={(e) => e.stopPropagation()}>
                        {trash ? <button className="link-mini" onClick={() => { patchItems([i.id], () => ({ deletedAt: undefined }), '휴지통에서 복원'); setToast('복원했습니다'); }}>복원</button>
                          : <>
                            <button className="link-mini" onClick={() => setModal({ k: 'quick', id: i.id })}>빠른 편집</button>
                            {MODELING_EDITOR_ENABLED && i.model3d?.kind === 'param' && <button className="link-mini" onClick={() => editModel(i)}>모델 편집</button>}
                            {i.paving && <button className="link-mini" onClick={() => setPavingEdit(i.id)}>방안 편집</button>}
                          </>}
                      </td>
                    </tr>
                  ))}
                  {!pageItems.length && <tr><td colSpan={visibleCols.length + 2} className="empty-row">{trash ? '휴지통이 비어 있습니다.' : <>상품이 없습니다. <b>＋ 컨텐츠 제작</b> 또는 <b>가져오기</b>로 추가하세요.</>}</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="cl-grid">
              {pageItems.map((i) => (
                <article key={i.id} className={`cl-card${selected.has(i.id) ? ' sel' : ''}`} onClick={() => setModal({ k: 'detail', id: i.id })}>
                  <div className="cl-card-img">
                    {i.img ? <img src={i.img} alt="" loading="lazy" /> : <span>이미지 없음</span>}
                    <input type="checkbox" aria-label={`${i.name} 선택`} checked={selected.has(i.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                    {i.top && <span className="cl-top">고정</span>}
                    {!i.visible && <span className="cl-hidden-badge">비노출</span>}
                    {trash
                      ? <button className="cl-card-op" onClick={(e) => { e.stopPropagation(); patchItems([i.id], () => ({ deletedAt: undefined }), '휴지통에서 복원'); setToast('복원했습니다'); }}>복원</button>
                      : <button className="cl-card-op" onClick={(e) => { e.stopPropagation(); setModal({ k: 'quick', id: i.id }); }}>빠른 편집</button>}
                  </div>
                  <div className="cl-card-name">{i.name}</div>
                </article>
              ))}
              {!pageItems.length && <p className="empty-block">{trash ? '휴지통이 비어 있습니다.' : '상품이 없습니다.'}</p>}
            </div>
          )}
          <Pagination page={page} pageCount={pageCount} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={setPageSize} />
        </section>
      </div>

      {/* 폴더 ⋯ 메뉴 */}
      {folderMenu && !modal && (
        <>
          <div className="folder-menu-backdrop" onClick={() => setFolderMenu(null)} />
          <div className="folder-menu cl-folder-menu" style={{ left: folderMenu.x - 150, top: folderMenu.y + 4 }}>
            <button onClick={() => { setModal({ k: 'subFolder', parent: folderMenu.id }); }}>{folderMenu.id ? '하위 폴더 만들기' : '폴더 만들기'}</button>
            {menuFolder && <>
              <button onClick={() => setModal({ k: 'renameFolder', id: menuFolder.id })}>이름 변경</button>
              <button onClick={() => setModal({ k: 'coverFolder', id: menuFolder.id })}>표지 설정</button>
              <button onClick={() => { const id = menuFolder.id; setTree(folderMenu.lib, (t) => mapFolders(t, id, (f) => ({ ...f, hidden: !f.hidden }))); setFolderMenu(null); setToast(menuFolder.hidden ? '폴더를 다시 보이게 했습니다' : '폴더를 숨겼습니다 — 설계 툴에서 보이지 않습니다'); }}>{menuFolder.hidden ? '폴더 보이기' : '폴더 숨기기'}</button>
              <div className="folder-menu-div" />
              <button className="danger" onClick={() => { const { lib } = folderMenu; const id = menuFolder.id; setFolderMenu(null); confirm({ message: <>‘{menuFolder.name}’ 폴더와 하위 폴더를 삭제할까요? 안의 상품은 첫 폴더로 옮겨집니다.</>, onConfirm: () => deleteFolder(lib, id) }); }}>삭제</button>
            </>}
          </div>
        </>
      )}

      {/* ── 모달 ── */}
      {modal?.k === 'subFolder' && <NameModal title={modal.parent ? '하위 폴더 만들기' : '폴더 만들기'} onClose={() => { setModal(null); setFolderMenu(null); }}
        onOk={(n) => { addFolder(folderMenu?.lib ?? libNo, modal.parent, n); setModal(null); setFolderMenu(null); }} />}
      {modal?.k === 'renameFolder' && folderMenu && <NameModal title="폴더 이름 변경" initial={menuFolder?.name} onClose={() => { setModal(null); setFolderMenu(null); }}
        onOk={(n) => { setTree(folderMenu.lib, (t) => mapFolders(t, modal.id, (f) => ({ ...f, name: n }))); setModal(null); setFolderMenu(null); }} />}
      {modal?.k === 'coverFolder' && folderMenu && (() => {
        const f = findFolderPath(trees[folderMenu.lib] ?? [], modal.id)?.at(-1);
        const idsIn = new Set(f ? folderIdsWithChildren(f) : []);
        const imgs = [...new Set(allItems.filter((i) => idsIn.has(i.folder) && i.img).map((i) => i.img))].slice(0, 24);
        const setCover = (cover?: string) => { setTree(folderMenu.lib, (t) => mapFolders(t, modal.id, (x) => ({ ...x, cover }))); setModal(null); setFolderMenu(null); };
        return (
          <Modal title={`표지 설정 · ${f?.name ?? ''}`} onClose={() => { setModal(null); setFolderMenu(null); }} size="wide"
            actions={<button className="btn-ghost" onClick={() => setCover(undefined)}>표지 비우기</button>}>
            <div className="cl-cover-grid">{imgs.map((src) => <button key={src} className={f?.cover === src ? 'on' : ''} onClick={() => setCover(src)}><img src={src} alt="" /></button>)}
              {!imgs.length && <p className="cl-muted">폴더 안에 이미지가 있는 상품이 없습니다.</p>}</div>
          </Modal>
        );
      })()}
      {modal?.k === 'quick' && (() => {
        const it = allItems.find((i) => i.id === modal.id);
        return it ? <QuickEditModal item={it} brands={st.brands} tagGroups={st.tagGroups} onClose={() => setModal(null)}
          onSave={(p) => { patchItems([it.id], () => p, '빠른 편집'); setModal(null); setToast('저장했습니다 — 상단 ‘저장’으로 영구 반영'); }} /> : null;
      })()}
      {modal?.k === 'detail' && (() => {
        const it = allItems.find((i) => i.id === modal.id);
        if (!it) return null;
        const path = [activeLib.name, tabOfLib(it.lib).label, libName(it.lib), ...(findFolderPath(trees[it.lib] ?? [], it.folder) ?? []).map((f) => f.name)];
        const related = allItems.filter((x) => x.id !== it.id && !x.deletedAt && ((it.model && x.model === it.model && x.seriesId === it.seriesId) || (it.name.length > 6 && x.name.startsWith(it.name.slice(0, Math.min(10, it.name.length - 3)))))).slice(0, 12);
        return <DetailModal key={it.id} item={it} path={path} related={related} history={st.history[it.id] ?? []} customFields={st.customFields}
          onClose={() => setModal(null)} onEdit={() => setModal({ k: 'quick', id: it.id })} onOpen={(id) => setModal({ k: 'detail', id })}
          onPatch={(p, action) => patchItems([it.id], () => p, action)}
          onEditModel={MODELING_EDITOR_ENABLED && it.model3d?.kind === 'param' ? () => editModel(it) : undefined}
          onEditPaving={it.paving ? () => { setModal(null); setPavingEdit(it.id); } : undefined} />;
      })()}
      {modal?.k === 'batch' && <BatchEditModal field={modal.field} count={ids.length} brands={st.brands} onClose={() => setModal(null)}
        onApply={(fn) => { const label = BATCH_FIELDS.find((f) => f.key === modal.field)!.label; patchItems(ids, fn, `일괄 편집: ${label}`); done(`${ids.length}개 상품의 ${label}을(를) 바꿨습니다`); }} />}
      {modal?.k === 'authorize' && <AuthorizeModal partners={st.partners} count={ids.length} onClose={() => setModal(null)}
        onApply={(acc, revoke) => { patchItems(ids, (i) => ({ authorizedTo: revoke ? (i.authorizedTo ?? []).filter((a) => !acc.includes(a)) : [...new Set([...(i.authorizedTo ?? []), ...acc])] }), revoke ? `권한 회수: ${acc.join(', ')}` : `권한 부여: ${acc.join(', ')}`); done(revoke ? '권한을 회수했습니다' : `${acc.length}개 계정에 권한을 부여했습니다`); }} />}
      {modal?.k === 'pick' && <FolderPickModal tree={tree} okLabel={modal.mode === 'add' ? '추가' : modal.mode === 'move' ? '이동' : '저장'}
        title={modal.mode === 'add' ? '폴더에 추가' : modal.mode === 'move' ? '폴더로 이동' : '다른 이름으로 저장 (복사본 위치)'} onClose={() => setModal(null)}
        onPick={(fid) => {
          const fname = findFolderPath(tree, fid)?.at(-1)?.name ?? '';
          if (modal.mode === 'add') { patchItems(ids, (i) => ({ extraFolders: [...new Set([...(i.extraFolders ?? []), fid])].filter((x) => x !== i.folder) }), `폴더에 추가: ${fname}`); done(`${ids.length}개를 ‘${fname}’에 추가했습니다`); }
          else if (modal.mode === 'move') { patchItems(ids, () => ({ folder: fid, lib: libNo, extraFolders: [] }), `폴더 이동: ${fname}`); done(`${ids.length}개를 ‘${fname}’로 옮겼습니다`); }
          else {
            const now = Date.now();
            const copies = selItems.map((i) => ({ ...i, id: newId(), name: `${i.name} 복사본`, folder: fid, lib: libNo, extraFolders: [], created: now, modified: now, creator: userName, top: false, public: false, publicPending: false }));
            mutateItems((list) => [...copies, ...list]);
            log(copies.map((c) => c.id), '다른 이름으로 저장');
            done(`${copies.length}개 복사본을 ‘${fname}’에 저장했습니다`);
          }
        }} />}
      {modal?.k === 'addTo' && <AddToModal kind={modal.kind} options={modal.kind === 'package' ? st.packages : st.styles} count={ids.length} onClose={() => setModal(null)}
        onApply={(name, isNew) => {
          const field = modal.kind === 'package' ? 'packages' : 'styles';
          if (isNew) setSt((s) => s && ({ ...s, [field]: [...s[field], name] }));
          patchItems(ids, (i) => ({ [field]: [...new Set([...(i[field] ?? []), name])] }), `${modal.kind === 'package' ? '패키지' : '스타일'} 추가: ${name}`);
          done(`${ids.length}개를 ‘${name}’에 추가했습니다`);
        }} />}
      {modal?.k === 'filter' && <FilterModal st={st} items={scopeItems} value={filters} onClose={() => setModal(null)} onApply={(f) => { setFilters(f); setModal(null); }} />}
      {modal?.k === 'columns' && <ColumnsModal cols={cols} customFields={st.customFields} onClose={() => setModal(null)} onApply={(c) => { setCols(c); setModal(null); }} />}
      {modal?.k === 'settings' && <SettingsModal settings={st.settings} onClose={() => setModal(null)} onSave={(s) => { setSt({ ...st, settings: s }); setModal(null); setToast('설정을 바꿨습니다 — 상단 ‘저장’으로 영구 반영'); }} />}
      {modal?.k === 'io' && <ImportExportModal st={st} tabKey={tabKey} userName={userName} onClose={() => setModal(null)}
        onLog={(e) => setSt((s) => s && ({ ...s, logs: [e, ...s.logs] }))}
        onImportFolders={(paths, lib) => {
          // 갱신 결과를 먼저 계산해 생성 수를 정확히 돌려준다 (setState 업데이트 함수는 지연 실행)
          let next = trees[lib] ?? [];
          let created = 0;
          for (const p of paths) {
            let level = next; let parent: string | null = null;
            for (const name of p) {
              const found = level.find((f) => f.name === name);
              if (found) { parent = found.id; level = found.children ?? []; continue; }
              const nf: Folder = { id: newId('F'), name };
              created++;
              next = parent ? mapFolders(next, parent, (x) => ({ ...x, children: [...(x.children ?? []), nf] })) : [...next, nf];
              parent = nf.id; level = [];
            }
          }
          setTree(lib, () => next);
          return created;
        }}
        onImportItems={(rows, lib, folder) => {
          const byId = new Map(allItems.map((i) => [i.id, i]));
          let created = 0, updated = 0;
          const now = Date.now();
          const fromRow = (r: Record<string, string>): Partial<Item> => {
            const p: Partial<Item> = {};
            const map: [string, keyof Item][] = [['상품명', 'name'], ['모델번호', 'model'], ['상품코드', 'code'], ['상품 크기', 'size'], ['재질', 'material'], ['설명', 'description'], ['구매 링크', 'buyLink'], ['브랜드', 'brand'], ['시리즈', 'series']];
            for (const [h, k] of map) if (r[h]) (p as Record<string, unknown>)[k] = r[h];
            if (r['판매가']) p.price = Number(r['판매가'].replace(/[^\d.]/g, '')) || null;
            if (r['태그']) p.tags = r['태그'].split('|').map((s) => s.trim()).filter(Boolean);
            return p;
          };
          const news: Item[] = [];
          const upd = new Map<string, Partial<Item>>();
          for (const r of rows) {
            const p = fromRow(r);
            const ex = r['상품 ID'] && byId.get(r['상품 ID']);
            if (ex) { upd.set(ex.id, p); updated++; continue; }
            if (!p.name) continue;
            news.push({ id: newId(), img: '', lib, folder, code: '', model: '', brandId: st.brands[0]?.id ?? '', brand: st.brands[0]?.name ?? '', seriesId: '', series: '', renderCat: '', location: '', size: '', modelSize: '', sizeLock: false, material: '', price: null, unit: '개', buyLink: '', appletLink: '', description: '', tags: [], creator: userName, created: now, modified: now, visible: true, panorama: true, public: false, kupinshow: false, top: false, renderState: 'done', synced: [], name: '', ...p } as Item);
            created++;
          }
          mutateItems((list) => [...news, ...list.map((i) => (upd.has(i.id) ? { ...i, ...upd.get(i.id), modified: now } : i))]);
          log([...news.map((n) => n.id), ...upd.keys()], 'CSV 가져오기');
          return { created, updated };
        }} />}
      {modal?.k === 'libManage' && <LibraryManageModal lib={activeLib} onClose={() => setModal(null)}
        onSave={(l) => { setSt({ ...st, libraries: st.libraries.map((x) => (x.id === l.id ? l : x)) }); setModal(null); setToast('라이브러리 정보를 바꿨습니다'); }}
        onDelete={activeLib.main ? undefined : () => confirm({
          message: <>‘{activeLib.name}’ 라이브러리와 안의 상품을 모두 삭제할까요?</>,
          onConfirm: () => {
            const { [activeLib.id]: _t, ...restTrees } = st.trees; const { [activeLib.id]: _i, ...restItems } = st.extraItems;
            void _t; void _i;
            setSt({ ...st, libraries: st.libraries.filter((x) => x.id !== activeLib.id), activeLibrary: 'main', trees: restTrees, extraItems: restItems });
            setModal(null); setToast('라이브러리를 삭제했습니다');
          },
        })} />}
      {modal?.k === 'newLib' && <NewLibraryModal onClose={() => setModal(null)} onCreate={(name) => {
        const id = newId('L');
        const t: Record<number, Folder[]> = {};
        for (const bt of BIZ_TABS) for (const l of bt.libs) t[l.lib] = [{ id: `UNC-${id}-${l.lib}`, name: '미분류' }];
        setSt({ ...st, libraries: [...st.libraries, { id, name, members: [], externalDefaultVisible: false }], activeLibrary: id, trees: { ...st.trees, [id]: t }, extraItems: { ...st.extraItems, [id]: [] } });
        setModal(null); setFolderId(null); setToast(`‘${name}’ 라이브러리를 만들었습니다`);
      }} />}
      {modal?.k === 'create' && <CreateMaterialModal tabKey={tabKey} onClose={() => setModal(null)}
        onPick={(t, p) => {
          setModal(null);
          if (p.kind === 'paramModel') setEditorReq({ mode: 'new', tooltype: p.tooltype! });
          else setCreating({ tab: t, portal: p });
        }} />}
      {creating && <CreatePage tab={creating.tab} portal={creating.portal} st={st} onClose={() => setCreating(null)}
        onCreate={(drafts, msg, opts) => addDrafts(drafts, msg, creating.portal.title, opts)}
        onUpdate={(id, p, action) => patchItems([id], () => p, action)}
        onReveal={(id) => { const it = allItems.find((i) => i.id === id); setCreating(null); if (it) showMade(it, '올린 상품입니다 — 상단 ‘저장’으로 영구 반영'); }} />}
      {editorReq && <PmEditorOverlay request={editorReq} userName={userName} onClose={() => setEditorReq(null)} onDone={(r) => onModelDone(r)}
        onAddItems={(d, msg) => createItems(d, msg, '단면 그리기', { silent: true })} />}
      {pavingEdit && (() => {
        const it = allItems.find((i) => i.id === pavingEdit);
        if (!it?.paving) return null;
        return <PavingEditor key={it.id} init={it.paving} name={it.name} itemId={it.id} folder={it.folder}
          tiles={{ tree: trees[4] ?? [], items: allItems.filter((x) => x.lib === 4 && !x.deletedAt) }} saveTree={trees[it.lib] ?? []}
          onClose={() => setPavingEdit(null)}
          onSave={(r) => {
            const p = pavingItemPatch(r);
            if (r.asNew) return createItems([{ ...p, name: r.name, lib: it.lib }], `‘${r.name}’ 파라메트릭 방안을 만들었습니다`, '파라메트릭 편집기', { silent: true })[0]?.id;
            const id = r.id ?? it.id;
            patchItems([id], () => p, '파라메트릭 편집기: 방안 저장');
            return id;
          }} />;
      })()}

      {confirmDialog}
      {toast && <div className="cl-toast" role="status">{toast}</div>}
    </main>
  );
}

/* ───────────────────────── 보조 모달 ───────────────────────── */

function NameModal({ title, initial = '', onClose, onOk }: { title: string; initial?: string; onClose: () => void; onOk: (name: string) => void }) {
  const [n, setN] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}
      actions={<><button className="btn-ghost" onClick={onClose}>취소</button><button className="btn-primary" style={{ marginLeft: 0 }} disabled={!n.trim()} onClick={() => onOk(n.trim())}>확인</button></>}>
      <input className="inline-input full" autoFocus value={n} maxLength={40} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && n.trim()) onOk(n.trim()); }} />
    </Modal>
  );
}

function Seg<T extends string>({ v, opts, on }: { v: T; opts: [T, string][]; on: (x: T) => void }) {
  return <div className="seg">{opts.map(([k, l]) => <button key={k} className={`seg-item${v === k ? ' active' : ''}`} onClick={() => on(k)}>{l}</button>)}</div>;
}

function FilterModal({ st, items, value, onClose, onApply }: { st: ContentState; items: Item[]; value: Filters; onClose: () => void; onApply: (f: Filters) => void }) {
  const [f, setF] = useState(value);
  const [allGroups, setAllGroups] = useState(false);
  const [tq, setTq] = useState('');
  const present = useMemo(() => new Set(items.flatMap((i) => i.tags)), [items]);
  // 태그 그룹에 없는 상품 태그는 ‘그룹 미지정’으로 묶어 함께 보여준다
  const grouped = new Set(st.tagGroups.flatMap((g) => g.tags));
  const loose = [...present].filter((t) => !grouped.has(t)).sort((a, b) => a.localeCompare(b, 'ko'));
  const groups = [...(loose.length ? [{ id: '__loose', name: '그룹 미지정', single: false, tags: loose }] : []), ...st.tagGroups]
    .map((g) => ({ ...g, tags: g.tags.filter((t) => (allGroups || present.has(t)) && (!tq.trim() || t.toLowerCase().includes(tq.trim().toLowerCase()) || g.name.toLowerCase().includes(tq.trim().toLowerCase()))) }))
    .filter((g) => g.tags.length);
  const brand = st.brands.find((b) => b.id === f.brandId);
  const partners = [...new Set(st.partners.map((p) => p.account))];
  return (
    <Modal title="필터" onClose={onClose} size="wide"
      actions={<>
        <button className="btn-ghost" style={{ marginRight: 'auto' }} onClick={() => setF(NO_FILTER)}>기본값으로</button>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => onApply(f)}>확인</button>
      </>}>
      <div className="cl-filter">
        <div className="cl-frow"><span>도구 노출</span><Seg v={f.visible} opts={[['all', '전체'], ['y', '노출'], ['n', '비노출']]} on={(v) => setF({ ...f, visible: v })} /></div>
        <div className="cl-frow"><span>자체 브랜드</span>
          <div className="cl-inline2">
            <select className="inline-input full" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, seriesId: '' })}><option value="">전체 브랜드</option>{st.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <select className="inline-input full" value={f.seriesId} disabled={!brand} onChange={(e) => setF({ ...f, seriesId: e.target.value })}><option value="">전체 시리즈</option>{(brand?.series ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
        </div>
        <div className="cl-frow"><span>권한 부여 브랜드</span>
          <select className="inline-input full" value={f.partner} onChange={(e) => setF({ ...f, partner: e.target.value })}><option value="">전체 파트너</option>{partners.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <div className="cl-frow"><span>렌더 상태</span><Seg v={f.render} opts={[['all', '전체'], ['running', '렌더링중'], ['done', '성공'], ['fail', '실패']]} on={(v) => setF({ ...f, render: v })} /></div>
        <div className="cl-frow"><span>공용 라이브러리 공개</span><Seg v={f.pub} opts={[['all', '전체'], ['y', '공개'], ['n', '비공개']]} on={(v) => setF({ ...f, pub: v })} /></div>
        <div className="cl-ftags-head">
          <b>태그</b>{f.tags.length > 0 && <span className="filter-grp-cnt">{f.tags.length}</span>}
          <input className="inline-input" placeholder="태그·그룹 검색" value={tq} onChange={(e) => setTq(e.target.value)} />
          <label className="check-item"><input type="checkbox" checked={allGroups} onChange={(e) => setAllGroups(e.target.checked)} /> 목록에 없는 태그도 보기 ({st.tagGroups.length}개 그룹)</label>
        </div>
        <div className="cl-ftags">
          {groups.map((g) => (
            <div key={g.id} className="filter-grp">
              <div className="filter-grp-head"><span className="filter-grp-name">{g.name}</span></div>
              <div className="filter-opts">{g.tags.map((t) => <button key={t} className={`swap-chip${f.tags.includes(t) ? ' on' : ''}`} onClick={() => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}>{f.tags.includes(t) ? '✓ ' : ''}{t}</button>)}</div>
            </div>
          ))}
          {!groups.length && <p className="cl-muted">현재 목록 상품에 붙은 태그가 없습니다.</p>}
        </div>
      </div>
    </Modal>
  );
}

function ColumnsModal({ cols, customFields, onClose, onApply }: { cols: ColumnKey[]; customFields: ContentState['customFields']; onClose: () => void; onApply: (c: ColumnKey[]) => void }) {
  const all: { key: ColumnKey; label: string; fixed?: boolean }[] = [...BASE_COLUMNS, ...customFields.map((f) => ({ key: `cf:${f.id}` as ColumnKey, label: `${f.name}${f.description && f.description !== f.name ? ` (${f.description})` : ''}` }))];
  const [order, setOrder] = useState<ColumnKey[]>(() => [...cols.filter((c) => all.some((a) => a.key === c)), ...all.map((a) => a.key).filter((k) => !cols.includes(k))]);
  const [on, setOn] = useState(new Set(cols));
  const drag = useRef<ColumnKey | null>(null);
  return (
    <Modal title="컬럼 설정" onClose={onClose}
      actions={<>
        <button className="btn-ghost" style={{ marginRight: 'auto' }} onClick={() => { setOrder(all.map((a) => a.key)); setOn(new Set(DEFAULT_VISIBLE_COLUMNS)); }}>기본값</button>
        <button className="btn-ghost" onClick={onClose}>취소</button>
        <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => onApply(order.filter((k) => on.has(k)))}>적용</button>
      </>}>
      <p className="cl-muted" style={{ fontSize: '0.76rem', marginBottom: 8 }}>끌어서 순서를 바꾸고 체크로 표시 여부를 정합니다. (보는 사람 브라우저에만 저장)</p>
      <ul className="cl-collist">
        {order.map((k) => {
          const a = all.find((x) => x.key === k)!;
          return (
            <li key={k} draggable={!a.fixed} onDragStart={() => { drag.current = k; }} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { const s = drag.current; if (!s || s === k || a.fixed) return; const n = order.filter((x) => x !== s); n.splice(n.indexOf(k), 0, s); setOrder(n); }}>
              <span aria-hidden="true">≡</span>
              <label className="check-item"><input type="checkbox" disabled={a.fixed} checked={on.has(k)} onChange={(e) => setOn((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })} /> {a.label}</label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

