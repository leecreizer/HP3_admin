import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { Object3D } from 'three';
import { loadParts, upsertPart } from '../parts/partStore';
import type { Part } from '../parts/types';
import { loadAssembly, saveAssembly, newPlacement, type Assembly, type Placement } from '../parts/assemblyStore';
import { PartObject } from '../parts/PartObject';
import { evalExpr, buildScope } from '../parts/formula';

const MM = 0.001;
const SNAP = 10; // mm — 기즈모 이동 스냅
const num = (s: string, scope: Record<string, number>) => evalExpr(s, scope) ?? 0;
const snapMm = (mMeters: number) => Math.round(mMeters / MM / SNAP) * SNAP;

export function AssemblyEditor() {
  const [parts, setParts] = useState(loadParts);
  const reloadParts = () => setParts(loadParts());
  const partMap = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [impMsg, setImpMsg] = useState('');

  // 외부 파일(.part.json) 불러오기 → 라이브러리에 저장 후 목록 갱신
  const onImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files?.length) return;
    let ok = 0;
    const read = (f: File) => new Promise<void>((res) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const p = JSON.parse(String(r.result)) as Part;
          if (p?.profile?.contours?.length && p.extrude) {
            upsertPart({ ...p, id: p.id || `imp-${Date.now()}-${Math.floor(Math.random() * 1e4)}` });
            ok++;
          }
        } catch { /* skip */ }
        res();
      };
      r.onerror = () => res();
      r.readAsText(f);
    });
    await Promise.all(Array.from(files).map(read));
    reloadParts();
    setImpMsg(`${ok}개 불러옴`);
  };
  const [asm, setAsm] = useState<Assembly>(loadAssembly);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => { saveAssembly(asm); }, [asm]);

  // 선택된 배치의 3D 오브젝트(기즈모 부착용)
  const objs = useRef<Map<string, Object3D>>(new Map());
  const [selObj, setSelObj] = useState<Object3D | null>(null);
  useEffect(() => { setSelObj(sel ? objs.current.get(sel) ?? null : null); }, [sel, asm.items]);

  const asmScope = buildScope(asm.vars, {});
  const scopeFor = (pl: Placement, i: number): Record<string, number> => {
    const p = partMap.get(pl.partId);
    return { ...asmScope, W: p?.bbox.w ?? 0, H: p?.bbox.h ?? 0, D: p?.bbox.d ?? 0, i };
  };

  const setItems = (items: Placement[]) => setAsm((a) => ({ ...a, items }));
  const setVars = (vars: Assembly['vars']) => setAsm((a) => ({ ...a, vars }));
  const addPart = (partId: string) => { const pl = newPlacement(partId); setAsm((a) => ({ ...a, items: [...a.items, pl] })); setSel(pl.id); };
  const delItem = (id: string) => { setItems(asm.items.filter((x) => x.id !== id)); if (sel === id) setSel(null); };
  const setField = (id: string, k: keyof Placement, v: string) =>
    setItems(asm.items.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const addVar = () => setVars([...asm.vars, { name: `V${asm.vars.length + 1}`, expr: '0' }]);
  const delVar = (i: number) => setVars(asm.vars.filter((_, k) => k !== i));
  const setVar = (i: number, p: Partial<{ name: string; expr: string }>) =>
    setVars(asm.vars.map((v, k) => (k === i ? { ...v, ...p } : v)));

  // 기즈모 이동 → 스냅해서 위치 수식을 리터럴로 확정
  const onGizmo = () => {
    if (!selObj || !sel) return;
    const p = selObj.position;
    setItems(asm.items.map((x) => (x.id === sel
      ? { ...x, px: String(snapMm(p.x)), py: String(snapMm(p.y)), pz: String(snapMm(p.z)) }
      : x)));
  };

  const selItem = asm.items.find((x) => x.id === sel) ?? null;
  const selPart = selItem ? partMap.get(selItem.partId) : null;

  const th: React.CSSProperties = { textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', padding: '2px 5px', fontSize: '0.7rem' };
  const td: React.CSSProperties = { padding: '1px 4px' };
  const lbl: React.CSSProperties = { fontSize: '0.76rem', color: 'var(--text-2)', width: 44, display: 'inline-block' };

  const axisRow = (label: string, keys: [keyof Placement, keyof Placement, keyof Placement]) => selItem && (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
      <span style={lbl}>{label}</span>
      {keys.map((k) => (
        <input key={k} value={selItem[k] as string} style={{ width: 60 }}
          onChange={(e) => setField(selItem.id, k, e.target.value)} />
      ))}
    </div>
  );

  return (
    <main className="main">
      <div className="page-head"><h1>조립</h1></div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 파츠 추가 툴바 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
          <b>파츠 추가</b>
          <select value="" onChange={(e) => { if (e.target.value) { addPart(e.target.value); e.target.value = ''; } }} style={{ minWidth: 200 }}>
            <option value="">— 저장된 파츠 선택 —</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.bbox.w}×{p.bbox.h}×{p.bbox.d})</option>)}
          </select>
          <button onClick={reloadParts} title="파츠 모델러에서 저장한 파츠를 다시 불러옵니다">목록 새로고침</button>
          <button onClick={() => fileRef.current?.click()} title="외부 .part.json 파일에서 파츠 불러오기">파일에서 불러오기</button>
          <input ref={fileRef} type="file" accept=".json,application/json" multiple onChange={onImportFiles} style={{ display: 'none' }} />
          {impMsg && <span style={{ color: '#292' }}>{impMsg}</span>}
          <span style={{ color: '#888' }}>저장된 파츠 {parts.length}개 · 팔레트에서 클릭하거나 위 목록에서 선택해 추가</span>
        </div>
        <div style={{ display: 'flex', gap: 12, minHeight: 560 }}>
          {/* 파츠 팔레트 */}
          <div style={{ width: 150, borderRight: '1px solid var(--line,#eee)', paddingRight: 10, overflowY: 'auto', maxHeight: 620 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>파츠 팔레트</div>
            {parts.length === 0 && <div style={{ fontSize: '0.76rem', color: '#999' }}>저장된 파츠가 없습니다. 파츠 모델러에서 만들어 저장하세요.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {parts.map((p) => (
                <button key={p.id} onClick={() => addPart(p.id)} title="클릭해서 조립에 추가"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 5, cursor: 'pointer', textAlign: 'left', border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}>
                  {p.thumb
                    ? <img src={p.thumb} width={34} height={34} alt="" style={{ borderRadius: 3, flexShrink: 0 }} />
                    : <span style={{ width: 34, height: 34, borderRadius: 3, background: p.material?.color ?? '#d8c5a8', flexShrink: 0 }} />}
                  <span style={{ fontSize: '0.74rem', overflow: 'hidden' }}>
                    <span style={{ display: 'block', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.name}</span>
                    <span style={{ color: '#999', fontSize: '0.66rem' }}>{p.bbox.w}×{p.bbox.h}×{p.bbox.d}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 3D 실시간 뷰 + 기즈모 */}
          <div style={{ flex: 1, minHeight: 560 }}>
            <Canvas camera={{ position: [1.2, 1, 1.2], fov: 45 }} style={{ width: '100%', height: '100%', background: '#1a1c20' }}
              onPointerMissed={() => setSel(null)}>
              <ambientLight intensity={0.6} />
              <directionalLight position={[2, 3, 2]} intensity={1} />
              <axesHelper args={[0.5]} />
              <gridHelper args={[4, 40, '#555', '#2a2a2a']} />
              <OrbitControls makeDefault />
              {asm.items.map((pl, i) => {
                const part = partMap.get(pl.partId);
                if (!part) return null;
                const sc = scopeFor(pl, i);
                const pos: [number, number, number] = [num(pl.px, sc) * MM, num(pl.py, sc) * MM, num(pl.pz, sc) * MM];
                const rot: [number, number, number] = [num(pl.rx, sc) * Math.PI / 180, num(pl.ry, sc) * Math.PI / 180, num(pl.rz, sc) * Math.PI / 180];
                return (
                  <group key={pl.id} position={pos} rotation={rot}
                    ref={(o) => { if (o) objs.current.set(pl.id, o); else objs.current.delete(pl.id); }}>
                    <PartObject part={part} selected={sel === pl.id} onSelect={() => setSel(pl.id)} />
                  </group>
                );
              })}
              {selObj && (
                <TransformControls object={selObj} mode="translate" translationSnap={SNAP * MM} onObjectChange={onGizmo} />
              )}
            </Canvas>
          </div>

          {/* 선택 정보 패널 */}
          <div style={{ width: 240, borderLeft: '1px solid var(--line,#eee)', paddingLeft: 12 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>선택 정보</div>
            {!selItem && <div style={{ fontSize: '0.78rem', color: '#999' }}>3D에서 파츠를 클릭하거나 아래 배치 목록에서 선택하세요.</div>}
            {selItem && (
              <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div><b>{selPart?.name ?? '(삭제된 파츠)'}</b></div>
                {selPart && <div style={{ color: '#888', fontSize: '0.74rem' }}>크기 {selPart.bbox.w}×{selPart.bbox.h}×{selPart.bbox.d} mm · 평면 {selPart.plane ?? 'XY'}</div>}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>위치 (mm)</div>
                  {axisRow('X Y Z', ['px', 'py', 'pz'])}
                  <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>회전 (도)</div>
                  {axisRow('X Y Z', ['rx', 'ry', 'rz'])}
                </div>
                <div style={{ color: '#888', fontSize: '0.72rem' }}>3D의 화살표(기즈모)를 끌어 {SNAP}mm 단위로 이동할 수 있습니다.</div>
                <button onClick={() => delItem(selItem.id)} style={{ color: '#c33', alignSelf: 'flex-start' }}>삭제</button>
              </div>
            )}
          </div>
        </div>

        {/* 조립 변수 */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
            조립 변수 <span style={{ color: '#888', fontWeight: 400 }}>· 배치 수식에서 #이름 참조 (배치별 내장 #W/#H/#D=파츠 치수, #i=순번)</span>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr><th style={th}>이름</th><th style={th}>수식</th><th style={th}>값</th><th style={th}></th></tr></thead>
            <tbody>
              {asm.vars.map((v, i) => {
                const val = asmScope[v.name.replace(/^#/, '')];
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

        {/* 배치 목록 */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
            배치 목록 <span style={{ color: '#888', fontWeight: 400 }}>· 위치·회전에 숫자 또는 수식 (예: #gap*#i, #W/2)</span>
          </div>
          {asm.items.length === 0 && <div style={{ fontSize: '0.78rem', color: '#999' }}>팔레트에서 파츠를 클릭해 추가하세요.</div>}
          {asm.items.length > 0 && (
            <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead><tr>
                <th style={th}>파츠</th><th style={th}>X</th><th style={th}>Y</th><th style={th}>Z</th>
                <th style={th}>RX</th><th style={th}>RY</th><th style={th}>RZ</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {asm.items.map((pl) => {
                  const p = partMap.get(pl.partId);
                  return (
                    <tr key={pl.id} onClick={() => setSel(pl.id)}
                      style={{ background: sel === pl.id ? 'rgba(255,179,71,0.15)' : undefined, cursor: 'pointer' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{p?.name ?? '(삭제된 파츠)'}</td>
                      {(['px', 'py', 'pz', 'rx', 'ry', 'rz'] as (keyof Placement)[]).map((k) => (
                        <td key={k} style={td}><input value={pl[k] as string} style={{ width: 52 }}
                          onClick={(e) => e.stopPropagation()} onChange={(e) => setField(pl.id, k, e.target.value)} /></td>
                      ))}
                      <td style={td}><button onClick={(e) => { e.stopPropagation(); delItem(pl.id); }} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}