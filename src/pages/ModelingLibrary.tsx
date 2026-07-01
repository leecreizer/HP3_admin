import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, TrashIcon } from '../components/icons';
import {
  loadProducts, loadFolders, loadSwapState, saveSwapState,
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
  const [groupRefs] = useState<Record<string, string[]>>(saved.groupRefs ?? {});
  const [categories, setCategories] = useState<string[]>(saved.categories);
  const [activeCat, setActiveCat] = useState<string>(saved.categories[0] ?? '');
  const folderModes = saved.folderModes ?? {};
  const styles = saved.styles;
  const styleCategories = saved.styleCategories ?? [];

  // 자동저장 없음 — '저장' 버튼으로만 영속화
  const sig = JSON.stringify({ groups, folders, items, groupRefs, categories });
  const savedSig = useRef(sig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(sig !== savedSig.current); }, [sig]);
  const save = () => { saveSwapState({ groups, folders, folderModes, items, groupRefs, styles, categories, styleCategories }); savedSig.current = sig; setDirty(false); };

  const [pickerGroup, setPickerGroup] = useState<string | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  /** 상품 직접 추가 피커가 열린 그룹 + 검색어 */
  const [itemPickerGroup, setItemPickerGroup] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const productName = (code: string) => products.find((p) => p.contentCode === code)?.name ?? code;
  /** 폴더 단위 노출 그룹 편집 상태 */
  const [selFu, setSelFu] = useState<string | null>(null);
  const [addingFu, setAddingFu] = useState(false);
  const [fuName, setFuName] = useState('');
  const [fuRenaming, setFuRenaming] = useState<string | null>(null);
  const [fuRenameDraft, setFuRenameDraft] = useState('');
  /** 폴더 단위 노출 그룹에 상품그룹(폴더) 추가 피커 열림 대상 */
  const [fuPicker, setFuPicker] = useState<string | null>(null);

  // 탭(카테고리) 편집
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [tabRenaming, setTabRenaming] = useState<string | null>(null);
  const [tabRenameDraft, setTabRenameDraft] = useState('');
  const [confirmDeleteTab, setConfirmDeleteTab] = useState<string | null>(null);

  const connectFolder = (folderId: string, groupId: string) =>
    setFolders((p) => ({ ...p, [groupId]: (p[groupId] ?? []).includes(folderId) ? (p[groupId] ?? []) : [...(p[groupId] ?? []), folderId] }));
  const disconnectFolder = (folderId: string, groupId: string) =>
    setFolders((p) => ({ ...p, [groupId]: (p[groupId] ?? []).filter((f) => f !== folderId) }));
  // 개별 상품 직접 추가/제거
  const connectItem = (code: string, groupId: string) =>
    setItems((p) => ({ ...p, [groupId]: (p[groupId] ?? []).includes(code) ? (p[groupId] ?? []) : [...(p[groupId] ?? []), code] }));
  const disconnectItem = (code: string, groupId: string) =>
    setItems((p) => ({ ...p, [groupId]: (p[groupId] ?? []).filter((c) => c !== code) }));

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

  /** 폴더 단위 노출 그룹에 담을 상품그룹(=왼쪽 교체 묶음의 폴더) 선택 피커 */
  const renderFuFolderPicker = (fuId: string) => {
    const inFu = folders[fuId] ?? [];
    const catFolders = catGroupRef ? (folders[catGroupRef] ?? []) : [];
    const matches = catFolders.filter((fid) => !inFu.includes(fid)
      && (!folderQuery.trim() || folderName(fid).toLowerCase().includes(folderQuery.trim().toLowerCase())));
    return (
      <div className="folder-picker">
        <div className="folder-picker-bar">
          <input className="inline-input full" autoFocus value={folderQuery} placeholder="교체 묶음의 폴더 검색…" aria-label="폴더 검색"
            onChange={(e) => setFolderQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setFuPicker(null); setFolderQuery(''); } }} />
          <button className="btn-ghost" onClick={() => { setFuPicker(null); setFolderQuery(''); }}>닫기</button>
        </div>
        <ul className="folder-picker-list">
          {matches.map((fid) => (
            <li key={fid}>
              <button className="folder-pick-item" onClick={() => connectFolder(fid, fuId)}>
                <span className="fp-path">📁 {folderName(fid)}</span><span className="fp-add">+ 추가</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>{catFolders.length === 0 ? '왼쪽 교체 묶음에 폴더를 먼저 추가하세요' : '추가할 폴더 없음'}</span></li>}
        </ul>
      </div>
    );
  };

  const normalGroups = groups.filter((g) => g.kind === activeCat && g.type !== 'grouping');
  // 부위(탭)당 교체 묶음 1개(type normal) — 상품 개별 노출. 없으면 추가 시 자동 생성
  const catGroup = normalGroups[0] ?? null;
  const catGroupRef = catGroup?.id ?? null;
  const ensureCatGroupId = (): string => {
    if (catGroup) return catGroup.id;
    const id = `sg-${Date.now()}`;
    setGroups((p) => [...p, { id, name: activeCat, kind: activeCat, type: 'normal' }]);
    return id;
  };
  // 폴더 단위 노출 그룹(type grouping) — 명명 생성 후 왼쪽 교체 묶음의 상품그룹(폴더)을 담음
  const fuGroups = groups.filter((g) => g.kind === activeCat && g.type === 'grouping');
  const addFuGroup = () => {
    const name = fuName.trim(); if (!name) return;
    const id = `fu-${Date.now()}`;
    setGroups((p) => [...p, { id, name, kind: activeCat, type: 'grouping' }]);
    setSelFu(id); setFuName(''); setAddingFu(false);
  };
  const commitFuRename = () => {
    const n = fuRenameDraft.trim();
    if (fuRenaming && n) setGroups((p) => p.map((g) => (g.id === fuRenaming ? { ...g, name: n } : g)));
    setFuRenaming(null);
  };
  const deleteFu = (id: string) => {
    setGroups((p) => p.filter((g) => g.id !== id));
    setFolders((p) => { const n = { ...p }; delete n[id]; return n; });
    if (selFu === id) setSelFu(null);
  };

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

      <div className="grp-guide">
        <span className="grp-guide-ico">💡</span>
        <div>
          <b>탭</b>은 부위(몸통·도어·손잡이 등)입니다. 각 부위의
          <b> 교체 묶음</b>(왼쪽)에 폴더·상품을 담아 <u>이 부위에서 교체 가능한 옵션</u>을 만듭니다.
          <b> 폴더 단위 노출</b>(오른쪽)에 폴더를 담으면 그 폴더는 리스트에서 <u>낱개 상품 대신 ‘폴더 하나’</u>로 노출됩니다.
          <br />
          여러 부위를 한 벌로 묶는 <b>세트</b>는 <b>스타일 그룹 관리</b>에서, 창높이처럼 <b>조건별 다른 묶음</b>은
          상품 편집의 <b>구성 슬롯 → 조건 규칙</b>(<code>#H&nbsp;≤&nbsp;1200 → 저창용 손잡이</code>)에서 연결합니다.
        </div>
      </div>

      <div className="grp-two-col">
        {/* ── 좌: 교체 묶음 (부위당 1개, 폴더/상품 직접 추가) ── */}
        <section className="panel">
          <div className="grp-col-head">
            <h2 className="grp-section-title">교체 묶음 <small>이 부위의 폴더·상품 — 조건 분기 대상</small></h2>
            <div className="grp-col-actions">
              <button className="conn-add" disabled={!activeCat}
                onClick={() => { const id = ensureCatGroupId(); setPickerGroup(id); setItemPickerGroup(null); setFolderQuery(''); }}>+ 폴더 추가</button>
              <button className="conn-add" disabled={!activeCat}
                onClick={() => { const id = ensureCatGroupId(); setItemPickerGroup(id); setPickerGroup(null); setItemQuery(''); }}>+ 상품 추가</button>
            </div>
          </div>
          {pickerGroup && catGroup && pickerGroup === catGroup.id && renderFolderPicker(pickerGroup)}
          {itemPickerGroup && renderItemPicker(itemPickerGroup)}
          {catGroup ? (
            <div className="grp-conn" style={{ marginTop: 6 }}>
              {(folders[catGroup.id] ?? []).map((fid) => (
                <span key={fid} className="tag removable">📁 {folderName(fid)}
                  <button className="tag-x" aria-label={`${folderName(fid)} 제거`} onClick={() => disconnectFolder(fid, catGroup.id)}>×</button>
                </span>
              ))}
              {(items[catGroup.id] ?? []).map((code) => (
                <span key={code} className="tag removable item">📦 {productName(code)}
                  <button className="tag-x" aria-label={`${productName(code)} 제거`} onClick={() => disconnectItem(code, catGroup.id)}>×</button>
                </span>
              ))}
              {(folders[catGroup.id] ?? []).length === 0 && (items[catGroup.id] ?? []).length === 0 &&
                <span className="hint">위 버튼으로 폴더·상품을 추가하세요.</span>}
            </div>
          ) : (
            <p className="hint" style={{ marginTop: 8 }}>이 부위에 폴더·상품을 추가하면 교체 묶음이 만들어집니다.</p>
          )}
        </section>

        {/* ── 우: 폴더 단위 노출 (담은 폴더는 리스트에 폴더 하나로 노출) ── */}
        <section className="panel">
          <div className="grp-col-head">
            <h2 className="grp-section-title">폴더 단위 노출 <small>그룹을 만들고 교체 묶음의 상품그룹(폴더)을 담으면 폴더 하나로 노출</small></h2>
            <div className="grp-col-actions">
              {selFu && fuGroups.some((g) => g.id === selFu) && (
                <button className="conn-add" onClick={() => { setFuPicker(selFu); setFolderQuery(''); }}>+ 상품그룹 추가</button>
              )}
            </div>
          </div>
          {fuPicker && renderFuFolderPicker(fuPicker)}
          <ul className="tree">
            {fuGroups.map((g) => {
              const fs = folders[g.id] ?? [];
              return (
                <li key={g.id}>
                  <div className={`tree-item selectable${selFu === g.id ? ' selected' : ''}`} style={{ paddingLeft: 14 }}
                    onClick={() => { if (fuRenaming !== g.id) { setSelFu(g.id); setFuPicker(null); } }}>
                    {fuRenaming === g.id ? (
                      <input className="inline-input tree-rename" autoFocus value={fuRenameDraft}
                        onClick={(e) => e.stopPropagation()} onChange={(e) => setFuRenameDraft(e.target.value)}
                        onBlur={commitFuRename} onKeyDown={(e) => { if (e.key === 'Enter') commitFuRename(); if (e.key === 'Escape') setFuRenaming(null); }} />
                    ) : (<span className="t">{g.name}</span>)}
                    <span className="count">{fs.length}</span>
                    <span className="tree-actions">
                      <span className="tree-act" role="button" title="이름 변경" onClick={(e) => { e.stopPropagation(); setFuRenaming(g.id); setFuRenameDraft(g.name); }}><PencilIcon size={13} /></span>
                      <span className="tree-act" role="button" title="삭제" onClick={(e) => { e.stopPropagation(); deleteFu(g.id); }}><TrashIcon size={13} /></span>
                    </span>
                  </div>
                  {fs.length > 0 && (
                    <div className="grp-conn">
                      {fs.map((fid) => (
                        <span key={fid} className="tag removable">📁 {folderName(fid)}
                          <button className="tag-x" aria-label={`${folderName(fid)} 제거`} onClick={() => disconnectFolder(fid, g.id)}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
            {fuGroups.length === 0 && <li><div className="tree-item" style={{ paddingLeft: 14 }}><span className="hint">그룹 없음</span></div></li>}
          </ul>
          {addingFu ? (
            <div className="folder-new">
              <input autoFocus value={fuName} placeholder={`${activeCat} 폴더 단위 노출 이름`} onChange={(e) => setFuName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addFuGroup(); if (e.key === 'Escape') setAddingFu(false); }} />
              <button className="btn-mini" onClick={addFuGroup}>생성</button>
            </div>
          ) : (
            activeCat && <button className="folder-new-cta" onClick={() => { setAddingFu(true); setFuName(''); }}>+ 폴더 단위 노출 추가</button>
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
