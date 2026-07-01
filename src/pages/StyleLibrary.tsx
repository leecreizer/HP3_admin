import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, TrashIcon } from '../components/icons';
import { loadSwapState, saveSwapState, loadFolders, type StyleSet } from '../data/groups';

/**
 * 스타일 그룹 관리 — 부위별 교체 묶음의 폴더(상품그룹)를 하나씩 골라 묶은 ‘스타일’.
 * 예: 매트화이트 = 몸통(일반장) + 도어(리노아베이지) + … → 스타일 선택 시 각 부위가 한 번에 교체.
 */
export function StyleLibrary() {
  const saved = useRef(loadSwapState()).current;
  const allFolders = useRef(loadFolders()).current;
  // 이 페이지에서 변경하지 않는 값은 로드값을 보존해 저장
  const groups = saved.groups;
  const folderName = (id: string) => allFolders.find((f) => f.id === id)?.name ?? id;
  // 부위(탭)별 교체 묶음의 폴더(상품그룹) 목록
  const partOptions = useMemo(() => (saved.categories ?? []).map((part) => {
    const gids = groups.filter((g) => g.kind === part && g.type !== 'grouping').map((g) => g.id);
    const fids = [...new Set(gids.flatMap((gid) => saved.folders[gid] ?? []))];
    return { part, folders: fids.map((fid) => ({ id: fid, name: folderName(fid) })) };
  }).filter((o) => o.folders.length > 0), [groups, saved.categories, saved.folders, allFolders]);
  /** 폴더 id → 부위(탭)명 */
  const folderPart = useMemo(() => { const m: Record<string, string> = {}; for (const o of partOptions) for (const f of o.folders) m[f.id] = o.part; return m; }, [partOptions]);

  const [styles, setStyles] = useState<StyleSet[]>(saved.styles);
  const [styleCategories, setStyleCategories] = useState<string[]>(saved.styleCategories ?? []);
  const [activeCat, setActiveCat] = useState<string>(saved.styleCategories?.[0] ?? '');

  const sig = JSON.stringify({ styles, styleCategories });
  const savedSig = useRef(sig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(sig !== savedSig.current); }, [sig]);
  const save = () => {
    saveSwapState({ groups, folders: saved.folders, folderModes: saved.folderModes ?? {}, items: saved.items ?? {}, groupRefs: saved.groupRefs ?? {}, styles, categories: saved.categories, styleCategories });
    savedSig.current = sig; setDirty(false);
  };

  // 스타일 핸들러
  const [addingStyle, setAddingStyle] = useState(false);
  const [newStyleName, setNewStyleName] = useState('');
  const [styleRenaming, setStyleRenaming] = useState<string | null>(null);
  const [styleRenameDraft, setStyleRenameDraft] = useState('');
  const [stylePicker, setStylePicker] = useState<string | null>(null);
  const [styleQuery, setStyleQuery] = useState('');
  const addStyle = (cat: string) => {
    const name = newStyleName.trim();
    if (!name) return;
    setStyles((p) => [...p, { id: `st-${Date.now()}`, name, kind: cat, folders: [] }]);
    setNewStyleName(''); setAddingStyle(false);
  };
  const commitStyleRename = () => {
    const name = styleRenameDraft.trim();
    if (styleRenaming && name) setStyles((p) => p.map((s) => (s.id === styleRenaming ? { ...s, name } : s)));
    setStyleRenaming(null);
  };
  const deleteStyle = (id: string) => setStyles((p) => p.filter((s) => s.id !== id));
  /** 스타일에 폴더(상품그룹) 담기 — 같은 부위는 하나만(교체하며 반영) */
  const connectStyleFolder = (styleId: string, fid: string) =>
    setStyles((p) => p.map((s) => {
      if (s.id !== styleId) return s;
      const part = folderPart[fid];
      const kept = (s.folders ?? []).filter((x) => folderPart[x] !== part); // 같은 부위 기존 선택 제거
      return { ...s, folders: [...kept, fid] };
    }));
  const disconnectStyleFolder = (styleId: string, fid: string) =>
    setStyles((p) => p.map((s) => (s.id === styleId ? { ...s, folders: (s.folders ?? []).filter((x) => x !== fid) } : s)));

  // 탭(스타일 카테고리) 편집
  const [addingTab, setAddingTab] = useState(false);
  const [newTabName, setNewTabName] = useState('');
  const [tabRenaming, setTabRenaming] = useState<string | null>(null);
  const [tabRenameDraft, setTabRenameDraft] = useState('');
  const [confirmDeleteTab, setConfirmDeleteTab] = useState<string | null>(null);
  const addTab = () => {
    const name = newTabName.trim();
    if (!name || styleCategories.includes(name)) { setAddingTab(false); setNewTabName(''); return; }
    setStyleCategories((p) => [...p, name]); setActiveCat(name);
    setNewTabName(''); setAddingTab(false);
  };
  const commitTabRename = (old: string) => {
    const name = tabRenameDraft.trim();
    if (name && name !== old && !styleCategories.includes(name)) {
      setStyleCategories((p) => p.map((c) => (c === old ? name : c)));
      setStyles((p) => p.map((s) => (s.kind === old ? { ...s, kind: name } : s)));
      if (activeCat === old) setActiveCat(name);
    }
    setTabRenaming(null);
  };
  const deleteTab = (cat: string) => {
    setStyles((p) => p.filter((s) => s.kind !== cat));
    setStyleCategories((p) => {
      const next = p.filter((c) => c !== cat);
      if (activeCat === cat) setActiveCat(next[0] ?? '');
      return next;
    });
  };

  return (
    <main className="main">
      <div className="page-head">
        <h1>스타일 그룹 관리</h1>
        <span className="date">스타일 {styles.length}개</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-primary" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={save}>저장</button>
      </div>

      <div className="grp-tabs">
        {styleCategories.map((cat) => (
          <div key={cat} className={`grp-tab style-cat${activeCat === cat ? ' active' : ''}`}>
            {tabRenaming === cat ? (
              <input className="grp-tab-input" autoFocus value={tabRenameDraft}
                onChange={(e) => setTabRenameDraft(e.target.value)}
                onBlur={() => commitTabRename(cat)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTabRename(cat); if (e.key === 'Escape') setTabRenaming(null); }} />
            ) : (
              <>
                <button className="grp-tab-label" onClick={() => setActiveCat(cat)} onDoubleClick={() => { setTabRenaming(cat); setTabRenameDraft(cat); }}>
                  🎨 {cat} <span className="grp-tab-cnt">{styles.filter((s) => s.kind === cat).length}</span>
                </button>
                <span className="grp-tab-acts">
                  <span role="button" title="탭 이름 변경" onClick={(e) => { e.stopPropagation(); setTabRenaming(cat); setTabRenameDraft(cat); }}><PencilIcon size={11} /></span>
                  <span role="button" title="탭 삭제(스타일 포함)" onClick={(e) => { e.stopPropagation(); setConfirmDeleteTab(cat); }}><TrashIcon size={11} /></span>
                </span>
              </>
            )}
          </div>
        ))}
        {addingTab ? (
          <input className="grp-tab-input" autoFocus value={newTabName} placeholder="스타일 탭 이름"
            onChange={(e) => setNewTabName(e.target.value)} onBlur={addTab}
            onKeyDown={(e) => { if (e.key === 'Enter') addTab(); if (e.key === 'Escape') { setAddingTab(false); setNewTabName(''); } }} />
        ) : (
          <button className="grp-tab-add" title="스타일 탭 추가" onClick={() => { setAddingTab(true); setNewTabName(''); }}>+ 탭</button>
        )}
      </div>

      <section className="panel">
        <p className="hint" style={{ margin: '0 0 10px' }}>
          <b>{activeCat || '스타일 탭'}</b> 스타일입니다. <b>+ 상품그룹 담기</b>로 부위별(몸통·도어 …) 교체 묶음의 폴더를 <b>하나씩 골라</b> 한 벌로 묶으세요. (같은 부위는 하나만 — 새로 고르면 교체)
        </p>
        <ul className="tree">
          {styles.filter((s) => s.kind === activeCat).map((s) => {
            const fids = s.folders ?? [];
            return (
              <li key={s.id}>
                <div className="tree-item" style={{ paddingLeft: 20 }}>
                  {styleRenaming === s.id ? (
                    <input className="inline-input tree-rename" autoFocus value={styleRenameDraft}
                      onChange={(e) => setStyleRenameDraft(e.target.value)}
                      onBlur={commitStyleRename} onKeyDown={(e) => { if (e.key === 'Enter') commitStyleRename(); if (e.key === 'Escape') setStyleRenaming(null); }} />
                  ) : (<span className="t">{s.name}</span>)}
                  <span className="count">{fids.length}</span>
                  <span className="tree-actions">
                    <span className="tree-act" role="button" title="이름 변경" onClick={() => { setStyleRenaming(s.id); setStyleRenameDraft(s.name); }}><PencilIcon size={13} /></span>
                    <span className="tree-act" role="button" title="스타일 삭제" onClick={() => deleteStyle(s.id)}><TrashIcon size={13} /></span>
                  </span>
                </div>
                <div className="grp-conn">
                  {fids.map((fid) => (
                    <span key={fid} className="tag removable">📁 {folderName(fid)} <small style={{ color: 'var(--text-3)' }}>[{folderPart[fid] ?? '?'}]</small>
                      <button className="tag-x" aria-label={`${folderName(fid)} 제거`} onClick={() => disconnectStyleFolder(s.id, fid)}>×</button>
                    </span>
                  ))}
                  {stylePicker === s.id ? (
                    <div className="folder-picker">
                      <div className="folder-picker-bar">
                        <input className="inline-input full" autoFocus value={styleQuery} placeholder="부위·폴더 검색…" aria-label="폴더 검색"
                          onChange={(e) => setStyleQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setStylePicker(null); setStyleQuery(''); } }} />
                        <button className="btn-ghost" onClick={() => { setStylePicker(null); setStyleQuery(''); }}>닫기</button>
                      </div>
                      <ul className="folder-picker-list">
                        {partOptions.map((o) => {
                          const opts = o.folders.filter((f) => !fids.includes(f.id)
                            && (!styleQuery.trim() || `${o.part} ${f.name}`.toLowerCase().includes(styleQuery.trim().toLowerCase())));
                          if (opts.length === 0) return null;
                          const chosen = (s.folders ?? []).some((x) => folderPart[x] === o.part);
                          return (
                            <li key={o.part}>
                              <div className="fp-part">{o.part}{chosen && <small style={{ color: 'var(--text-3)' }}> · 선택됨(교체)</small>}</div>
                              {opts.map((f) => (
                                <button key={f.id} className="folder-pick-item" onClick={() => connectStyleFolder(s.id, f.id)}>
                                  <span className="fp-path">📁 {f.name}</span><span className="fp-add">+ 담기</span>
                                </button>
                              ))}
                            </li>
                          );
                        })}
                        {partOptions.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>컨텐츠 그룹 관리의 교체 묶음에 폴더를 먼저 추가하세요</span></li>}
                      </ul>
                    </div>
                  ) : (
                    <button className="conn-add" onClick={() => { setStylePicker(s.id); setStyleQuery(''); }}>+ 상품그룹 담기</button>
                  )}
                </div>
              </li>
            );
          })}
          {styles.filter((s) => s.kind === activeCat).length === 0 && <li><div className="tree-item" style={{ paddingLeft: 20 }}><span className="hint">스타일 없음</span></div></li>}
        </ul>
        {addingStyle ? (
          <div className="folder-new">
            <input autoFocus value={newStyleName} placeholder={`${activeCat} 스타일 이름`} onChange={(e) => setNewStyleName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addStyle(activeCat); if (e.key === 'Escape') setAddingStyle(false); }} />
            <button className="btn-mini" onClick={() => addStyle(activeCat)}>생성</button>
          </div>
        ) : (
          activeCat && <button className="folder-new-cta" onClick={() => { setAddingStyle(true); setNewStyleName(''); }}>+ 스타일 추가</button>
        )}
      </section>

      {confirmDeleteTab && (
        <div className="modal-backdrop" onClick={() => setConfirmDeleteTab(null)}>
          <div className="modal confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">탭 삭제</h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-2)', margin: '4px 0 16px' }}>
              <b>{confirmDeleteTab}</b> 탭을 삭제할까요?<br />
              이 탭의 스타일 {styles.filter((s) => s.kind === confirmDeleteTab).length}개도 함께 삭제됩니다.
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
