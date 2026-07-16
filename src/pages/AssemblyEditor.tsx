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
    const files = Array.from(e.target.files ?? []); // value 초기화 전에 참조 복사(FileList가 비워지는 것 방지)
    e.target.value = '';
    if (!files.length) return;
    let seq = 0;
    const imported: Part[] = [];
    const read = (f: File) => new Promise<void>((res) => {
      const r = new FileReader();
      r.onload = () => {
        try {
          const p = JSON.parse(String(r.result)) as Part;
          if (p?.profile?.contours?.length && p.extrude) {
            const np: Part = { ...p, id: `imp-${Date.now()}-${seq++}-${Math.floor(Math.random() * 1e6)}` };
            upsertPart(np); // 라이브러리에도 저장(드롭다운에서 재사용)
            imported.push(np);
          }
        } catch { /* skip */ }
        res();
      };
      r.onerror = () => res();
      r.readAsText(f);
    });
    await Promise.all(files.map(read));
    reloadParts();
    // 팔레트 없이 배치 목록에 바로 추가(원본 크기로 채움)
    const pls: Placement[] = imported.map((np) => ({
      ...newPlacement(np.id), w: String(np.bbox.w), h: String(np.bbox.h), d: String(np.bbox.d),
    }));
    if (pls.length) { setAsm((a) => ({ ...a, items: [...a.items, ...pls] })); setSel(pls[pls.length - 1].id); }
    setImpMsg(`${imported.length}개 불러와 배치에 추가`);
  };
  const [asm, setAsm] = useState<Assembly>(loadAssembly);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => { saveAssembly(asm); }, [asm]);

  // 선택된 배치의 3D 오브젝트(기즈모 부착용)
  const objs = useRef<Map<string, Object3D>>(new Map());
  const [selObj, setSelObj] = useState<Object3D | null>(null);
  useEffect(() => { setSelObj(sel ? objs.current.get(sel) ?? null : null); }, [sel, asm.items]);

  // 배치별 스코프 = 그 배치의 변수 + 파츠 치수(W/H/D) + 순번(i)
  const scopeFor = (pl: Placement, i: number): Record<string, number> => {
    const p = partMap.get(pl.partId);
    return buildScope(pl.vars, { W: p?.bbox.w ?? 0, H: p?.bbox.h ?? 0, D: p?.bbox.d ?? 0, i });
  };

  const setItems = (items: Placement[]) => setAsm((a) => ({ ...a, items }));
  const addPart = (partId: string) => {
    const p = partMap.get(partId);
    // 실제 크기(mm)를 파츠 원본 치수로 미리 채워 값이 보이게 한다
    const pl: Placement = { ...newPlacement(partId), w: String(p?.bbox.w ?? ''), h: String(p?.bbox.h ?? ''), d: String(p?.bbox.d ?? '') };
    setAsm((a) => ({ ...a, items: [...a.items, pl] }));
    setSel(pl.id);
  };
  const delItem = (id: string) => { setItems(asm.items.filter((x) => x.id !== id)); if (sel === id) setSel(null); };
  const dupItem = (id: string) => {
    const src = asm.items.find((x) => x.id === id); if (!src) return;
    const copy: Placement = { ...src, ...newPlacement(src.partId), w: src.w, h: src.h, d: src.d, px: src.px, py: src.py, pz: src.pz, rx: src.rx, ry: src.ry, rz: src.rz };
    setAsm((a) => ({ ...a, items: [...a.items, copy] })); setSel(copy.id);
  };
  const toggleHide = (id: string) => setItems(asm.items.map((x) => (x.id === id ? { ...x, hidden: !x.hidden } : x)));
  // 배치 크기(mm) → 파츠 원본 bbox 대비 스케일. 빈값이면 원본(스케일 1).
  const scaleFor = (pl: Placement, sc: Record<string, number>): [number, number, number] => {
    const p = partMap.get(pl.partId);
    const bw = p?.bbox.w || 1, bh = p?.bbox.h || 1, bd = p?.bbox.d || 1;
    const tw = pl.w.trim() ? num(pl.w, sc) : bw;
    const th = pl.h.trim() ? num(pl.h, sc) : bh;
    const tdp = pl.d.trim() ? num(pl.d, sc) : bd;
    return [tw / bw, th / bh, tdp / bd];
  };
  const setField = (id: string, k: keyof Placement, v: string) =>
    setItems(asm.items.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  // 선택 배치 전용 변수 관리
  const setSelVars = (vars: { name: string; expr: string }[]) => { if (sel) setItems(asm.items.map((x) => (x.id === sel ? { ...x, vars } : x))); };
  const addVar = () => { const vs = selItem?.vars ?? []; setSelVars([...vs, { name: `V${vs.length + 1}`, expr: '0' }]); };
  const delVar = (i: number) => setSelVars((selItem?.vars ?? []).filter((_, k) => k !== i));
  const setVar = (i: number, p: Partial<{ name: string; expr: string }>) =>
    setSelVars((selItem?.vars ?? []).map((v, k) => (k === i ? { ...v, ...p } : v)));

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
          <span style={{ color: '#888' }}>드롭다운 선택 또는 파일 불러오기로 배치에 추가됩니다</span>
        </div>
        <div style={{ display: 'flex', gap: 12, minHeight: 560 }}>
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
                if (!part || pl.hidden) return null;
                const sc = scopeFor(pl, i);
                const pos: [number, number, number] = [num(pl.px, sc) * MM, num(pl.py, sc) * MM, num(pl.pz, sc) * MM];
                const rot: [number, number, number] = [num(pl.rx, sc) * Math.PI / 180, num(pl.ry, sc) * Math.PI / 180, num(pl.rz, sc) * Math.PI / 180];
                const scale = scaleFor(pl, sc);
                return (
                  <group key={pl.id} position={pos} rotation={rot}
                    ref={(o) => { if (o) objs.current.set(pl.id, o); else objs.current.delete(pl.id); }}>
                    <group scale={scale}>
                      <PartObject part={part} selected={sel === pl.id} onSelect={() => setSel(pl.id)} />
                    </group>
                  </group>
                );
              })}
              {selObj && (
                <TransformControls object={selObj} mode="translate" translationSnap={SNAP * MM} onObjectChange={onGizmo} />
              )}
            </Canvas>
          </div>

          {/* 배치 목록 (파츠명 + 복사/숨김/삭제) */}
          <div style={{ width: 190, borderLeft: '1px solid var(--line,#eee)', paddingLeft: 10, overflowY: 'auto', maxHeight: 620 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>배치 목록 ({asm.items.length})</div>
            {asm.items.length === 0 && <div style={{ fontSize: '0.74rem', color: '#999' }}>팔레트/드롭다운에서 파츠를 추가하세요.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {asm.items.map((pl) => {
                const p = partMap.get(pl.partId);
                return (
                  <div key={pl.id} onClick={() => setSel(pl.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', borderRadius: 5, cursor: 'pointer',
                      background: sel === pl.id ? 'rgba(255,179,71,0.18)' : undefined, opacity: pl.hidden ? 0.45 : 1 }}>
                    <span style={{ flex: 1, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p?.name ?? '(삭제된 파츠)'}</span>
                    <button title="복사" onClick={(e) => { e.stopPropagation(); dupItem(pl.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>⧉</button>
                    <button title={pl.hidden ? '표시' : '숨김'} onClick={(e) => { e.stopPropagation(); toggleHide(pl.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>{pl.hidden ? '🙈' : '👁'}</button>
                    <button title="삭제" onClick={(e) => { e.stopPropagation(); delItem(pl.id); }} style={{ border: 'none', background: 'none', color: '#c33', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}>×</button>
                  </div>
                );
              })}
            </div>
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
                  <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>크기 (mm) · 폭·높이·두께</div>
                  {axisRow('W H T', ['w', 'h', 'd'])}
                  {selPart && (() => {
                    const s = scopeFor(selItem, asm.items.indexOf(selItem));
                    const sf = scaleFor(selItem, s);
                    return (
                      <div style={{ color: '#888', fontSize: '0.72rem', marginTop: 2 }}>
                        실제 {Math.round(selPart.bbox.w * sf[0])}×{Math.round(selPart.bbox.h * sf[1])}×{Math.round(selPart.bbox.d * sf[2])} mm (빈칸=원본 {selPart.bbox.w}×{selPart.bbox.h}×{selPart.bbox.d})
                      </div>
                    );
                  })()}
                </div>
                {/* 배치 전용 변수 */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '6px 0 3px' }}>변수 <span style={{ color: '#888', fontWeight: 400 }}>· 위/회전/크기 수식에서 #이름 (내장 #W/#H/#D=원본치수, #i=순번)</span></div>
                  {(() => {
                    const sc = scopeFor(selItem, asm.items.indexOf(selItem));
                    return (selItem.vars ?? []).map((v, i) => {
                      const val = sc[v.name.replace(/^#/, '')];
                      return (
                        <div key={i} style={{ display: 'flex', gap: 3, alignItems: 'center', marginBottom: 3 }}>
                          <input value={v.name} placeholder="이름" style={{ width: 56 }} onChange={(e) => setVar(i, { name: e.target.value })} />
                          <input value={v.expr} placeholder="수식" style={{ width: 80 }} onChange={(e) => setVar(i, { expr: e.target.value })} />
                          <span style={{ fontSize: '0.7rem', color: val == null ? '#c33' : '#888', minWidth: 30 }}>{val == null ? '오류' : Math.round(val * 100) / 100}</span>
                          <button onClick={() => delVar(i)} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
                        </div>
                      );
                    });
                  })()}
                  <button onClick={addVar} style={{ fontSize: '0.76rem' }}>+ 변수 추가</button>
                </div>
                <div style={{ color: '#888', fontSize: '0.72rem' }}>3D의 화살표(기즈모)를 끌어 {SNAP}mm 단위로 이동할 수 있습니다.</div>
                <button onClick={() => delItem(selItem.id)} style={{ color: '#c33', alignSelf: 'flex-start' }}>삭제</button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}