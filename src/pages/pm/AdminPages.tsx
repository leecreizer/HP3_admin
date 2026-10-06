import { useMemo, useState } from 'react';
import type { Item } from '../../data/contentLibrary';
import { uid } from '../../pm/resolve';
import { loadGlobals, loadTemplates, saveGlobals, saveTemplates } from '../../pm/store';
import type { PmVar, VarTemplateFolder } from '../../pm/types';
import { Confirm, Unverified } from './ui';
import { VarDialog } from './VarPanel';
import { PARAM_TYPE_LABEL, VALUE_TYPE_LABEL } from './varMeta';

/**
 * 변수와 데이터(전역 변수 관리 페이지) — 09 캡처의 탭 그대로:
 * 전역 변수 · 변수 템플릿 · 변수 계열 템플릿 · 로컬 변수 업그레이드 · 모델 일괄 수정 · … · 모델 업데이트.
 * 전역 변수 · 변수 템플릿은 문서(3.1.10 · 3.1.3)대로, 나머지 탭은 화면을 열어 보지 못해 비활성.
 */
const TABS: { key: string; label: string; ready: boolean }[] = [
  { key: 'global', label: '전역 변수', ready: true }, { key: 'tpl', label: '변수 템플릿', ready: true }, { key: 'family', label: '변수 계열 템플릿', ready: false },
  { key: 'upgrade', label: '로컬 변수 업그레이드', ready: false }, { key: 'batch', label: '모델 일괄 수정', ready: false }, { key: 'batch2', label: '모델 일괄 수정(변수)', ready: false },
  { key: 'check', label: '모델 검사', ready: false }, { key: 'perf', label: '일괄 성능 진단', ready: false }, { key: 'rating', label: '변수 등급 라벨', ready: false },
  { key: 'hw', label: '가상 하드웨어 모델', ready: false }, { key: 'out', label: '사용자 출력 속성', ready: false }, { key: 'content', label: '사용자 내용 수정', ready: false },
  { key: 'update', label: '모델 업데이트', ready: false },
];

export function GlobalVarsPage({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const [tab, setTab] = useState('global');
  return (
    <div className="pm-admin" role="region" aria-label="변수와 데이터">
      <header>
        {TABS.map((t) => <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} disabled={!t.ready} title={t.ready ? undefined : '쿠지알러 화면 미확인'} onClick={() => setTab(t.key)}>{t.label}</button>)}
        <span style={{ flex: 1 }} />
        <button className="pm-btn xs" onClick={onClose}>에디터로 돌아가기</button>
      </header>
      <div className="body">
        {tab === 'global' ? <GlobalVars items={items} /> : <Templates />}
      </div>
    </div>
  );
}

