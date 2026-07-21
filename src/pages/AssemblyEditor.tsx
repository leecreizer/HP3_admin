import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, TransformControls } from '@react-three/drei';
import type { Object3D } from 'three';
import { loadParts, upsertPart } from '../parts/partStore';
import type { Part } from '../parts/types';
import { loadAssembly, saveAssembly, newPlacement, type Assembly, type Placement } from '../parts/assemblyStore';
import { PartObject } from '../parts/PartObject';
import { evalExpr, buildScope } from '../parts/formula';
import { saveAssemblyModel, loadAssemblyModels, type AssemblyModel } from '../parts/assemblyModelStore';
import { loadSwapState, saveSwapState } from '../data/groups';
import { loadProductsSnapshot, categoryFolders, genContentCode, appendProduct, writeProducts, findProductByGroup, productTaxonomy } from '../parts/productLink';
import { exportAssemblyGlb, type ResolvedItem } from '../parts/assemblyGlb';

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
  const tax = useMemo(() => (prodSnap ? productTaxonomy(prodSnap) : { groups: [], quoteByGroup: {}, kindsByGroup: {} }), [prodSnap]);
  const [saveFolder, setSaveFolder] = useState('');
  const [pGroup, setPGroup] = useState('');       // 상품군
  const [pQuote, setPQuote] = useState('');        // 견적그룹
  const [pKind, setPKind] = useState('');          // 상품구분
  const [savedModels, setSavedModels] = useState(loadAssemblyModels);
  const [editingId, setEditingId] = useState<string | null>(null); // 불러온 조립 모델 id(재저장 시 갱신)

  useEffect(() => { saveAssembly(asm); }, [asm]);

  // 저장된 조립 모델 불러오기 → 편집 상태로 로드(임베드 파츠를 라이브러리에 병합해 해석 가능케)
  const loadModel = (mid: string) => {
    const m = loadAssemblyModels().find((x) => x.id === mid);
    if (!m) return;
    (m.parts ?? []).forEach((p) => { if (!loadParts().some((x) => x.id === p.id)) upsertPart(p); });
    reloadParts();
    setAsm({ vars: [], items: m.items });
    setModelName(m.name); setModelKind(m.kind); setEditingId(m.id);
    setSel(null);
    // 기존 상품이 있으면 분류/위치 프리필(신규 등록칸 채우기용)
    const snap = loadProductsSnapshot();
    const prod = snap ? findProductByGroup(snap, m.id) : null;
    if (prod) { setPGroup(prod.productGroup || ''); setPQuote(prod.quoteGroup || ''); setPKind(prod.productKind || ''); setSaveFolder(prod.folderId || ''); }
    setSaveMsg(`'${m.name}' 불러옴 — 수정 후 저장하면 갱신됩니다`);
  };

  // 조립을 "모델"로 저장 → 교체 그룹(SwapGroup)으로 등록해 상품 모델링 슬롯에서 선택되게 함
  const saveAsModel = async () => {
    const name = modelName.trim();
    if (!name) { setSaveMsg('모델 이름을 입력하세요'); return; }
    if (!asm.items.length) { setSaveMsg('배치가 비어 있습니다'); return; }
    const kind = modelKind.trim() || '조립';
    const usedParts = [...new Set(asm.items.map((x) => x.partId))]
      .map((id) => partMap.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const swap = loadSwapState();
    const byName = swap.groups.find((g) => g.name === name);
    // 불러온 모델(editingId) 우선 → 같은 이름 그룹 → 신규
    const id = editingId ?? byName?.id ?? `am-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const isUpdate = !!(editingId || byName);
    const model: AssemblyModel = { id, name, kind, items: asm.items, parts: usedParts, createdAt: Date.now(), updatedAt: Date.now() };
    saveAssemblyModel(model);
    const groups = swap.groups.some((g) => g.id === id)
      ? swap.groups.map((g) => (g.id === id ? { ...g, name, kind, type: 'normal' as const } : g))
      : [...swap.groups, { id, name, kind, type: 'normal' as const }];
    const categories = swap.categories.includes(kind) ? swap.categories : [...swap.categories, kind];
    saveSwapState({ ...swap, groups, categories });
    setSavedModels(loadAssemblyModels());
    setEditingId(id);

    // 상품 반영 — 기존 상품(modelGroupId 일치)이면 갱신, 없으면 신규 등록(분류·위치 필요)
    const snap = loadProductsSnapshot();
    let where = '';
    if (snap) {
      const existingProduct = findProductByGroup(snap, id);
      if (!existingProduct && (!saveFolder || !(pGroup && pQuote && pKind))) {
        setSaveMsg(`'${name}' 모델 저장됨 · 신규 상품 등록하려면 저장위치·상품군·견적그룹·상품구분을 선택하세요`);
        return;
      }
      // GLB용 해석 배치
      const resolved: ResolvedItem[] = [];
      asm.items.forEach((pl, i) => {
        const p = partMap.get(pl.partId); if (!p) return;
        const sc = scopeFor(pl, i); const sf = scaleFor(pl, sc);
        resolved.push({
          part: p,
          pos: [num(pl.px, sc), num(pl.py, sc), num(pl.pz, sc)],
          rotDeg: [num(pl.rx, sc), num(pl.ry, sc), num(pl.rz, sc)],
          scale: sf, hidden: pl.hidden, ref: pl.ref,
        });
      });
      setSaveMsg('GLB 모델 생성 중…');
      let glb = ''; let thumb = '';
      try { const out = await exportAssemblyGlb(resolved); glb = out.glb; thumb = out.thumb; } catch { /* GLB 실패해도 진행 */ }
      const today = new Date().toISOString().slice(0, 10);
      // 상품 크기 = 전체 기준 치수(#W/#D/#H)
      const W = baseW, D = baseD, H = baseH;
      const opSize = { minW: W, maxW: W, gapW: 0, minD: D, maxD: D, gapD: 0, minH: H, maxH: H, gapH: 0 };
      const vars = [
        { name: 'W', value: String(W), type: '고정값' as const },
        { name: 'D', value: String(D), type: '고정값' as const },
        { name: 'H', value: String(H), type: '고정값' as const },
      ];
      if (existingProduct) {
        // 기존 상품 갱신 (분류·위치·코드 유지)
        const code = existingProduct.contentCode;
        const updated = {
          ...existingProduct, name, modelKind: kind, w: W, d: D, h: H, opSize, vars,
          thumbUrl: thumb || existingProduct.thumbUrl,
          assets: glb ? [{ id: `as-${code}`, name: `${name}.glb`, type: '모델링', url: glb }] : existingProduct.assets,
          modelUrl: glb || existingProduct.modelUrl, updatedAt: today, updatedBy: '관리자',
        };
        writeProducts(snap, snap.products.map((p: typeof existingProduct) => (p === existingProduct ? updated : p)));
        where = `기존 상품 갱신 (${existingProduct.name})`;
      } else {
        const code = genContentCode(snap);
        const product = {
          contentCode: code, name, brand: '한샘',
          productGroup: pGroup, quoteGroup: pQuote, productKind: pKind, productCode: code,
          modelKind: kind, visible: true, permission: '전체',
          w: W, d: D, h: H, placement: '바닥', placeHeight: 0, nonStandard: false,
          attrType: '모델링', modelingType: '설계형',
          opSize, vars, modelingSlots: [], styleIds: [], filterValues: [],
          modelGroupId: id, thumb: '', thumbUrl: thumb || undefined,
          assets: glb ? [{ id: `as-${code}`, name: `${name}.glb`, type: '모델링', url: glb }] : undefined,
          modelUrl: glb || undefined,
          folderId: saveFolder, updatedAt: today, updatedBy: '관리자',
        };
        appendProduct(snap, product);
        where = (catFolders.find((f) => f.id === saveFolder)?.path ?? saveFolder) + (glb ? ' · GLB 포함' : ' · (GLB 실패)');
      }
    }
    const base = isUpdate ? `'${name}' 갱신` : `'${name}' 저장`;
    setSaveMsg(where ? `${base} · 상품: ${where}` : `${base}${snap ? ' · 저장 위치 선택 시 상품 등록' : ' (상품 관리를 먼저 여세요)'}`);
  };

  // 선택된 배치의 3D 오브젝트(기즈모 부착용)
  const objs = useRef<Map<string, Object3D>>(new Map());
  const [selObj, setSelObj] = useState<Object3D | null>(null);
  useEffect(() => { setSelObj(sel ? objs.current.get(sel) ?? null : null); }, [sel, asm.items]);

  // 배치 로컬 스코프 = 배치 변수 + 파츠 원본 치수(#pW/#pH/#pD) + 순번(#i)
  const localScope = (pl: Placement, i: number): Record<string, number> => {
    const p = partMap.get(pl.partId);
    return buildScope(pl.vars, { pW: p?.bbox.w ?? 0, pH: p?.bbox.h ?? 0, pD: p?.bbox.d ?? 0, i });
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
  // 배치 간 참조 스코프: 정의변수(ref) 배치의 실제 W/H/D를 "ref.W/.H/.D"로 공개.
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
  // 배치 bbox(기준치수 미적용) — 기준 치수 자동값·순환 방지용
  const bboxNoBase = (() => {
    const lo = [Infinity, Infinity, Infinity]; const hi = [-Infinity, -Infinity, -Infinity];
    asm.items.forEach((pl, i) => {
      const p = partMap.get(pl.partId); if (!p) return;
      const sc = { ...crossScope, ...localScope(pl, i) };
      const sf = scaleFor(pl, sc);
      const pos = [num(pl.px, sc), num(pl.py, sc), num(pl.pz, sc)];
      const size = [p.bbox.w * sf[0], p.bbox.h * sf[1], p.bbox.d * sf[2]];
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], pos[a]); hi[a] = Math.max(hi[a], pos[a] + size[a]); }
    });
    const dm = (a: number) => (Number.isFinite(lo[a]) ? Math.max(0, Math.round(hi[a] - lo[a])) : 0);
    return { w: dm(0), h: dm(1), d: dm(2) };
  })();
  // 전체 기준 치수(#W/#D/#H) — 명시값 우선, 없으면 배치 bbox 자동
  const dimVal = (expr: string | undefined, fallback: number) => (expr?.trim() ? (evalExpr(expr, {}) ?? fallback) : fallback);
  const baseW = dimVal(asm.dims?.w, bboxNoBase.w);
  const baseD = dimVal(asm.dims?.d, bboxNoBase.d);
  const baseH = dimVal(asm.dims?.h, bboxNoBase.h);
  const baseScope = { W: baseW, D: baseD, H: baseH };
  // 최종 배치 스코프 = 참조 + 기준치수 + 로컬(로컬 우선)
  const scopeFor = (pl: Placement, i: number): Record<string, number> => ({ ...crossScope, ...baseScope, ...localScope(pl, i) });
  const setDims = (k: 'w' | 'd' | 'h', v: string) => setAsm((a) => ({ ...a, dims: { w: a.dims?.w ?? '', d: a.dims?.d ?? '', h: a.dims?.h ?? '', [k]: v } }));

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
          <b>모델</b>
          <select value={editingId ?? ''} onChange={(e) => { if (e.target.value) loadModel(e.target.value); }} style={{ minWidth: 150 }} title="저장된 조립 모델 불러와 수정">
            <option value="">— 저장된 조립 불러오기 —</option>
            {savedModels.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind})</option>)}
          </select>
          {editingId && <button onClick={() => { setEditingId(null); setSaveMsg('신규 모드'); }} title="새 조립으로 전환(불러오기 해제)">새로</button>}
          <span>이름</span>
          <input value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="모델 이름 (예: 3단 서랍장)" style={{ width: 160 }} />
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
          {prodSnap && (
            <>
              <span>상품군</span>
              <select value={pGroup} onChange={(e) => { setPGroup(e.target.value); setPQuote(''); setPKind(''); }} style={{ width: 100 }}>
                <option value="">—</option>
                {tax.groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <span>견적그룹</span>
              <select value={pQuote} onChange={(e) => setPQuote(e.target.value)} disabled={!pGroup} style={{ width: 110 }}>
                <option value="">—</option>
                {(tax.quoteByGroup[pGroup] ?? []).map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
              <span>상품구분</span>
              <select value={pKind} onChange={(e) => setPKind(e.target.value)} disabled={!pGroup} style={{ width: 100 }}>
                <option value="">—</option>
                {(tax.kindsByGroup[pGroup] ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </>
          )}
          <button onClick={saveAsModel}>모델 저장 · 상품 등록</button>
          {saveMsg && <span style={{ color: saveMsg.includes('입력') || saveMsg.includes('비어') ? '#c33' : '#292' }}>{saveMsg}</span>}
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* 전체 기준 치수 (배치 수식에서 #W/#D/#H) */}
          <div style={{ width: 150, borderRight: '1px solid var(--line,#eee)', paddingRight: 10 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>기준 치수 (mm)</div>
            <div style={{ fontSize: '0.7rem', color: '#888', marginBottom: 8 }}>전체 모델 기준 · 배치 수식에서 #W/#D/#H 로 참조</div>
            {([['w', 'W(폭)'], ['d', 'D(깊이)'], ['h', 'H(높이)']] as const).map(([k, lb]) => {
              const auto = k === 'w' ? bboxNoBase.w : k === 'd' ? bboxNoBase.d : bboxNoBase.h;
              const resolved = k === 'w' ? baseW : k === 'd' ? baseD : baseH;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                  <span style={{ width: 44, fontSize: '0.76rem', color: 'var(--text-2)' }}>{lb}</span>
                  <input value={asm.dims?.[k] ?? ''} placeholder={String(auto)} style={{ width: 70 }}
                    onChange={(e) => setDims(k, e.target.value)} />
                  <span style={{ fontSize: '0.68rem', color: '#888' }}>={Math.round(resolved)}</span>
                </div>
              );
            })}
            <button style={{ fontSize: '0.74rem', marginTop: 2 }}
              onClick={() => setAsm((a) => ({ ...a, dims: { w: String(bboxNoBase.w), d: String(bboxNoBase.d), h: String(bboxNoBase.h) } }))}
              title="현재 배치 크기(bbox)로 기준 치수 채우기">배치기준 자동</button>
            <div style={{ fontSize: '0.66rem', color: '#aaa', marginTop: 6 }}>빈칸=배치 bbox 자동 · 파츠 원본치수는 #pW/#pD/#pH</div>
          </div>
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
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>크기 (mm) · 폭·높이·두께 <span style={{ color: '#aaa', fontWeight: 400 }}>수식·조건식 가능</span></div>
                      {axisRow('W H T', ['w', 'h', 'd'])}
                      {selPart && (
                        <div style={preview}>
                          실제 {Math.round(selPart.bbox.w * sf[0])}×{Math.round(selPart.bbox.h * sf[1])}×{Math.round(selPart.bbox.d * sf[2])} mm (빈칸=원본 {selPart.bbox.w}×{selPart.bbox.h}×{selPart.bbox.d})
                        </div>
                      )}
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>위치 (mm)</div>
                      {axisRow('X Y Z', ['px', 'py', 'pz'])}
                      <div style={preview}>→ ({rv('px')}, {rv('py')}, {rv('pz')})</div>
                      <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '4px 0 3px' }}>회전 (도)</div>
                      {axisRow('X Y Z', ['rx', 'ry', 'rz'])}
                      <div style={preview}>→ ({rv('rx')}, {rv('ry')}, {rv('rz')})</div>
                    </div>
                  );
                })()}
                {/* 배치 전용 변수 */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.74rem', margin: '6px 0 3px' }}>변수 <span style={{ color: '#888', fontWeight: 400 }}>· 수식에서 #이름 (내장 #W/#D/#H=전체기준, #pW/#pD/#pH=파츠원본, #i=순번, 다른배치 이름.W)</span></div>
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