import { useMemo, useState } from 'react';
import type { Item } from '../../data/contentLibrary';
import { INSERT_KEYS, SECTION_LABEL, toolElements, type ElementDef } from '../../pm/defs';
import { PART_FOLDERS, type ToolType } from '../../pm/modelTypes';
import { loadModels } from '../../pm/store';
import type { PmModel } from '../../pm/types';

const ICON: Record<string, string> = {
  'PrimitiveModel.plank': '▭', 'PrimitiveModel.lofting': '⌒', 'PrimitiveModel.brepSweep': '∿', 'PrimitiveModel.brepSweepExtend': '⟋',
  'PrimitiveModel.grid': '▦', 'PrimitiveModel.sideStylePlank': '◱', moldingPaths: '⌓', innerFrameModels: '⬚', customDoorHoles: '⌂',
  intersectBoxes: '⧈', adsorbs: '⇥', connectors: '⊙', connectorModels: '⊕', wireLayouts: '〰', customAuxiliaries: '✚',
};

/** 요소 라이브러리(元件库) — 도구 종류별 파라메트릭 모델 요소 + 보조 구조. 단축키는 쿠지알러 단축키 창 그대로 */
export function ElementLib({ tool, onInsert }: { tool: ToolType; onInsert: (d: ElementDef) => void }) {
  const { elements, aux } = toolElements(tool);
  const sections = [...new Set(aux.map((a) => a.section))];
  const card = (d: ElementDef) => (
    <button key={d.id} className="pm-card" title={`${d.name} (${d.zh})${INSERT_KEYS[d.id] ? ` — ${INSERT_KEYS[d.id]}` : ''}`} onClick={() => onInsert(d)}>
      <i aria-hidden="true">{ICON[d.id] ?? ICON[d.section] ?? '◇'}</i>{d.name}{INSERT_KEYS[d.id] && <kbd>{INSERT_KEYS[d.id]}</kbd>}
    </button>
  );
  return (
    <div className="pm-lib">
      <h4>파라메트릭 모델 요소</h4>
      <div className="pm-cards">{elements.map(card)}</div>
      {sections.map((s) => (
        <div key={s}>
          <h4>{SECTION_LABEL[s] ?? s}</h4>
          <div className="pm-cards">{aux.filter((a) => a.section === s).map(card)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * 부품 라이브러리(部件库) — 도구 종류별 폴더(미분류 · 캐비닛 모드 · 조합 · 부품 모드 · 내부 부품 · 반제품 · 액세서리 · 가상 부품)
 * 의 파라메트릭 모델 + 컨텐츠 라이브러리 3D 모델(메시 래퍼 furnitureWithMaterial).
 */
export function PartLib({ model, items, onInsertModel, onInsertMesh }: { model: PmModel; items: Item[]; onInsertModel: (m: PmModel) => void; onInsertMesh: (i: Item) => void }) {
  const folders = PART_FOLDERS[model.tooltype];
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const models = useMemo(() => loadModels().filter((m) => m.id !== model.id), [model.id]);
  const meshes = useMemo(() => items.filter((i) => i.model3d?.kind === 'glb'), [items]);
  const query = q.trim().toLowerCase();
  const list = open === '__mesh' ? [] : models.filter((m) => {
    const f = folders.find((x) => x.name === open);
    return (!f || (m.lib != null && f.libs.includes(m.lib))) && (!query || m.name.toLowerCase().includes(query));
  });
  if (!open) return (
    <div className="pm-lib">
      <input className="pm-in" type="search" placeholder="부품 검색" value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value) setOpen('__all'); }} aria-label="부품 검색" />
      <div className="pm-folder-list">
        {folders.map((f) => {
          const n = models.filter((m) => m.lib != null && f.libs.includes(m.lib)).length;
          return <button key={f.name} onClick={() => setOpen(f.name)}><span className="pm-folder-ic" />{f.name}<small style={{ marginLeft: 'auto', color: '#7a8494' }}>{n}</small></button>;
        })}
        <button onClick={() => setOpen('__mesh')}><span className="pm-folder-ic" />3D 모델 (컨텐츠 라이브러리)<small style={{ marginLeft: 'auto', color: '#7a8494' }}>{meshes.length}</small></button>
      </div>
      <p className="pm-hint">파라메트릭 모델은 ‘저장’한 모델이 소속 라이브러리 폴더에 나옵니다. 3D 모델은 크기(W·D·H)에 맞춰 늘어나는 메시 부품으로 들어갑니다.</p>
    </div>
  );
  return (
    <div className="pm-lib">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="pm-btn xs" onClick={() => { setOpen(null); setQ(''); }}>‹ 폴더</button>
        <b style={{ fontSize: 12 }}>{open === '__mesh' ? '3D 모델' : open === '__all' ? '검색 결과' : open}</b>
      </div>
      {open !== '__mesh' && open !== '__all' && <input className="pm-in" type="search" placeholder="부품 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="부품 검색" />}
      <div className="pm-parts">
        {open === '__mesh'
          ? meshes.filter((i) => !query || i.name.toLowerCase().includes(query)).map((i) => (
            <button key={i.id} className="pm-part" onClick={() => onInsertMesh(i)} title={i.name}>
              {i.img ? <img src={i.img} alt="" /> : <span className="noimg">▣</span>}<span>{i.name}</span><small>{i.modelSize || i.size}</small>
            </button>))
          : list.map((m) => (
            <button key={m.id} className="pm-part" onClick={() => onInsertModel(m)} title={m.name}>
              {m.preview ? <img src={m.preview} alt="" /> : <span className="noimg">P</span>}<span>{m.name}</span><small>{m.category}</small>
            </button>))}
      </div>
      {open === '__mesh' && !meshes.length && <p className="pm-empty">컨텐츠 라이브러리에 3D 모델(GLB)이 없습니다.</p>}
      {open !== '__mesh' && !list.length && <p className="pm-empty">이 폴더에 저장된 모델이 없습니다.</p>}
    </div>
  );
}
