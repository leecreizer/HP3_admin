import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { Object3D } from 'three';
import { loadParts, upsertPart } from '../parts/partStore';
import type { Part } from '../parts/types';
import { loadAssembly, saveAssembly, newPlacement, type Assembly, type Placement } from '../parts/assemblyStore';
import { PartObject } from '../parts/PartObject';
import { evalExpr, buildScope } from '../parts/formula';
import { saveAssemblyModel, type AssemblyModel } from '../parts/assemblyModelStore';
import { loadSwapState, saveSwapState } from '../data/groups';
import { loadProductsSnapshot, categoryFolders, genContentCode, appendProduct } from '../parts/productLink';

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
  const [modelName, setModelName] = useState('');
  const [modelKind, setModelKind] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const swapCats = useMemo(() => loadSwapState().categories, []);
  const prodSnap = useMemo(() => loadProductsSnapshot(), []);
  const catFolders = useMemo(() => (prodSnap ? categoryFolders(prodSnap) : []), [prodSnap]);
  const [saveFolder, setSaveFolder] = useState('');

  useEffect(() => { saveAssembly(asm); }, [asm]);

  // 조립을 "모델"로 저장 → 교체 그룹(SwapGroup)으로 등록해 상품 모델링 슬롯에서 선택되게 함
  const saveAsModel = () => {
    const name = modelName.trim();
    if (!name) { setSaveMsg('모델 이름을 입력하세요'); return; }
    if (!asm.items.length) { setSaveMsg('배치가 비어 있습니다'); return; }
    const kind = modelKind.trim() || '조립';
    const usedParts = [...new Set(asm.items.map((x) => x.partId))]
      .map((id) => partMap.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const swap = loadSwapState();
    const existing = swap.groups.find((g) => g.name === name);
    const id = existing?.id ?? `am-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const model: AssemblyModel = { id, name, kind, items: asm.items, parts: usedParts, createdAt: Date.now(), updatedAt: Date.now() };
    saveAssemblyModel(model);
    const groups = existing
      ? swap.groups.map((g) => (g.id === id ? { ...g, name, kind, type: 'normal' as const } : g))
      : [...swap.groups, { id, name, kind, type: 'normal' as const }];
    const categories = swap.categories.includes(kind) ? swap.categories : [...swap.categories, kind];
    saveSwapState({ ...swap, groups, categories });

    // 기본 상품 정보 등록 (컨텐츠 관리 카테고리에 연결)
    let where = '';
    if (prodSnap && saveFolder) {
      // 조립 전체 크기(mm) 근사 — 회전 무시, 배치 위치+실치수 범위
      let lo = [Infinity, Infinity, Infinity]; let hi = [-Infinity, -Infinity, -Infinity];
      asm.items.forEach((pl, i) => {
        const p = partMap.get(pl.partId); if (!p) return;
        const sc = scopeFor(pl, i); const sf = scaleFor(pl, sc);
        const pos = [num(pl.px, sc), num(pl.py, sc), num(pl.pz, sc)];
        const size = [p.bbox.w * sf[0], p.bbox.h * sf[1], p.bbox.d * sf[2]];
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[a]); hi[a] = Math.max(hi[a], pos[a] + size[a]); }
      });
      const dim = (a: number) => (Number.isFinite(lo[a]) ? Math.max(0, Math.round(hi[a] - lo[a])) : 0);
      const code = genContentCode(prodSnap);
      const today = new Date().toISOString().slice(0, 10);
      const product = {
        contentCode: code, name, brand: '한샘', productGroup: '', quoteGroup: '', productCode: code,
        visible: true, permission: '전체', w: dim(0), d: dim(2), h: dim(1),
        placement: '바닥', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
        productKind: '', modelKind: kind, modelGroupId: id, thumb: '',
        folderId: saveFolder, updatedAt: today, updatedBy: '관리자',
      };
      appendProduct(prodSnap, product);
      where = catFolders.find((f) => f.id === saveFolder)?.path ?? saveFolder;
    }
    const base = existing ? `'${name}' 갱신 · 상품 모델링(${kind})에 반영됨` : `'${name}' 저장 · 상품 모델링(${kind})에 등록됨`;
    setSaveMsg(where ? `${base} · 상품 등록 위치: ${where}` : `${base}${prodSnap ? ' · 저장 위치를 선택하면 상품이 등록됩니다' : ' (상품 미등록: 상품 관리를 먼저 여세요)'}`);
  };

  // 선택된 배치의 3D 오브젝트(기즈모 부착용)
  const objs = useRef<Map<string, Object3D>>(new Map());
  const [selObj, setSelObj] = useState<Object3D | null>(null);
  useEffect(() => { setSelObj(sel ? objs.current.get(sel) ?? null : null); }, [sel, asm.items]);

  // 배치의 로컬 스코프 = 그 배치의 변수 + 원본 파츠 치수(W/H/D) + 순번(i)
  const localScope = (pl: Placement, i: number): Record<string, number> => {
    const p = partMap.get(pl.partId);
    return buildScope(pl.vars, { W: p?.bbox.w ?? 0, H: p?.bbox.h ?? 0, D: p?.bbox.d ?? 0, i });
  };
  // 배치 크기(mm) → 파츠 원본 bbox 대비 스케일. 빈값이면 원본(스케일 1).
  const scaleFor = (pl: Placement, sc: Record<string, number>): [number, number, number] => {
    const p = partMap.get(pl.partId);
    const bw = p?.bbox.w || 1, bh = p?.bbox.h || 1, bd = p?.bbox.d || 1;
    const tw = pl.w.trim() ? num(pl.w, sc) : bw;
    const th = pl.h.trim() ? num(pl.h, sc) : bh;
    const tdp = pl.d.trim() ? num(pl.d, sc) : bd;
    return [tw / bw, th / bh, tdp / bd];
  };
  // 배치 간 참조 스코프: 정의변수(ref)를 가진 배치의 실제 W/H/D를 "ref.W/.H/.D"로 공개.
  // (자기 로컬 스코프로만 해석 → 순환 참조 방지)
  const crossScope: Record<string, number> = {};
  asm.items.forEach((pl, i) => {
    const ref = pl.ref?.trim();
    if (!ref) return;
    const p = partMap.get(pl.partId);
    const sf = scaleFor(pl, localScope(pl, i));
    crossScope[`${ref}.W`] = Math.round((p?.bbox.w ?? 0) * sf[0]);
    crossScope[`${ref}.H`] = Math.round((p?.bbox.h ?? 0) * sf[1]);
    crossScope[`${ref}.D`] = Math.round((p?.bbox.d ?? 0) * sf[2]);
  });
  // 최종 배치 스코프 = 참조 스코프 + 로컬 스코프(로컬이 우선)
  const scopeFor = (pl: Placement, i: number): Record<string, number> => ({ ...crossScope, ...localScope(pl, i) });

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
    <main className="main" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-head"><h1>조립</h1></div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
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
        {/* 모델로 저장 → 상품 모델링(교체 그룹) 등록 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem', borderTop: '1px solid var(--line,#eee)', paddingTop: 8 }}>
          <b>모델로 저장</b>
          <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="모델 이름 (예: 3단 서랍장)" style={{ width: 180 }} />
          <span>구분</span>
          <input value={modelKind} onChange={(e) => setModelKind(e.target.value)} placeholder="조립" list="swap-cats" style={{ width: 90 }} />
          <datalist id="swap-cats">{swapCats.map((c) => <option key={c} value={c} />)}</datalist>
          <span>저장 위치</span>
          {prodSnap ? (
            <select value={saveFolder} onChange={(e) => setSaveFolder(e.target.value)} style={{ minWidth: 180 }}>
              <option value="">— 컨텐츠 카테고리 선택 —</option>
              {catFolders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
            </select>
          ) : <span style={{ color: '#c33', fontSize: '0.78rem' }}>상품 관리를 먼저 열어야 등록 가능</span>}
          <button onClick={saveAsModel}>모델 저장 · 상품 등록</button>
          {saveMsg && <span style={{ color: saveMsg.includes('입력') || saveMsg.includes('비어') ? '#c33' : '#292' }}>{saveMsg}</span>}
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* 3D 실시간 뷰 + 기즈모 */}
          <div style={{ flex: 1, minHeight: 0 }}>
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
          <div style={{ width: 190, borderLeft: '1px solid var(--line,#eee)', paddingLeft: 10, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>배치 목록 ({asm.items.length})</div>
            {asm.items.length === 0 && <div style={{ fontSize: '0.74rem', color: '#999' }}>팔레트/드롭다운에서 파츠를 추가하세요.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {asm.items.map((pl) => {
                const p = partMap.get(pl.partId);
                return (
                  <div key={pl.id} onClick={() => setSel(pl.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '3px 4px', borderRadius: 5, cursor: 'pointer',
                      background: sel === pl.id ? 'rgba(255,179,71,0.18)' : undefined, opacity: pl.hidden ? 0.45 : 1 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.ref?.trim() || p?.name || '(삭제된 파츠)'}</span>
                    <button title="복사" onClick={(e) => { e.stopPropagation(); dupItem(pl.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>⧉</button>
                    <button title={pl.hidden ? '표시' : '숨김'} onClick={(e) => { e.stopPropagation(); toggleHide(pl.id); }} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>{pl.hidden ? '🙈' : '👁'}</button>
                    <button title="삭제" onClick={(e) => { e.stopPropagation(); delItem(pl.id); }} style={{ border: 'none', background: 'none', color: '#c33', cursor: 'pointer', fontSize: '0.9rem', padding: 0 }}>×</button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 선택 정보 패널 */}
          <div style={{ width: 240, borderLeft: '1px solid var(--line,#eee)', paddingLeft: 12, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>선택 정보</div>
            {!selItem && <div style={{ fontSize: '0.78rem', color: '#999' }}>3D에서 파츠를 클릭하거나 아래 배치 목록에서 선택하세요.</div>}
            {selItem && (
              <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div><b>{selPart?.name ?? '(삭제된 파츠)'}</b></div>
                {selPart && <div style={{ color: '#888', fontSize: '0.74rem' }}>크기 {selPart.bbox.w}×{selPart.bbox.h}×{selPart.bbox.d} mm · 평면 {selPart.plane ?? 'XY'}</div>}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={lbl}>이름</span>
                  <input value={selItem.ref ?? ''} placeholder={selPart?.name ?? '예: 몸통'} style={{ width: 120 }}
                    onChange={(e) => setField(selItem.id, 'ref', e.target.value)} />
                  {selItem.ref?.trim() && <span style={{ color: '#888', fontSize: '0.68rem' }}>정의변수: {selItem.ref.trim()}.W / .H / .D 로 참조</span>}
                </div>
                {(() => {
                  const s = scopeFor(selItem, asm.items.indexOf(selItem));
                  const rv = (k: keyof Placement) => { const v = evalExpr(selItem[k] as string, s); return v == null ? '오류' : Math.round(v * 100) / 100; };
                  const preview: React.CSSProperties = { color: '#888', fontSize: '0.7rem', marginTop: 1 };
                  const sf = selPart ? scaleFor(selItem, s) : [1, 1, 1];
                  return (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>위치 (mm) <span style={{ color: '#aaa', fontWeight: 400 }}>수식·조건식 가능</span></div>
                      {axisRow('X Y Z', ['px', 'py', 'pz'])}
                      <div style={preview}>→ ({rv('px')}, {rv('py')}, {rv('pz')})</div>
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>회전 (도)</div>
                      {axisRow('X Y Z', ['rx', 'ry', 'rz'])}
                      <div style={preview}>→ ({rv('rx')}, {rv('ry')}, {rv('rz')})</div>
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>크기 (mm) · 폭·높이·두께</div>
                      {axisRow('W H T', ['w', 'h', 'd'])}
                      {selPart && (
                        <div style={preview}>
                          실제 {Math.round(selPart.bbox.w * sf[0])}×{Math.round(selPart.bbox.h * sf[1])}×{Math.round(selPart.bbox.d * sf[2])} mm (빈칸=원본 {selPart.bbox.w}×{selPart.bbox.h}×{selPart.bbox.d})
                        </div>
                      )}
                    </div>
                  );
                })()}
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