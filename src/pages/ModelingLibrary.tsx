import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, TrashIcon } from '../components/icons';
import {
  loadProducts, loadFolders, loadSwapState, saveSwapState, expandMembers,
  type SwapGroup,
} from '../data/groups';

/**
 * 컨텐츠 그룹 관리 — 카테고리 탭(몸통/도어/손잡이 …).
 * 한 탭 안에서 좌/우 두 영역으로 운영:
 *  - 일반 그룹: 개별 상품 + 폴더(폴더 내 상품)를 묶음.
 *  - 그룹핑 그룹: 같은 카테고리의 일반 그룹들을 다시 묶어, 각 그룹을 상품처럼 한 항목으로 표시.
 * 스타일(모델 그룹들의 묶음)은 별도 메뉴 '스타일 그룹 관리'.
 */
export function ModelingLibrary() {
  const products = useRef(loadProducts()).current;
  const allFolders = useRef(loadFolders()).current;
  const saved = useRef(loadSwapState()).current;

  const [groups, setGroups] = useState<SwapGroup[]>(saved.groups);
  const [folders, setFolders] = useState<Record<string, string[]>>(saved.folders);
  const [items, setItems] = useState<Record<string, string[]>>(saved.items ?? {});
  const [groupRefs, setGroupRefs] = useState<Record<string, string[]>>(saved.groupRefs ?? {});
  const [categories, setCategories] = useState<string[]>(saved.categories);
  const [activeCat, setActiveCat] = useState<string>(saved.categories[0] ?? '');
  // 이 페이지에서 변경하지 않는 값은 로드값을 그대로 보존해 저장
  const folderModes = saved.folderModes ?? {};
  const styles = saved.styles;
  const styleCategories = saved.styleCategories ?? [];

  // 자동저장 없음 — '저장' 버튼으로만 영속화
  const sig = JSON.stringify({ groups, folders, items, groupRefs, categories });
  const savedSig = useRef(sig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(sig !== savedSig.current); }, [sig]);
  const save = () => { saveSwapState({ groups, folders, folderModes, items, groupRefs, styles, categories, styleCategories }); savedSig.current = sig; setDirty(false); };

  const memberMap = useMemo(() => expandMembers({ groups, folders, items, styles, categories }, allFolders, products), [groups, folders, items, styles, categories, allFolders, products]);

  // 모델 그룹 생성/편집
  const [addingGroup, setAddingGroup] = useState<null | 'normal' | 'grouping'>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pickerGroup, setPickerGroup] = useState<string | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  /** 상품 직접 추가 피커가 열린 그룹 + 검색어 */
  const [itemPickerGroup, setItemPickerGroup] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  /** 그룹핑: 일반 그룹 추가 피커 */
  const [refPickerGroup, setRefPickerGroup] = useState<string | null>(null);
  const [refQuery, setRefQuery] = useState('');
  /** 선택된 그룹 — 선택하면 영역 우측 추가 버튼 활성 */
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const selectGroup = (id: string) => { setSelGroup(id); setPickerGroup(null); setItemPickerGroup(null); setRefPickerGroup(null); };
  const productName = (code: string) => products.find((p) => p.contentCode === code)?.name ?? code;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;

  // 탭(카테고리) 편집
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [tabRenaming, setTabRenaming] = useState<string | null>(null);
  const [tabRenameDraft, setTabRenameDraft] = useState('');
  const [confirmDeleteTab, setConfirmDeleteTab] = useState<string | null>(null);

  const addGroup = (cat: string, type: 'normal' | 'grouping') => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((p) => [...p, { id: `sg-${Date.now()}`, name, kind: cat, type }]);
    setNewGroupName(''); setAddingGroup(null);
  };
  const commitRename = () => {
    const name = renameDraft.trim();
    if (renaming && name) setGroups((p) => p.map((g) => (g.id === renaming ? { ...g, name } : g)));
    setRenaming(null);
  };
  const deleteGroup = (id: string) => {
    setGroups((p) => p.filter((g) => g.id !== id));
    setFolders((p) => { const n = { ...p }; delete n[id]; return n; });
    setItems((p) => { const n = { ...p }; delete n[id]; return n; });
    // 삭제된 일반 그룹을 참조하던 그룹핑 그룹에서도 제거
    setGroupRefs((p) => {
      const n = { ...p }; delete n[id];
      for (const k of Object.keys(n)) n[k] = (n[k] ?? []).filter((x) => x !== id);
      return n;
    });
  };
  const connectFolder = (folderId: string, groupId: string) =>
    setFolders((p) => ({ ...p, [groupId]: (p[groupId] ?? []).includes(folderId) ? (p[groupId] ?? []) : [...(p[groupId] ?? []), folderId] }));
  const disconnectFolder = (folderId: string, groupId: string) =>
    setFolders((p) => ({ ...p, [groupId]: (p[groupId] ?? []).filter((f) => f !== folderId) }));
  // 개별 상품 직접 추가/제거
  const connectItem = (code: string, groupId: string) =>
    setItems((p) => ({ ...p, [groupId]: (p[groupId] ?? []).includes(code) ? (p[groupId] ?? []) : [...(p[groupId] ?? []), code] }));
  const disconnectItem = (code: string, groupId: string) =>
    setItems((p) => ({ ...p, [groupId]: (p[groupId] ?? []).filter((c) => c !== code) }));
  // 그룹핑: 일반 그룹 묶기
  const connectRef = (refGroupId: string, groupingId: string) =>
    setGroupRefs((p) => ({ ...p, [groupingId]: (p[groupingId] ?? []).includes(refGroupId) ? (p[groupingId] ?? []) : [...(p[groupingId] ?? []), refGroupId] }));
  const disconnectRef = (refGroupId: string, groupingId: string) =>
    setGroupRefs((p) => ({ ...p, [groupingId]: (p[groupingId] ?? []).filter((x) => x !== refGroupId) }));

  // 탭(카테고리) 추가/수정/삭제
  const addTab = () => {
    const name = newTabName.trim();
    if (!name || categories.includes(name) || styleCategories.includes(name)) { setAddingTab(false); setNewTabName(''); return; }
    setCategories((p) => [...p, name]); setActiveCat(name);
    setNewTabName(''); setAddingTab(false);
  };
  const commitTabRename = (old: string) => {
    const name = tabRenameDraft.trim();
    if (name && name !== old && !categories.includes(name) && !styleCategories.includes(name)) {
      setCategories((p) => p.map((c) => (c === old ? name : c)));
      setGroups((p) => p.map((g) => (g.kind === old ? { ...g, kind: name } : g)));
      if (activeCat === old) setActiveCat(name);
    }
    setTabRenaming(null);
  };
  const deleteTab = (cat: string) => {
    const ids = groups.filter((g) => g.kind === cat).map((g) => g.id);
    setGroups((p) => p.filter((g) => g.kind !== cat));
    setFolders((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; });
    setItems((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; });
    setGroupRefs((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; });
    setCategories((p) => {
      const next = p.filter((c) => c !== cat);
      if (activeCat === cat) setActiveCat(next[0] ?? '');
      return next;
    });
  };

  const folderName = (id: string) => allFolders.find((f) => f.id === id)?.name ?? id;

  const folderOptions = useMemo(() => {
    const out: { id: string; label: string; path: string }[] = [];
    const walk = (parentId: string | null, trail: string[]) => {
      for (const f of allFolders.filter((x) => x.parentId === parentId)) {
        const trail2 = [...trail, f.name];
        out.push({ id: f.id, label: f.name, path: trail2.join(' › ') });
        walk(f.id, trail2);
      }
    };
    walk(null, []);
    return out;
  }, [allFolders]);
  /** 폴더 id → 경로 문자열 (상품 위치 표시용) */
  const folderPath = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of folderOptions) m[o.id] = o.path;
    return m;
  }, [folderOptions]);

  /** 공통 — 그룹 헤더 행(이름/개수/선택/이름변경/삭제) */
  const renderGroupHead = (g: SwapGroup, count: number) => (
    <div className={`tree-item selectable${selGroup === g.id ? ' selected' : ''}`} style={{ paddingLeft: 14 }}
      onClick={() => { if (renaming !== g.id) selectGroup(g.id); }}>
      {renaming === g.id ? (
        <input className="inline-input tree-rename" autoFocus value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)} onClick={(e) => e.stopPropagation()}
          onBlur={commitRename} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
      ) : (
        <span className="t">{g.name}</span>
      )}
      <span className="count">{count}</span>
      <span className="tree-actions">
        <span className="tree-act" role="button" title="이름 변경" onClick={(e) => { e.stopPropagation(); setRenaming(g.id); setRenameDraft(g.name); }}><PencilIcon size={13} /></span>
        <span className="tree-act" role="button" title="그룹 삭제" onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}><TrashIcon size={13} /></span>
      </span>
    </div>
  );

  /** 일반 그룹 행 — 멤버(폴더·상품) 태그만 표시. 추가 버튼은 영역 헤더에서. */
  const renderNormalRow = (g: SwapGroup) => {
    const connected = folders[g.id] ?? [];
    const connectedItems = items[g.id] ?? [];
    return (
      <li key={g.id}>
        {renderGroupHead(g, (memberMap[g.id] ?? []).length)}
        {(connected.length > 0 || connectedItems.length > 0) && (
          <div className="grp-conn">
            {connected.map((fid) => (
              <span key={fid} className="tag removable">📁 {folderName(fid)}
                <button className="tag-x" aria-label={`${folderName(fid)} 제거`} onClick={() => disconnectFolder(fid, g.id)}>×</button>
              </span>
            ))}
            {connectedItems.map((code) => (
              <span key={code} className="tag removable item">📦 {productName(code)}
                <button className="tag-x" aria-label={`${productName(code)} 제거`} onClick={() => disconnectItem(code, g.id)}>×</button>
              </span>
            ))}
          </div>
        )}
      </li>
    );
  };

  /** 폴더 추가 피커 패널 (선택 그룹 대상) */
  const renderFolderPicker = (gid: string) => {
    const connected = folders[gid] ?? [];
    const matches = folderOptions.filter((o) =>
      !connected.includes(o.id) && (!folderQuery.trim() || o.path.toLowerCase().includes(folderQuery.trim().toLowerCase())));
    return (
      <div className="folder-picker">
        <div className="folder-picker-bar">
          <input className="inline-input full" autoFocus value={folderQuery}
            placeholder="폴더 이름·경로 검색…" aria-label="폴더 검색"
            onChange={(e) => setFolderQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setPickerGroup(null); setFolderQuery(''); } }} />
          <button className="btn-ghost" onClick={() => { setPickerGroup(null); setFolderQuery(''); }}>닫기</button>
        </div>
        <ul className="folder-picker-list">
          {matches.map((o) => (
            <li key={o.id}>
              <button className="folder-pick-item" onClick={() => connectFolder(o.id, gid)}>
                <span className="fp-path">{o.path}</span><span className="fp-add">+ 추가</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>일치하는 폴더 없음</span></li>}
        </ul>
      </div>
    );
  };

  /** 상품 추가 피커 패널 (선택 그룹 대상, 폴더 위치 표시) */
  const renderItemPicker = (gid: string) => {
    const connectedItems = items[gid] ?? [];
    const itemMatches = products.filter((p) =>
      !connectedItems.includes(p.contentCode)
      && (!itemQuery.trim() || `${p.name} ${p.productCode} ${p.folderId ? folderPath[p.folderId] ?? '' : ''}`.toLowerCase().includes(itemQuery.trim().toLowerCase())))
      .slice(0, 40);
    return (
      <div className="folder-picker">
        <div className="folder-picker-bar">
          <input className="inline-input full" autoFocus value={itemQuery}
            placeholder="상품명·코드·폴더 경로 검색…" aria-label="상품 검색"
            onChange={(e) => setItemQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setItemPickerGroup(null); setItemQuery(''); } }} />
          <button className="btn-ghost" onClick={() => { setItemPickerGroup(null); setItemQuery(''); }}>닫기</button>
        </div>
        <ul className="folder-picker-list">
          {itemMatches.map((p) => (
            <li key={p.contentCode}>
              <button className="folder-pick-item" onClick={() => connectItem(p.contentCode, gid)}>
                <span className="fp-path">
                  {p.name} <small style={{ color: 'var(--text-3)' }}>{p.productCode}</small>
                  {p.folderId && folderPath[p.folderId] && <small className="fp-loc">📁 {folderPath[p.folderId]}</small>}
                </span>
                <span className="fp-add">+ 추가</span>
              </button>
            </li>
          ))}
          {itemMatches.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>일치하는 상품 없음</span></li>}
        </ul>
      </div>
    );
  };

  /** g가 groupRefs로 target에 (간접 포함) 도달하는지 — 순환 방지용 */
  const reaches = (g: string, target: string, seen = new Set<string>()): boolean => {
    if (g === target) return true;
    if (seen.has(g)) return false;
    seen.add(g);
    return (groupRefs[g] ?? []).some((r) => reaches(r, target, seen));
  };
  /** 그룹의 표시 개수 — 그룹핑 그룹은 묶은 그룹 수, 일반 그룹은 멤버 상품 수 */
  const groupCount = (id: string) =>
    groups.find((x) => x.id === id)?.type === 'grouping' ? (groupRefs[id] ?? []).length : (memberMap[id] ?? []).length;

  /** 그룹핑 그룹 행 — 묶은 그룹 태그만 표시. 추가 버튼은 영역 헤더에서. */
  const renderGroupingRow = (g: SwapGroup) => {
    const refs = groupRefs[g.id] ?? [];
    return (
      <li key={g.id}>
        {renderGroupHead(g, refs.length)}
        {refs.length > 0 && (
          <div className="grp-conn">
            {refs.map((rid) => {
              const grouping = groups.find((x) => x.id === rid)?.type === 'grouping';
              return (
                <span key={rid} className="tag removable item">{grouping ? '🗂️' : '🧩'} {groupName(rid)} <small style={{ color: 'var(--text-3)' }}>{groupCount(rid)}</small>
                  <button className="tag-x" aria-label={`${groupName(rid)} 제거`} onClick={() => disconnectRef(rid, g.id)}>×</button>
                </span>
              );
            })}
          </div>
        )}
      </li>
    );
  };

  /** 그룹 묶기 피커 패널 (선택된 그룹핑 그룹 대상) */
  const renderRefPicker = (gid: string) => {
    const refs = groupRefs[gid] ?? [];
    const refMatches = groups.filter((n) =>
      n.kind === activeCat && n.id !== gid && !refs.includes(n.id)
      && !reaches(n.id, gid) /* 순환 방지: 이미 자기를 포함하는 그룹은 제외 */
      && (!refQuery.trim() || n.name.toLowerCase().includes(refQuery.trim().toLowerCase())));
    return (
      <div className="folder-picker">
        <div className="folder-picker-bar">
          <input className="inline-input full" autoFocus value={refQuery}
            placeholder="교체 묶음·구성 세트 검색…" aria-label="그룹 검색"
            onChange={(e) => setRefQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setRefPickerGroup(null); setRefQuery(''); } }} />
          <button className="btn-ghost" onClick={() => { setRefPickerGroup(null); setRefQuery(''); }}>닫기</button>
        </div>
        <ul className="folder-picker-list">
          {refMatches.map((n) => (
            <li key={n.id}>
              <button className="folder-pick-item" onClick={() => connectRef(n.id, gid)}>
                <span className="fp-path">{n.type === 'grouping' ? '🗂️ ' : ''}{n.name} <small style={{ color: 'var(--text-3)' }}>{n.type === 'grouping' ? '그룹핑' : ''} {groupCount(n.id)}개</small></span>
                <span className="fp-add">+ 추가</span>
              </button>
            </li>
          ))}
          {refMatches.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>묶을 그룹 없음</span></li>}
        </ul>
      </div>
    );
  };

  const normalGroups = groups.filter((g) => g.kind === activeCat && g.type !== 'grouping');
  const groupingGroups = groups.filter((g) => g.kind === activeCat && g.type === 'grouping');
  const selectedNormal = normalGroups.find((g) => g.id === selGroup) ?? null;
  const selectedGrouping = groupingGroups.find((g) => g.id === selGroup) ?? null;

  return (
    <main className="main">
      <div className="page-head">
        <h1>컨텐츠 그룹 관리</h1>
        <span className="date">모델 그룹 {groups.length}개</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-primary" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={save}>저장</button>
      </div>

      <div className="grp-tabs">
        {categories.map((cat) => (
          <div key={cat} className={`grp-tab${activeCat === cat ? ' active' : ''}`}>
            {tabRenaming === cat ? (
              <input className="grp-tab-input" autoFocus value={tabRenameDraft}
                onChange={(e) => setTabRenameDraft(e.target.value)}
                onBlur={() => commitTabRename(cat)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTabRename(cat); if (e.key === 'Escape') setTabRenaming(null); }} />
            ) : (
              <>
                <button className="grp-tab-label" onClick={() => setActiveCat(cat)} onDoubleClick={() => { setTabRenaming(cat); setTabRenameDraft(cat); }}>
                  {cat} <span className="grp-tab-cnt">{groups.filter((g) => g.kind === cat).length}</span>
                </button>
                <span className="grp-tab-acts">
                  <span role="button" title="탭 이름 변경" onClick={(e) => { e.stopPropagation(); setTabRenaming(cat); setTabRenameDraft(cat); }}><PencilIcon size={11} /></span>
                  <span role="button" title="탭 삭제(그룹 포함)" onClick={(e) => { e.stopPropagation(); setConfirmDeleteTab(cat); }}><TrashIcon size={11} /></span>
                </span>
              </>
            )}
          </div>
        ))}
        {addingTab ? (
          <input className="grp-tab-input" autoFocus value={newTabName} placeholder="탭 이름"
            onChange={(e) => setNewTabName(e.target.value)} onBlur={addTab}
            onKeyDown={(e) => { if (e.key === 'Enter') addTab(); if (e.key === 'Escape') { setAddingTab(false); setNewTabName(''); } }} />
        ) : (
          <button className="grp-tab-add" title="카테고리 탭 추가" onClick={() => { setAddingTab(true); setNewTabName(''); }}>+ 탭</button>
        )}
      </div>

      <div className="grp-two-col">
        {/* ── 좌: 일반 그룹 ── */}
        <section className="panel">
          <div className="grp-col-head">
            <h2 className="grp-section-title">교체 묶음 <small>부위 내 교체 옵션(폴더·상품) — 조건 분기 대상</small></h2>
            <div className="grp-col-actions">
              {selectedNormal ? (
                <>
                  <span className="grp-sel-name" title="선택된 그룹">{selectedNormal.name}</span>
                  <button className="conn-add" onClick={() => { setPickerGroup(selectedNormal.id); setItemPickerGroup(null); setFolderQuery(''); }}>+ 폴더 추가</button>
                  <button className="conn-add" onClick={() => { setItemPickerGroup(selectedNormal.id); setPickerGroup(null); setItemQuery(''); }}>+ 상품 추가</button>
                </>
              ) : <span className="hint">그룹 선택 후 추가</span>}
            </div>
          </div>
          {selectedNormal && pickerGroup === selectedNormal.id && renderFolderPicker(selectedNormal.id)}
          {selectedNormal && itemPickerGroup === selectedNormal.id && renderItemPicker(selectedNormal.id)}
          <ul className="tree">
            {normalGroups.map(renderNormalRow)}
            {normalGroups.length === 0 && <li><div className="tree-item" style={{ paddingLeft: 14 }}><span className="hint">그룹 없음</span></div></li>}
          </ul>
          {addingGroup === 'normal' ? (
            <div className="folder-new">
              <input autoFocus value={newGroupName} placeholder={`${activeCat} 교체 묶음 이름`} onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addGroup(activeCat, 'normal'); if (e.key === 'Escape') setAddingGroup(null); }} />
              <button className="btn-mini" onClick={() => addGroup(activeCat, 'normal')}>생성</button>
            </div>
          ) : (
            activeCat && <button className="folder-new-cta" onClick={() => { setAddingGroup('normal'); setNewGroupName(''); }}>+ 교체 묶음 추가</button>
          )}
        </section>

        {/* ── 우: 그룹핑 그룹 ── */}
        <section className="panel">
          <div className="grp-col-head">
            <h2 className="grp-section-title">구성 세트 <small>여러 부위 교체 묶음을 한 세트로 조합</small></h2>
            <div className="grp-col-actions">
              {selectedGrouping ? (
                <>
                  <span className="grp-sel-name" title="선택된 그룹">{selectedGrouping.name}</span>
                  <button className="conn-add" onClick={() => { setRefPickerGroup(selectedGrouping.id); setRefQuery(''); }}>+ 그룹 추가</button>
                </>
              ) : <span className="hint">그룹 선택 후 추가</span>}
            </div>
          </div>
          {selectedGrouping && refPickerGroup === selectedGrouping.id && renderRefPicker(selectedGrouping.id)}
          <ul className="tree">
            {groupingGroups.map(renderGroupingRow)}
            {groupingGroups.length === 0 && <li><div className="tree-item" style={{ paddingLeft: 14 }}><span className="hint">그룹 없음</span></div></li>}
          </ul>
          {addingGroup === 'grouping' ? (
            <div className="folder-new">
              <input autoFocus value={newGroupName} placeholder={`${activeCat} 구성 세트 이름`} onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addGroup(activeCat, 'grouping'); if (e.key === 'Escape') setAddingGroup(null); }} />
              <button className="btn-mini" onClick={() => addGroup(activeCat, 'grouping')}>생성</button>
            </div>
          ) : (
            activeCat && <button className="folder-new-cta" onClick={() => { setAddingGroup('grouping'); setNewGroupName(''); }}>+ 구성 세트 추가</button>
          )}
        </section>
      </div>

      {confirmDeleteTab && (
        <div className="modal-backdrop" onClick={() => setConfirmDeleteTab(null)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">탭 삭제</h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-2)', margin: '4px 0 16px' }}>
              <b>{confirmDeleteTab}</b> 탭을 삭제할까요?<br />
              이 탭의 모델 그룹 {groups.filter((g) => g.kind === confirmDeleteTab).length}개도 함께 삭제됩니다.
            </p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setConfirmDeleteTab(null)}>취소</button>
              <button className="btn-danger" onClick={() => { deleteTab(confirmDeleteTab); setConfirmDeleteTab(null); }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
