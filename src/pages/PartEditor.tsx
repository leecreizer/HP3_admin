import { useState } from 'react';
import { SketchCanvas } from '../parts/SketchCanvas';
import { ExtrudePreview } from '../parts/ExtrudePreview';
import { loadParts, upsertPart, deletePart, newPart } from '../parts/partStore';
import { computeBBox, validateProfile } from '../parts/partGeometry';
import type { Part } from '../parts/types';

export function PartEditor() {
  const [parts, setParts] = useState<Part[]>(loadParts);
  const [cur, setCur] = useState<Part>(() => loadParts()[0] ?? newPart('새 파츠'));
  const [msg, setMsg] = useState<string>('');

  const patch = (p: Partial<Part>) => setCur((c) => ({ ...c, ...p }));

  const onNew = () => { const p = newPart('새 파츠'); setCur(p); setMsg(''); };
  const onSelect = (id: string) => { const p = parts.find((x) => x.id === id); if (p) { setCur(p); setMsg(''); } };
  const onSave = () => {
    const errs = validateProfile(cur.profile);
    if (errs.length) { setMsg('저장 불가: ' + errs.join(' ')); return; }
    const saved = { ...cur, bbox: computeBBox(cur.profile, cur.extrude.depth) };
    setParts(upsertPart(saved));
    setCur(saved);
    setMsg('저장됨');
  };
  const onDup = () => {
    const copy = { ...newPart(cur.name + ' 복제'), profile: cur.profile, extrude: cur.extrude, material: cur.material };
    setCur(copy);
  };
  const onDel = (id: string) => { setParts(deletePart(id)); if (cur.id === id) onNew(); };

  const errs = validateProfile(cur.profile);

  return (
    <main className="main">
      <div className="page-head"><h1>파츠 모델러</h1></div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 툴바 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onNew}>새 파츠</button>
          <input value={cur.name} onChange={(e) => patch({ name: e.target.value })} placeholder="파츠 이름" style={{ width: 160 }} />
          <button onClick={onSave}>저장</button>
          <button onClick={onDup}>복제</button>
          {msg && <span style={{ color: errs.length ? '#c33' : '#292', fontSize: '0.85rem' }}>{msg}</span>}
          <select onChange={(e) => e.target.value && onSelect(e.target.value)} value="" style={{ marginLeft: 'auto' }}>
            <option value="">— 저장된 파츠 불러오기 —</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.bbox.w}×{p.bbox.h}×{p.bbox.d})</option>)}
          </select>
        </div>

        {/* 좌우 분할 */}
        <div style={{ display: 'flex', gap: 12, minHeight: 620 }}>
          <div style={{ flex: 1 }}>
            <SketchCanvas profile={cur.profile} onChange={(profile) => patch({ profile })} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
              <span>두께(mm)</span>
              <input type="number" value={cur.extrude.depth} style={{ width: 80 }}
                onChange={(e) => patch({ extrude: { ...cur.extrude, depth: Number(e.target.value) } })} />
              <span>작업 평면</span>
              <select value={cur.plane ?? 'XY'} onChange={(e) => patch({ plane: e.target.value as Part['plane'] })}>
                <option value="XY">정면 XY (앞쪽으로 압출)</option>
                <option value="XZ">평면 XZ (위로 압출)</option>
                <option value="YZ">측면 YZ (옆으로 압출)</option>
              </select>
              <span>색상</span>
              <input type="color" value={cur.material?.color ?? '#d8c5a8'}
                onChange={(e) => patch({ material: { ...cur.material, color: e.target.value } })} />
              <span style={{ marginLeft: 'auto', color: '#888' }}>
                크기 {computeBBox(cur.profile, cur.extrude.depth).w}×{computeBBox(cur.profile, cur.extrude.depth).h}×{cur.extrude.depth}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 560 }}>
              {errs.length === 0
                ? <ExtrudePreview profile={cur.profile} depth={cur.extrude.depth} color={cur.material?.color} plane={cur.plane ?? 'XY'} />
                : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#c33' }}>{errs.join(' / ')}</div>}
            </div>
          </div>
        </div>

        {/* 라이브러리 삭제 목록 */}
        {parts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem' }}>
            {parts.map((p) => (
              <span key={p.id} style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 8px', display: 'inline-flex', gap: 6 }}>
                {p.name}
                <button onClick={() => onDel(p.id)} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}