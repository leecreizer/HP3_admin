import { useRef, useState } from 'react';
import { SketchCanvas } from '../parts/SketchCanvas';
import { ExtrudePreview } from '../parts/ExtrudePreview';
import { loadParts, upsertPart, deletePart, newPart } from '../parts/partStore';
import { computeBBox, validateProfile, profileThumb } from '../parts/partGeometry';
import { buildScope, resolveCorners } from '../parts/formula';
import type { Part, Corner, PartVar, Vec2, Profile } from '../parts/types';

const NUM_RE = /^-?\d*\.?\d+$/;

export function PartEditor() {
  const [parts, setParts] = useState<Part[]>(loadParts);
  const [cur, setCur] = useState<Part>(() => loadParts()[0] ?? newPart('새 파츠'));
  const [msg, setMsg] = useState<string>('');

  const patch = (p: Partial<Part>) => setCur((c) => ({ ...c, ...p }));

  // ── 변수 → 스코프 → 좌표 수식 해석 ─────────────────────────────
  const vars: PartVar[] = cur.vars ?? [];
  const scope = buildScope(vars, { T: cur.extrude.depth });
  const rawCs: Corner[] = cur.profile.contours[0]?.corners ?? [];
  const resolvedCs = resolveCorners(rawCs, scope);
  const resolvedProfile: Profile = {
    ...cur.profile,
    contours: [{ closed: true, corners: resolvedCs }, ...cur.profile.contours.slice(1)],
  };
  const bbox = computeBBox(resolvedProfile, cur.extrude.depth);
  const errs = validateProfile(resolvedProfile);

  // ── 원본(raw) 편집 헬퍼 ───────────────────────────────────────
  const setRawCs = (cs: Corner[]) =>
    patch({ profile: { ...cur.profile, contours: [{ closed: true, corners: cs }, ...cur.profile.contours.slice(1)] } });
  const editPoint = (i: number, axis: 0 | 1, str: string) => {
    const t = str.trim();
    const isNum = NUM_RE.test(t);
    setRawCs(rawCs.map((c, k) => {
      if (k !== i) return c;
      if (axis === 0) return isNum ? { ...c, pt: [Number(t), c.pt[1]] as Vec2, xExpr: undefined } : { ...c, xExpr: str };
      return isNum ? { ...c, pt: [c.pt[0], Number(t)] as Vec2, yExpr: undefined } : { ...c, yExpr: str };
    }));
  };
  const setPointR = (i: number, r: number) => setRawCs(rawCs.map((c, k) => (k === i ? { ...c, r } : c)));

  // 캔버스 편집(드래그/추가/삭제) → raw로 역매핑. 바뀐 축은 리터럴 확정+수식 해제.
  const applyCanvasChange = (np: Profile) => {
    const nc = np.contours[0]?.corners ?? [];
    if (nc.length !== rawCs.length) {
      setRawCs(nc.map((c) => ({ pt: c.pt, r: c.r }))); // 추가/삭제: 리터럴로 채택
      return;
    }
    setRawCs(rawCs.map((rc, i) => {
      const nv = nc[i]; const rv = resolvedCs[i];
      const out: Corner = { ...rc, r: nv.r };
      let px = rc.pt[0], py = rc.pt[1];
      if (nv.pt[0] !== rv.pt[0]) { px = nv.pt[0]; out.xExpr = undefined; }
      if (nv.pt[1] !== rv.pt[1]) { py = nv.pt[1]; out.yExpr = undefined; }
      out.pt = [px, py];
      return out;
    }));
  };

  // ── 변수 편집 ─────────────────────────────────────────────────
  const setVars = (v: PartVar[]) => patch({ vars: v });
  const addVar = () => setVars([...vars, { name: `V${vars.length + 1}`, expr: '0' }]);
  const delVar = (i: number) => setVars(vars.filter((_, k) => k !== i));
  const setVar = (i: number, p: Partial<PartVar>) => setVars(vars.map((v, k) => (k === i ? { ...v, ...p } : v)));

  // ── 파츠 CRUD ─────────────────────────────────────────────────
  const onNew = () => { setCur(newPart('새 파츠')); setMsg(''); };
  const onSelect = (id: string) => { const p = parts.find((x) => x.id === id); if (p) { setCur(p); setMsg(''); } };
  const onSave = () => {
    if (errs.length) { setMsg('저장 불가: ' + errs.join(' ')); return; }
    const saved: Part = {
      ...cur,
      name: cur.name.trim() || '새 파츠',
      bbox,
      thumb: profileThumb(resolvedProfile, cur.material?.color ?? '#d8c5a8'),
    };
    setParts(upsertPart(saved));
    setCur(saved);
    setMsg(`저장됨 · 라이브러리 ${loadParts().length}개`);
  };
  const onDup = () => setCur({ ...newPart(cur.name + ' 복제'), profile: cur.profile, extrude: cur.extrude, material: cur.material, plane: cur.plane, vars: cur.vars });
  const onDel = (id: string) => { setParts(deletePart(id)); if (cur.id === id) onNew(); };

  // ── 파일로 내보내기 / 불러오기 ────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null);
  const onExport = () => {
    const data = JSON.stringify({ ...cur, name: cur.name.trim() || '새 파츠' }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(cur.name.trim() || 'part').replace(/[\\/:*?"<>|\s]+/g, '_')}.part.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg('파일로 저장됨');
  };
  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 다시 선택 허용
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(String(reader.result)) as Part;
        if (!p?.profile?.contours?.length || !p.extrude) throw new Error('bad');
        const loaded: Part = { ...newPart(p.name || '가져온 파츠'), ...p, id: p.id || newPart('x').id };
        setCur(loaded);
        setMsg(`파일 불러옴: ${loaded.name}`);
      } catch {
        setMsg('불러오기 실패: 올바른 파츠 파일(.part.json)이 아닙니다');
      }
    };
    reader.readAsText(f);
  };

  const th: React.CSSProperties = { textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', padding: '2px 6px', fontSize: '0.72rem' };
  const td: React.CSSProperties = { padding: '2px 6px' };

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
          <span style={{ width: 1, alignSelf: 'stretch', background: '#ddd' }} />
          <button onClick={onExport} title="현재 파츠를 파일(.part.json)로 저장">파일로 저장</button>
          <button onClick={() => fileRef.current?.click()} title="파츠 파일 불러오기">파일 열기</button>
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={onImportFile} style={{ display: 'none' }} />
          {msg && <span style={{ color: errs.length ? '#c33' : '#292', fontSize: '0.85rem' }}>{msg}</span>}
          <span style={{ marginLeft: 'auto', color: '#888', fontSize: '0.8rem' }}>저장된 파츠 {parts.length}개</span>
        </div>

        {/* 좌우 분할 */}
        <div style={{ display: 'flex', gap: 12, minHeight: 620 }}>
          <div style={{ flex: 1 }}>
            <SketchCanvas profile={resolvedProfile} onChange={applyCanvasChange} />
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
              <span style={{ marginLeft: 'auto', color: '#888' }}>크기 {bbox.w}×{bbox.h}×{bbox.d}</span>
            </div>
            <div style={{ flex: 1, minHeight: 560 }}>
              {errs.length === 0
                ? <ExtrudePreview profile={resolvedProfile} depth={cur.extrude.depth} color={cur.material?.color} plane={cur.plane ?? 'XY'} />
                : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#c33' }}>{errs.join(' / ')}</div>}
            </div>
          </div>
        </div>

        {/* 변수 + 점 목록 (수식 구동) */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* 변수 */}
          <div style={{ minWidth: 320 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
              변수 <span style={{ color: '#888', fontWeight: 400 }}>· 점 수식에서 #이름 으로 참조 (내장 #T = 두께)</span>
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr><th style={th}>이름</th><th style={th}>수식</th><th style={th}>계산값</th><th style={th}></th></tr></thead>
              <tbody>
                {vars.map((v, i) => {
                  const val = scope[v.name.replace(/^#/, '')];
                  return (
                    <tr key={i}>
                      <td style={td}><input value={v.name} style={{ width: 80 }} onChange={(e) => setVar(i, { name: e.target.value })} /></td>
                      <td style={td}><input value={v.expr} style={{ width: 130 }} onChange={(e) => setVar(i, { expr: e.target.value })} /></td>
                      <td style={{ ...td, color: val == null ? '#c33' : '#333' }}>{val == null ? '오류' : Math.round(val * 100) / 100}</td>
                      <td style={td}><button onClick={() => delVar(i)} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button onClick={addVar} style={{ marginTop: 4, fontSize: '0.8rem' }}>+ 변수 추가</button>
          </div>

          {/* 점 목록 */}
          <div style={{ minWidth: 380 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
              점 목록 <span style={{ color: '#888', fontWeight: 400 }}>· X/Y에 숫자 또는 수식(예: #W, #W/2, #T*2)</span>
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead><tr><th style={th}>#</th><th style={th}>X</th><th style={th}>Y</th><th style={th}>R</th><th style={th}>계산 (x, y)</th></tr></thead>
              <tbody>
                {rawCs.map((c, i) => {
                  const rv = resolvedCs[i];
                  return (
                    <tr key={i}>
                      <td style={{ ...td, color: '#888' }}>{i + 1}</td>
                      <td style={td}><input value={c.xExpr ?? String(c.pt[0])} style={{ width: 90, color: c.xExpr ? '#26a' : undefined }}
                        onChange={(e) => editPoint(i, 0, e.target.value)} /></td>
                      <td style={td}><input value={c.yExpr ?? String(c.pt[1])} style={{ width: 90, color: c.yExpr ? '#26a' : undefined }}
                        onChange={(e) => editPoint(i, 1, e.target.value)} /></td>
                      <td style={td}><input type="number" min={0} value={c.r ?? 0} style={{ width: 60 }}
                        onChange={(e) => setPointR(i, Math.max(0, Number(e.target.value)))} /></td>
                      <td style={{ ...td, color: '#555' }}>({rv.pt[0]}, {rv.pt[1]})</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <span style={{ fontSize: '0.72rem', color: '#888' }}>파란 글씨 = 수식 구동. 캔버스에서 그 점을 드래그하면 수식이 해제되고 좌표로 고정됩니다.</span>
          </div>
        </div>

        {/* 저장된 파츠 라이브러리 */}
        {parts.length > 0 && (
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 8px' }}>저장된 파츠</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {parts.map((p) => (
                <div key={p.id} onClick={() => onSelect(p.id)} title="클릭해서 불러오기"
                  style={{
                    width: 100, padding: 6, borderRadius: 8, cursor: 'pointer', position: 'relative',
                    border: cur.id === p.id ? '2px solid #36c' : '1px solid #ddd',
                    background: cur.id === p.id ? 'rgba(54,108,204,0.06)' : '#fff',
                  }}>
                  {p.thumb
                    ? <img src={p.thumb} alt={p.name} width={80} height={80} style={{ display: 'block', margin: '0 auto', borderRadius: 4 }} />
                    : <div style={{ height: 80, display: 'grid', placeItems: 'center', color: '#bbb' }}>—</div>}
                  <div style={{ fontSize: '0.75rem', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <div style={{ fontSize: '0.68rem', color: '#888', textAlign: 'center' }}>{p.bbox.w}×{p.bbox.h}×{p.bbox.d}</div>
                  <button onClick={(e) => { e.stopPropagation(); onDel(p.id); }} title="삭제"
                    style={{ position: 'absolute', top: 2, right: 4, border: 'none', background: 'none', color: '#c33', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}