function GlobalVars({ items }: { items: Item[] }) {
  const [list, setList] = useState<PmVar[]>(loadGlobals);
  const [edit, setEdit] = useState<{ v: PmVar; isNew: boolean } | null>(null);
  const [del, setDel] = useState<PmVar | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const query = q.trim().toLowerCase();
  const shown = list.filter((v) => !query || v.name.toLowerCase().includes(query) || v.label.toLowerCase().includes(query));
  const per = 15;
  const save = (next: PmVar[]) => { setList(next); saveGlobals(next); };
  const fake = useMemo(() => ({ id: 'g', name: '전역 변수', vars: list, groups: [] }), [list]);
  return (
    <>
      <div className="pm-admin-bar">
        <button className="pm-primary" onClick={() => setEdit({ v: { id: uid('G'), scope: 'custom', name: '', label: '', type: 'float', valueType: 'range', value: '0', min: '0', max: '1000', hideMode: 'unified', visible: true, editable: true }, isNew: true })}>＋ 전역 변수 만들기</button>
        <span className="pm-hint">변수 수: {list.length}/1000</span>
        <span className="grow" />
        <input className="pm-in" style={{ width: 220 }} type="search" placeholder="검색어 입력" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="전역 변수 검색" />
        <button className="pm-btn" disabled title="쿠지알러 화면 미확인">라벨 관리</button>
        <button className="pm-btn" disabled title="쿠지알러 화면 미확인">그룹 관리</button>
      </div>
      <table className="pm-table">
        <thead><tr><th>번호</th><th>이름</th><th>참조명</th><th>변수 형식</th><th>값 유형</th><th>현재값</th><th>숨김 방식</th><th>조작</th></tr></thead>
        <tbody>
          {shown.slice(page * per, page * per + per).map((v, i) => (
            <tr key={v.id}>
              <td>{page * per + i + 1}</td><td>{v.label}</td><td><code>{v.name}</code></td><td>{PARAM_TYPE_LABEL[v.type]}</td><td>{VALUE_TYPE_LABEL[v.valueType]}</td>
              <td>{v.type === 'material' && /^c:/i.test(v.value) ? <span className="pm-swatch" style={{ background: `#${v.value.slice(2)}`, display: 'inline-block' }} /> : <code>{v.valueType === 'formula' ? v.formula : v.value}</code>}</td>
              <td>{v.hideMode === 'local' ? '로컬 설정' : `통일 제어 · ${v.hidden === 'true' ? '숨김' : '보임'}`}</td>
              <td><button className="pm-link" onClick={() => setEdit({ v, isNew: false })}>편집</button> | <button className="pm-link" style={{ color: '#c4402f' }} onClick={() => setDel(v)}>삭제</button></td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={8} className="pm-empty">전역 변수가 없습니다. ‘전역 변수 만들기’로 추가하면 모델의 사용자 정의 변수 › ⓖ 로 가져와 씁니다.</td></tr>}
        </tbody>
      </table>
      {shown.length > per && <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {Array.from({ length: Math.ceil(shown.length / per) }, (_, i) => <button key={i} className={`pm-btn xs ${i === page ? 'blue' : ''}`} onClick={() => setPage(i)}>{i + 1}</button>)}
      </div>}
      {edit && <GlobalVarEdit v={edit.v} isNew={edit.isNew} items={items} model={fake} onClose={() => setEdit(null)}
        onSave={(v) => { save(edit.isNew ? [...list, v] : list.map((x) => (x.id === v.id ? v : x))); setEdit(null); }} />}
      {del && <Confirm danger text={<>전역 변수 <b>{del.label} ({del.name})</b> 을(를) 삭제할까요? 이 변수를 가져온 모델은 연결이 끊겨 모델에 남은 값으로 계산합니다.</>} ok="삭제"
        onCancel={() => setDel(null)} onOk={() => { save(list.filter((x) => x.id !== del.id)); setDel(null); }} />}
    </>
  );
}

/** 전역 변수 편집 — 사용자 정의 변수와 같은 항목 + 숨김 방식(통일 제어: 숨김 예/아니오 · 로컬 설정: 모델링 때 정함) — 문서 3.1.10 */
function GlobalVarEdit({ v, isNew, items, model, onSave, onClose }: { v: PmVar; isNew: boolean; items: Item[]; model: { id: string; name: string; vars: PmVar[]; groups: string[] }; onSave: (v: PmVar) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'unified' | 'local'>(v.hideMode ?? 'unified');
  const [hid, setHid] = useState(v.hidden === 'true');
  const extra = (
    <div className="pm-field"><label>숨김 방식</label>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <label className="pm-radio"><input type="radio" checked={mode === 'unified'} onChange={() => setMode('unified')} />통일 제어</label>
        {mode === 'unified' && <select className="pm-sel" style={{ width: 130 }} value={hid ? 'true' : 'false'} onChange={(e) => setHid(e.target.value === 'true')} aria-label="설계 툴 숨김"><option value="false">숨김: 아니오</option><option value="true">숨김: 예</option></select>}
        <label className="pm-radio"><input type="radio" checked={mode === 'local'} onChange={() => setMode('local')} />로컬 설정(모델링 때 정함)</label>
      </div>
    </div>
  );
  return <VarDialog v={v} isNew={isNew} model={model as never} items={items} global extra={extra} onClose={onClose}
    onSave={(x) => onSave({ ...x, hideMode: mode, hidden: mode === 'unified' ? (hid ? 'true' : 'false') : x.hidden })} />;
}

function Templates() {
  const [folders, setFolders] = useState<VarTemplateFolder[]>(loadTemplates);
  const [sel, setSel] = useState(folders[0]?.id ?? '');
  const [rename, setRename] = useState<string | null>(null);
  const [move, setMove] = useState<PmVar | null>(null);
  const save = (next: VarTemplateFolder[]) => { setFolders(next); saveTemplates(next); };
  const f = folders.find((x) => x.id === sel);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      <div>
        <div className="pm-folder-list">
          {folders.map((x) => (
            <button key={x.id} className={x.id === sel ? 'on' : ''} onClick={() => setSel(x.id)}><span className="pm-folder-ic" />
              {rename != null && x.id === sel ? <input className="pm-in" autoFocus value={rename} onChange={(e) => setRename(e.target.value)} onBlur={() => { if (rename.trim()) save(folders.map((y) => (y.id === x.id ? { ...y, name: rename.trim() } : y))); setRename(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> : x.name}
              <small style={{ marginLeft: 'auto', color: '#7a8494' }}>{x.vars.length}</small></button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button className="pm-btn xs" onClick={() => { const n = { id: uid('tf'), name: `새 그룹 ${folders.length + 1}`, vars: [] }; save([...folders, n]); setSel(n.id); }}>새 그룹</button>
          <button className="pm-btn xs" disabled={!f} onClick={() => setRename(f?.name ?? '')}>이름 바꾸기</button>
          <button className="pm-btn xs danger" disabled={!f || folders.length <= 1} onClick={() => { save(folders.filter((x) => x.id !== sel)); setSel(folders[0]?.id ?? ''); }}>삭제</button>
        </div>
      </div>
      <div>
        <table className="pm-table">
          <thead><tr><th>이름</th><th>참조명</th><th>변수 형식</th><th>값 유형</th><th>조작</th></tr></thead>
          <tbody>
            {f?.vars.map((v) => (
              <tr key={v.id}><td>{v.label}</td><td><code>{v.name}</code></td><td>{PARAM_TYPE_LABEL[v.type]}</td><td>{VALUE_TYPE_LABEL[v.valueType]}</td>
                <td><button className="pm-link" onClick={() => setMove(v)}>이동</button> | <button className="pm-link" style={{ color: '#c4402f' }} onClick={() => save(folders.map((x) => (x.id === sel ? { ...x, vars: x.vars.filter((y) => y.id !== v.id) } : x)))}>삭제</button></td></tr>
            ))}
            {!f?.vars.length && <tr><td colSpan={5} className="pm-empty">템플릿이 없습니다. 에디터에서 변수를 오른쪽 클릭 › ‘템플릿으로 저장’.</td></tr>}
          </tbody>
        </table>
        {move && (
          <div className="pm-admin-bar" style={{ marginTop: 10 }}>
            <span>‘{move.label}’ 을(를)</span>
            {folders.filter((x) => x.id !== sel).map((x) => <button key={x.id} className="pm-btn xs" onClick={() => { save(folders.map((y) => (y.id === sel ? { ...y, vars: y.vars.filter((z) => z.id !== move.id) } : y.id === x.id ? { ...y, vars: [...y.vars, move] } : y))); setMove(null); }}>{x.name}</button>)}
            <span>(으)로 이동</span><button className="pm-btn xs" onClick={() => setMove(null)}>취소</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 파라메트릭 모델링 설정 — 10 캡처: 에디터 설정 › 일반 › ‘모델 자동 업데이트’(예 · 아니오 · 매번 묻기) */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const KEY = 'hp3-pm-settings';
  const [v, setV] = useState<{ autoUpdate: '1' | '0' | '2' }>(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '') as { autoUpdate: '1' | '0' | '2' }; } catch { return { autoUpdate: '2' }; } });
  const [saved, setSaved] = useState(false);
  return (
    <div className="pm-admin" role="region" aria-label="파라메트릭 모델링 설정">
      <header><button className="tab on">에디터 설정</button><button className="tab" disabled title="쿠지알러 화면 미확인">일반 설정</button><span className="pm-hint" style={{ marginLeft: 12 }}>설정은 에디터 전체에 적용됩니다</span><span style={{ flex: 1 }} /><button className="pm-btn xs" onClick={onClose}>에디터로 돌아가기</button></header>
      <div className="body">
        <div style={{ display: 'flex', gap: 16 }}><b style={{ color: '#2266e8' }}>일반</b><span style={{ color: '#b0b7c2' }}>공간 모델링<Unverified /></span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10 }}>
          <b>모델 자동 업데이트</b>
          <div className="pm-radio-col">
            <span className="pm-hint">모델을 열 때 업데이트된 부품과 변수가 있으면 자동으로 업데이트</span>
            <div style={{ display: 'flex', gap: 14 }}>
              {([['1', '예'], ['0', '아니오'], ['2', '매번 묻기']] as const).map(([k, l]) => <label key={k} className="pm-radio"><input type="radio" checked={v.autoUpdate === k} onChange={() => { setV({ autoUpdate: k }); setSaved(false); }} />{l}</label>)}
            </div>
            <button className="pm-primary" style={{ alignSelf: 'flex-start' }} onClick={() => { localStorage.setItem(KEY, JSON.stringify(v)); setSaved(true); }}>설정 저장</button>
            {saved && <span className="pm-hint">저장했습니다 — 하위 모델은 열 때 항상 최신 저장본으로 계산합니다(HP3)</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
