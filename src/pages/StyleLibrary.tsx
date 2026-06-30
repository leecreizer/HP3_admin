import { useEffect, useRef, useState } from 'react';
import { PencilIcon, TrashIcon } from '../components/icons';
import { loadSwapState, saveSwapState, type StyleSet } from '../data/groups';

/**
 * 스타일 그룹 관리 — 컨텐츠 그룹 관리에서 만든 모델 그룹들의 묶음(스타일).
 * - 스타일 카테고리(탭)별로 스타일을 만들고, 각 스타일에 모델 그룹들을 묶는다.
 */
export function StyleLibrary() {
  const saved = useRef(loadSwapState()).current;
  // 모델 그룹/폴더/상품 등은 이 페이지에서 변경하지 않으므로 로드값을 보존해 저장
  const groups = saved.groups;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;

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
    setStyles((p) => [...p, { id: `st-${Date.now()}`, name, kind: cat, groupIds: [] }]);
    setNewStyleName(''); setAddingStyle(false);
  };
  const commitStyleRename = () => {
    const name = styleRenameDraft.trim();
    if (styleRenaming && name) setStyles((p) => p.map((s) => (s.id === styleRenaming ? { ...s, name } : s)));
    setStyleRenaming(null);
  };
  const deleteStyle = (id: string) => setStyles((p) => p.filter((s) => s.id !== id));
  const connectStyleGroup = (styleId: string, gid: string) =>
    setStyles((p) => p.map((s) => (s.id === styleId && !(s.groupIds ?? []).includes(gid) ? { ...s, groupIds: [...(s.groupIds ?? []), gid] } : s)));
  const disconnectStyleGroup = (styleId: string, gid: string) =>
    setStyles((p) => p.map((s) => (s.id === styleId ? { ...s, groupIds: (s.groupIds ?? []).filter((x) => x !== gid) } : s)));

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
          <b>{activeCat || '스타일 탭'}</b> 스타일입니다. 각 스타일의 <b>+ 그룹 추가</b>로 <b>컨텐츠 그룹 관리</b>에서 만든 모델 그룹들을 묶으세요.
        </p>
        <ul className="tree">
          {styles.filter((s) => s.kind === activeCat).map((s) => {
            const gids = s.groupIds ?? [];
            const matches = groups.filter((g) => !gids.includes(g.id) && (!styleQuery.trim() || g.name.toLowerCase().includes(styleQuery.trim().toLowerCase())));
            return (
              <li key={s.id}>
                <div className="tree-item" style={{ paddingLeft: 20 }}>
                  {styleRenaming === s.id ? (
                    <input className="inline-input tree-rename" autoFocus value={styleRenameDraft}
                      onChange={(e) => setStyleRenameDraft(e.target.value)}
                      onBlur={commitStyleRename} onKeyDown={(e) => { if (e.key === 'Enter') commitStyleRename(); if (e.key === 'Escape') setStyleRenaming(null); }} />
                  ) : (<span className="t">{s.name}</span>)}
                  <span className="count">{gids.length}</span>
                  <span className="tree-actions">
                    <span className="tree-act" role="button" title="이름 변경" onClick={() => { setStyleRenaming(s.id); setStyleRenameDraft(s.name); }}><PencilIcon size={13} /></span>
                    <span className="tree-act" role="button" title="스타일 삭제" onClick={() => deleteStyle(s.id)}><TrashIcon size={13} /></span>
                  </span>
                </div>
                <div className="grp-conn">
                  {gids.map((gid) => (
                    <span key={gid} className="tag removable">{groupName(gid)}
                      <button className="tag-x" aria-label={`${groupName(gid)} 제거`} onClick={() => disconnectStyleGroup(s.id, gid)}>×</button>
                    </span>
                  ))}
                  {stylePicker === s.id ? (
                    <div className="folder-picker">
                      <div className="folder-picker-bar">
                        <input className="inline-input full" autoFocus value={styleQuery} placeholder="모델 그룹 검색…" aria-label="그룹 검색"
                          onChange={(e) => setStyleQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setStylePicker(null); setStyleQuery(''); } }} />
                        <button className="btn-ghost" onClick={() => { setStylePicker(null); setStyleQuery(''); }}>닫기</button>
                      </div>
                      <ul className="folder-picker-list">
                        {matches.map((g) => (
                          <li key={g.id}><button className="folder-pick-item" onClick={() => connectStyleGroup(s.id, g.id)}>
                            <span className="fp-path">{g.name} <small style={{ color: 'var(--text-3)' }}>{g.kind}</small></span><span className="fp-add">+ 추가</span></button></li>
                        ))}
                        {matches.length === 0 && <li><span className="hint" style={{ display: 'block', padding: '6px 8px' }}>일치하는 모델 그룹 없음</span></li>}
                      </ul>
                    </div>
                  ) : (
                    <button className="conn-add" onClick={() => { setStylePicker(s.id); setStyleQuery(''); }}>+ 그룹 추가</button>
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
