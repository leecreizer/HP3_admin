import { useState } from 'react';
import { SketchCanvas } from '../parts/SketchCanvas';
import { ExtrudePreview } from '../parts/ExtrudePreview';
import { loadParts, upsertPart, deletePart, newPart } from '../parts/partStore';
import { computeBBox, validateProfile, profileThumb } from '../parts/partGeometry';
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
    const name = cur.name.trim() || '새 파츠';
    const saved: Part = {
      ...cur,
      name,
      bbox: computeBBox(cur.profile, cur.extrude.depth),
      thumb: profileThumb(cur.profile, cur.material?.color ?? '#d8c5a8'),
    };
    setParts(upsertPart(saved));
    setCur(saved);
    setMsg(`저장됨 · 라이브러리 ${loadParts().length}개`);
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
          <span style={{ marginLeft: 'auto', color: '#888', fontSize: '0.8rem' }}>저장된 파츠 {parts.length}개</span>
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

        {/* 저장된 파츠 라이브러리 — 썸네일 카드(클릭 불러오기, × 삭제) */}
        {parts.length > 0 && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 8px' }}>
              저장된 파츠
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {parts.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  title="클릭해서 불러오기"
                  style={{
                    width: 100, padding: 6, borderRadius: 8, cursor: 'pointer', position: 'relative',
                    border: cur.id === p.id ? '2px solid #36c' : '1px solid #ddd',
                    background: cur.id === p.id ? 'rgba(54,108,204,0.06)' : '#fff',
                  }}
                >
                  {p.thumb
                    ? <img src={p.thumb} alt={p.name} width={80} height={80} style={{ display: 'block', margin: '0 auto', borderRadius: 4 }} />
                    : <div style={{ height: 80, display: 'grid', placeItems: 'center', color: '#bbb' }}>—</div>}
                  <div style={{ fontSize: '0.75rem', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: '0.68rem', color: '#888', textAlign: 'center' }}>{p.bbox.w}×{p.bbox.h}×{p.bbox.d}</div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDel(p.id); }}
                    title="삭제"
                    style={{ position: 'absolute', top: 2, right: 4, border: 'none', background: 'none', color: '#c33', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}