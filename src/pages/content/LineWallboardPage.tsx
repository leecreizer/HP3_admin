import { useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { itemsOf, type Folder, type Item } from '../../data/contentLibrary';
import { profileThumb } from '../../data/dxf';
import { useConfirm } from '../../components/confirm';
import { sectionArcs, sectionContext, sectionPathFromArcs, sectionStartPath } from '../../pm/sections';
import { ProfileEditor } from '../pm/ProfileEditor';
import type { PageProps } from './createTypes';
import { itemLW, nameMsg, subtreeIds } from './decoUtil';
import { DecoShell, FolderCascader, KSelect, MaterialPick, Pager, Tip, UpAlert, UpRow, type MatPick } from './decoWidgets';
import {
  arcInfo, flatten, isWallboard, LW_EXPOSED, LW_FILE_RULES, LW_TYPES, LW_UPLOAD_TIPS, mergeAttach, parseLineWallDxf, shapeFromPolygon, sizeError,
  type LwMode, type LwShape, type MoldingSize, type WallSize,
} from './lineWall';
import { LineWallPreview, type LwMat } from './LineWallPreview';

/**
 * 몰딩/벽판 업로드 (쿠지알러 线条/墙板 · /vc/commodity/upload/fdprofile) — 2026-10-07 쿠지알러 화면·번들로 확인(확인 업로드는 누르지 않음).
 * 왼쪽: CAD 단면 파일(DXF — 쿠지알러는 dwg 도 서버에서 해석, HP3 는 DXF 만) · 오른쪽: 이름·제품 유형·크기·바탕 재질·소속 분류·덧붙임 재질.
 * 쿠지알러는 해석·미리보기를 서버에서 하지만 HP3 는 화면에서 한다. 단면 직접 그리기는 HP3 기능(CAD 없이).
 */

const LIB = 7;
const MAT_LIB = 39;
const MB = 1024 * 1024;
type Per = Map<number, { mat: MatPick; mode: LwMode }>;
const sizeOf = (i: Item | undefined): [number, number] => { const lw = i ? itemLW(i) : null; return lw && lw[0] > 0 && lw[1] > 0 ? lw : [600, 600]; };
/** 재질 → 3D 미리보기 재질 (이미지·실제 크기 mm) */
const toLw = (m: MatPick, mats: Item[]): LwMat => ({ key: m.id, img: m.img, size: sizeOf(mats.find((i) => i.id === m.id)) });

/* ───────────────────────── 단면 그림 (SVG) ───────────────────────── */

function segPath(shape: LwShape, i: number, X: (x: number) => number, Y: (y: number) => number, k: number): string {
  const g = shape.segs[i], p0 = shape.points[g.a], p1 = shape.points[g.b];
  if (!g.bulge) return `M ${X(p0[0])} ${Y(p0[1])} L ${X(p1[0])} ${Y(p1[1])}`;
  const { r, theta } = arcInfo(p0, p1, g.bulge);
  // 화면은 y 아래 — 반시계(bulge 양수)는 화면에서 시계 방향(sweep 0)
  return `M ${X(p0[0])} ${Y(p0[1])} A ${r * k} ${r * k} 0 ${Math.abs(theta) > Math.PI ? 1 : 0} ${g.bulge > 0 ? 0 : 1} ${X(p1[0])} ${Y(p1[1])}`;
}

/** 올린 단면 윤곽 — 업로드 상자 */
function ShapeOutline({ shape, size = 260 }: { shape: LwShape; size?: number }) {
  const pad = 16, k = (size - pad * 2) / Math.max(shape.w, shape.h, 1);
  const X = (x: number) => pad + x * k + ((size - pad * 2) - shape.w * k) / 2, Y = (y: number) => size - pad - y * k - ((size - pad * 2) - shape.h * k) / 2;
  return (
    <svg className="cl-lw-outline" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`단면 ${shape.w} × ${shape.h} mm, 구간 ${shape.segs.length}개`}>
      <polygon points={flatten(shape).map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="#e7ebf2" />
      {shape.segs.map((_, i) => <path key={i} d={segPath(shape, i, X, Y, k)} fill="none" stroke="#2f5aa8" strokeWidth={1.6} />)}
    </svg>
  );
}

/* ───────────────────────── 덧붙임 재질 창 ───────────────────────── */

const VIEW = 410;
const PER_PAGE = 20;
const BASE_COLOR = '#ffffff', ATT_COLOR = '#1bbc9b', SEL_COLOR = '#3e82f7';

/**
 * 덧붙임 재질 (쿠지알러 附贴材质) — 왼쪽 단면에서 구간을 고르고(클릭·Shift 다중·Shift 끌기 범위) 오른쪽에서 재질·붙임 방식.
 * 흰색 = 바탕 재질, 초록 = 덧붙임, 파랑 = 고름. 휠 확대·축소(±10px, 1/3~3배), 끌어 이동.
 */
function AttachDialog({ shape, base, value, items, tree, onCancel, onOk }: {
  shape: LwShape; base: MatPick; value: Per; items: Item[]; tree: Folder[]; onCancel: () => void; onOk: (v: Per) => void;
}) {
  const [per, setPer] = useState<Per>(() => new Map(value));
  const [sel, setSel] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(VIEW);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const down = useRef<{ x: number; y: number; pan: [number, number]; shift: boolean; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const k = (width - 40) / Math.max(shape.w, shape.h, 1);
  const X = (x: number) => VIEW / 2 + (x - shape.w / 2) * k - pan[0], Y = (y: number) => VIEW / 2 - (y - shape.h / 2) * k - pan[1];
  // 구간 화면 둘레 (범위 선택)
  const segBox = (i: number) => {
    const g = shape.segs[i], p0 = shape.points[g.a], p1 = shape.points[g.b];
    const pts = [p0, ...(g.bulge ? flatten({ points: [p0, p1], segs: [{ a: 0, b: 1, bulge: g.bulge }, { a: 1, b: 0 }] }) : [p1])];
    const xs = pts.map((p) => X(p[0])), ys = pts.map((p) => Y(p[1]));
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const local = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(); return [(e.clientX - r.left) * (VIEW / r.width), (e.clientY - r.top) * (VIEW / r.height)] as [number, number]; };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    down.current = { x, y, pan, shift: e.shiftKey, moved: false };
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = down.current;
    if (!d) return;
    const [x, y] = local(e);
    if (!d.moved && Math.hypot(x - d.x, y - d.y) <= 3) return;
    d.moved = true;
    if (d.shift) {
      const b = { x0: Math.min(d.x, x), y0: Math.min(d.y, y), x1: Math.max(d.x, x), y1: Math.max(d.y, y) };
      setBox(b);
      setSel(shape.segs.map((_, i) => i).filter((i) => { const s = segBox(i); return s.x0 >= b.x0 && s.x1 <= b.x1 && s.y0 >= b.y0 && s.y1 <= b.y1; }));
    } else setPan([d.pan[0] - (x - d.x), d.pan[1] - (y - d.y)]);
  };
  const onUp = () => {
    const d = down.current;
    down.current = null;
    setBox(null);
    if (d && !d.moved && !d.shift) setSel([]); // 빈 곳 클릭 = 선택 풀기
  };
  const clickSeg = (i: number, shift: boolean) => setSel((s) => (shift ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : s.length === 1 && s[0] === i ? [] : [i]));
  const onWheel = (e: RWheelEvent<SVGSVGElement>) => setWidth((w) => Math.min(VIEW * 3, Math.max(VIEW / 3, w + (e.deltaY < 0 ? 10 : -10))));
  // 고른 구간의 현재 재질·방식
  const chosen = sel.map((i) => per.get(i));
  const same = chosen.length > 0 && chosen.every((c) => (c?.mat.id ?? base.id) === (chosen[0]?.mat.id ?? base.id));
  const shownMat = same ? chosen[0]?.mat ?? base : null;
  const modes = [...new Set(chosen.map((c) => c?.mode ?? 'fit'))];
  const assign = (mat: MatPick) => setPer((m) => { const n = new Map(m); for (const i of sel) n.set(i, { mat, mode: 'fit' }); return n; });
  const setMode = (mode: LwMode) => setPer((m) => { const n = new Map(m); for (const i of sel) n.set(i, { mat: m.get(i)?.mat ?? base, mode }); return n; });
  const reset = () => setPer((m) => { const n = new Map(m); for (const i of sel) n.delete(i); return n; });
  // 재질 목록
  const scope = cat.length ? subtreeIds(tree, cat[cat.length - 1]) : null;
  const ql = q.trim().toLowerCase();
  const list = items.filter((i) => (!scope || scope.has(i.folder) || (i.extraFolders ?? []).some((f) => scope.has(f))) && (!ql || i.name.toLowerCase().includes(ql) || i.code.toLowerCase().includes(ql)));
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const cur = Math.min(page, pages);
  const colorOf = (i: number) => (sel.includes(i) || hover === i ? SEL_COLOR : per.get(i) && per.get(i)!.mat.id !== base.id ? ATT_COLOR : BASE_COLOR);
  return (
    <div className="modal-backdrop cl-lw-att-bg">
      <div className="modal cl-lw-att" role="dialog" aria-modal="true" aria-label="덧붙임 재질">
        <header className="modal-head"><h3>덧붙임 재질</h3><button className="cl-x" aria-label="닫기" onClick={onCancel}>×</button></header>
        <div className="cl-lw-att-body">
          <div className="cl-lw-att-left">
            <svg ref={svgRef} className="cl-lw-att-svg" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="단면 구간"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel}>
              <polygon points={flatten(shape).map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} fill="rgba(255,255,255,0.06)" />
              {shape.segs.map((g, i) => <path key={i} d={segPath(shape, i, X, Y, k)} fill="none" stroke={colorOf(i)} strokeWidth={g.bulge ? 2 : 3} pointerEvents="none" />)}
              {/* 누르기 쉽게 — 구간마다 투명한 12px 클릭 영역 */}
              {shape.segs.map((_, i) => (
                <path key={`hit${i}`} d={segPath(shape, i, X, Y, k)} fill="none" stroke="transparent" strokeWidth={12} pointerEvents="stroke" className="cl-lw-seg" data-index={i}
                  role="button" aria-label={`구간 ${i + 1}${per.get(i) ? ` · ${per.get(i)!.mat.name}` : ''}`} aria-pressed={sel.includes(i)}
                  onPointerDown={(e) => e.stopPropagation()} onClick={(e) => clickSeg(i, e.shiftKey)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} />
              ))}
              {box && <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill="rgba(62,130,247,0.12)" stroke={SEL_COLOR} strokeDasharray="4 3" />}
            </svg>
            <div className="cl-lw-att-zoom">
              <button type="button" onClick={() => { setWidth(VIEW); setPan([0, 0]); }} aria-label="맞춤">⛶</button>
              <input type="range" min={Math.round(VIEW / 3)} max={VIEW * 3} step={10} value={width} aria-label="확대 비율" onChange={(e) => setWidth(Number(e.target.value))} />
            </div>
            <div className="cl-lw-att-tips"><p>도움말:</p><p>1. Shift 를 누른 채 선을 눌러 여러 개를 고르거나, 끌어서 범위로 고릅니다</p><p>2. 초록은 재질을 덧붙인 부분, 흰색은 기본(바탕) 재질 부분입니다</p></div>
          </div>
          <div className="cl-lw-att-right">
            <p className="cl-lw-att-head">면 설정 (왼쪽 그림에서 설정할 면을 고르세요)</p>
            {sel.length ? <>
              <div className="cl-lw-att-cur">
                {shownMat?.img ? <img src={shownMat.img} alt="" /> : <span className="cl-mp-noimg" />}
                <div><b>{shownMat ? shownMat.name : '여러 재질'}</b><small>고른 면 {sel.length}개{shownMat?.id === base.id ? ' · 바탕 재질' : ''}</small></div>
              </div>
              <div className="cl-lw-att-mode" role="radiogroup" aria-label="붙임 방식">
                <span>붙임 방식</span>
                <label><input type="radio" name="lw-mode" checked={modes.length === 1 && modes[0] === 'fit'} onChange={() => setMode('fit')} />맞춤</label>
                <label><input type="radio" name="lw-mode" checked={modes.length === 1 && modes[0] === 'tile'} onChange={() => setMode('tile')} />평붙임</label>
                <button type="button" className="link-mini" onClick={reset}>기본값으로</button>
              </div>
              <label className="search inset cl-mp-q"><input type="search" placeholder="재질 이름 또는 코드 검색" aria-label="덧붙임 재질 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
              <FolderCascader tree={tree} path={cat} onChange={(p) => { setCat(p); setPage(1); }} />
              {list.length ? (
                <ul className="cl-mp-grid cl-lw-att-grid" role="listbox" aria-label="덧붙임 재질">
                  {list.slice((cur - 1) * PER_PAGE, cur * PER_PAGE).map((i) => {
                    const on = same && shownMat?.id === i.id;
                    const lw = itemLW(i);
                    return (
                      <li key={i.id}><button type="button" role="option" aria-selected={on} className={on ? 'on' : ''} data-tip={`${i.name}${lw ? `  크기: ${lw[0]} x ${lw[1]}` : ''}`} aria-label={i.name}
                        onClick={() => assign({ id: i.id, name: i.name, img: i.img })}>
                        {i.img ? <img src={i.img} alt="" loading="lazy" /> : <span className="cl-mp-noimg" />}{on && <i className="cl-mp-check" aria-hidden="true">✓</i>}
                      </button></li>
                    );
                  })}
                </ul>
              ) : <p className="cl-muted cl-mp-empty">검색 결과가 없습니다</p>}
              {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
            </> : <p className="cl-muted cl-lw-att-none">왼쪽 단면에서 재질을 덧붙일 면(구간)을 고르세요.</p>}
          </div>
        </div>
        <footer className="modal-foot"><button className="btn-ghost" onClick={onCancel}>취소</button><button className="btn-primary" onClick={() => onOk(per)}>확인</button></footer>
      </div>
    </div>
  );
}

/* ───────────────────────── 크기 ───────────────────────── */

function MoldingSizeInput({ v, onChange }: { v: MoldingSize; onChange: (v: MoldingSize) => void }) {
  return (
    <div className="cl-lw-size">
      <label className="cl-lw-chk"><input type="checkbox" checked={!v.customized} onChange={() => onChange({ ...v, customized: !v.customized })} />고정 규격</label>
      <span className="cl-lw-len">길이 <input className="inline-input" inputMode="numeric" title="10-8000" aria-label="고정 규격 길이" disabled={v.customized} value={v.length} onChange={(e) => onChange({ ...v, length: e.target.value.replace(/[^\d]/g, '') })} /> mm</span>
      <label className="cl-lw-chk"><input type="checkbox" checked={v.customized} onChange={() => onChange({ ...v, customized: !v.customized })} />맞춤 규격<Tip lines={['조형 변 길이대로 길이를 맞춥니다']} /></label>
    </div>
  );
}

function WallSizeInput({ v, onChange }: { v: WallSize; onChange: (v: WallSize) => void }) {
  const max = v.specific ? Math.max(10, ...v.specs.map((s) => Number(s) || 0)) : 10;
  const setSpec = (i: number, s: string) => {
    const specs = v.specs.map((x, j) => (j === i ? s : x));
    // 규격이 맞춤 최대 길이보다 커지면 같이 올린다 (쿠지알러)
    const n = Number(s) || 0;
    onChange({ ...v, specs, customizedSize: v.customizedSize && n > Number(v.customizedSize) ? String(n) : v.customizedSize });
  };
  return (
    <div className="cl-lw-size">
      <label className="cl-lw-chk"><input type="checkbox" checked={v.specific} onChange={() => onChange({ ...v, specific: !v.specific })} />고정 규격</label>
      <ul className="cl-lw-specs">
        {v.specs.map((s, i) => (
          <li key={i}>
            <input className="inline-input" inputMode="numeric" title="10-6000" aria-label={`규격 길이 ${i + 1}`} disabled={!v.specific} value={s} onChange={(e) => setSpec(i, e.target.value.replace(/[^\d]/g, ''))} /> mm
            {i === 0 ? (v.specs.length >= 10
              ? <button type="button" className="cl-lw-round" disabled title="규격 개수가 상한에 이르렀습니다" aria-label="규격 추가 (상한)">＋</button>
              : <button type="button" className="cl-lw-round" disabled={!v.specific} aria-label="규격 추가" onClick={() => onChange({ ...v, specs: [...v.specs, ''] })}>＋</button>)
              : <button type="button" className="cl-lw-round del" disabled={!v.specific} aria-label={`규격 ${i + 1} 삭제`} onClick={() => onChange({ ...v, specs: v.specs.filter((_, j) => j !== i) })}>−</button>}
          </li>
        ))}
      </ul>
      <label className="cl-lw-chk"><input type="checkbox" checked={v.customized} onChange={() => onChange({ ...v, customized: !v.customized })} />맞춤 최대 길이</label>
      <span className="cl-lw-len"><input className="inline-input" inputMode="numeric" title={`10-20000, 최대 규격 길이(${max}) 이상`} aria-label="맞춤 최대 길이" disabled={!v.customized} value={v.customizedSize} onChange={(e) => onChange({ ...v, customizedSize: e.target.value.replace(/[^\d]/g, '') })} /> mm</span>
    </div>
  );
}

/* ───────────────────────── 페이지 ───────────────────────── */

export function LineWallboardPage({ tab, st, onClose, onCreate }: PageProps) {
  const tree = st.trees[st.activeLibrary]?.[LIB] ?? [];
  const matTree = st.trees[st.activeLibrary]?.[MAT_LIB] ?? [];
  const mats = useMemo(() => itemsOf(st).filter((i) => !i.deletedAt && i.lib === MAT_LIB), [st]);
  const [type, setType] = useState<number | null>(null);
  const [shape, setShape] = useState<LwShape | null>(null);
  const [file, setFile] = useState('');
  /** 직접 그린 단면의 경로 — 다시 그리기 때 그대로 연다 */
  const [drawnPath, setDrawnPath] = useState('');
  const [name, setName] = useState('');
  const [mold, setMold] = useState<MoldingSize>({ customized: false, length: '' });
  const [wall, setWall] = useState<WallSize>({ specific: false, specs: [''], customized: false, customizedSize: '' });
  const [base, setBase] = useState<MatPick | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const [folder, setFolder] = useState<string[]>([]);
  const [per, setPer] = useState<Per>(new Map());
  const [attachOpen, setAttachOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [ask, setAsk] = useState<null | { k: 'type'; pick: number | null } | { k: 'exposed'; prev: number | null }>(null);
  const [parseErr, setParseErr] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const typeName = LW_TYPES.find((t) => t.code === type)?.name ?? '';

  const setShapeFrom = (s: LwShape, fname: string, path = '') => {
    setShape(s); setFile(fname); setDrawnPath(path); setPer(new Map()); setPreview(false);
    setName((n) => n || fname.replace(/\.[^.]+$/, '').slice(0, 50));
  };
  const onFile = async (f: File) => {
    if (f.size > 5 * MB) { setAlert('올리지 못했습니다 — 파일 크기가 5MB 를 넘습니다'); return; }
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext === 'dwg') { setAlert('DWG 는 HP3 에서 읽을 수 없습니다 — CAD 에서 DXF 로 저장해 올리세요 (쿠지알러는 서버에서 DWG 를 해석)'); return; }
    if (ext !== 'dxf') { setAlert('cad 파일(dxf) 만 올릴 수 있습니다'); return; }
    try { setShapeFrom(parseLineWallDxf(await f.text()), f.name); }
    catch (e) { setParseErr((e as Error).message); }
  };
  const pickFile = () => { if (!type) { setAsk({ k: 'type', pick: null }); return; } fileRef.current?.click(); };
  const changeType = (v: string) => {
    const code = Number(v);
    // 외부 모서리 몰딩으로 바꾸면 쿠지알러는 다시 올리게 한다 (서버 해석이 유형마다 다름)
    if (code === LW_EXPOSED && type !== LW_EXPOSED) setAsk({ k: 'exposed', prev: type });
    setType(code);
  };
  const doPreview = () => {
    if (!shape || !type || !base) { setAlert('오른쪽 내용을 채운 뒤 미리보기 하세요'); return; }
    setPreview(true);
  };
  const len = isWallboard(type) ? Number(wall.specs.find((s) => Number(s) > 0) ?? 0) || Number(wall.customizedSize) || 1000 : Number(mold.length) || 1000;
  const previewLen = shape ? Math.min(len, Math.max(300, Math.max(shape.w, shape.h) * 8)) : 600;
  // 3D 미리보기 재질 — 바뀔 때만 새로 (입력할 때마다 형상·텍스처를 다시 만들지 않게)
  const base3d = useMemo(() => (base ? toLw(base, mats) : null), [base, mats]);
  const per3d = useMemo(() => new Map([...per].map(([k, v]) => [k, { mat: toLw(v.mat, mats), mode: v.mode }])), [per, mats]);
  const attachedMats = [...new Map([...per.values()].filter((v) => !base || v.mat.id !== base.id).map((v) => [v.mat.id, v.mat])).values()];

  const submit = () => {
    const sErr = type ? sizeError(type, mold, wall) : '';
    const msg = !shape ? '파일을 올리세요' : nameMsg(name) ? '1~128자 소재 이름을 입력하세요' : !type ? '제품 유형을 고르세요' : sErr ? sErr : !base ? '바탕 재질을 고르세요' : '';
    if (msg || !shape || !type || !base) { setAlert(msg); return; }
    setBusy(true);
    try {
      let img = '';
      if (preview && canvasRef.current) { try { img = canvasRef.current.toDataURL('image/jpeg', 0.86); } catch { img = ''; } }
      const pts = flatten(shape);
      if (!img) img = profileThumb({ w: shape.w, h: shape.h, points: pts });
      const wb = isWallboard(type);
      const specs = wall.specific ? wall.specs.map(Number).filter((n) => n > 0) : [];
      const length = wb ? specs[0] ?? (wall.customized ? Number(wall.customizedSize) : 0) : mold.customized ? 0 : Number(mold.length);
      onCreate([{
        name: name.trim(), lib: LIB, folder: folder.length ? folder[folder.length - 1] : undefined, img,
        renderCat: typeName, size: `${shape.w} X ${shape.h} mm`, modelSize: length ? `${length}x${shape.w}x${shape.h}(mm)` : `${shape.w}x${shape.h}(mm)`,
        profile: { w: shape.w, h: shape.h, points: pts },
        lineWall: {
          type, shape: { points: shape.points, segs: shape.segs, w: shape.w, h: shape.h }, file: file || undefined,
          ...(wb ? { wallboard: { specifications: specs, customized: wall.customized, customizedSize: wall.customized ? Number(wall.customizedSize) : undefined } }
            : { molding: { customized: mold.customized, length: mold.customized ? undefined : Number(mold.length) } }),
          // 쿠지알러 curvesWithTexture 처럼 바탕 재질에 붙임 방식만 바꾼 구간도 남긴다
          base, attach: mergeAttach(per),
        },
      }], `‘${name.trim()}’ ${typeName}을(를) 올렸습니다`, { detail: true });
    } catch (e) { setAlert(`업로드하지 못했습니다: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const cancel = () => confirm({ title: '업로드 취소', message: '업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });

  return (
    <DecoShell crumbs={[tab.label, '몰딩/벽판']} onCancel={cancel}>
      <div className="cl-ub">
        <div className="cl-ub-in cl-lw-box">
          {!shape ? (
            <div className="cl-ub-empty">
              <h4>로컬 파일을 골라 올리세요</h4>
              <p>cad 파일 — dxf, dwg 형식, 5MB 이하<Tip lines={LW_UPLOAD_TIPS} /></p>
              <button type="button" className="btn-ghost" onClick={pickFile}>+ 파일 추가</button>
              <button type="button" className="link-mini cl-lw-draw" onClick={() => setDrawing(true)}>✎ 단면 직접 그리기 (CAD 없이)</button>
            </div>
          ) : preview && base3d ? (
            <div className="cl-lw-prev">
              <LineWallPreview shape={shape} base={base3d} per={per3d} len={previewLen} onCanvas={(c) => { canvasRef.current = c; }} />
              <div className="cl-lw-prev-ops">
                <button type="button" className="btn-primary" onClick={() => { setPreview(false); requestAnimationFrame(() => setPreview(true)); }}>다시 미리보기</button>
                <button type="button" className="btn-primary" onClick={pickFile}>다시 올리기</button>
              </div>
            </div>
          ) : (
            <div className="cl-lw-done">
              <p className="cl-lw-ok"><span aria-hidden="true">✓</span> {file ? `올리기 성공 · ${file}` : '단면 그리기 완료'}</p>
              <ShapeOutline shape={shape} />
              <p className="cl-muted">단면 {shape.w} × {shape.h} mm · 구간 {shape.segs.length}개 — 오른쪽 내용을 채운 뒤 미리보기 하세요</p>
              <div className="cl-lw-prev-ops">
                <button type="button" className="btn-ghost" onClick={doPreview}>미리보기</button>
                <button type="button" className="btn-ghost" onClick={pickFile}>＋ 파일 바꾸기</button>
                <button type="button" className="btn-ghost" onClick={() => setDrawing(true)}>✎ 다시 그리기</button>
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".dxf,.dwg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        </div>
      </div>
      <div className="cl-up-form">
        <ul>
          <UpRow label="소재 이름" req><span className="cl-lw-name"><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" aria-label="소재 이름" maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /><span className="cl-up-count" aria-hidden="true">{name.length}/128</span></span></UpRow>
          <UpRow label="제품 유형" req>
            <KSelect label="제품 유형" placeholder="고르세요" value={type ? String(type) : ''} options={LW_TYPES.map((t) => ({ value: String(t.code), label: t.name, title: t.zh }))} onChange={changeType} />
          </UpRow>
          <UpRow label="크기" req tip={['몰딩은 고정 규격(길이 하나) 또는 맞춤 규격, 벽판은 고정 규격(길이 여러 개, 최대 10개)과 맞춤 최대 길이']}>
            {isWallboard(type) ? <WallSizeInput v={wall} onChange={setWall} /> : <MoldingSizeInput v={mold} onChange={setMold} />}
          </UpRow>
          <UpRow label="바탕 재질" req top tip={['바탕 재질은 몰딩 전체에 입히는 재질입니다. 어떤 면에 다른 재질을 덧붙이려면 ‘덧붙임 재질’을 누르세요']}>
            <MaterialPick area="바탕 재질" value={base} open={baseOpen} onOpen={() => setBaseOpen(true)} onApply={(v) => { setBase(v); setBaseOpen(false); }} items={mats} tree={matTree} />
          </UpRow>
          <UpRow label="소속 분류">
            <FolderCascader tree={tree} path={folder} onChange={setFolder} placeholder="몰딩·벽판 (미분류)" />
          </UpRow>
          <UpRow label="덧붙임 재질" tip={['한 단면에 여러 재질을 쓰는 상품용입니다 — 예: 조각 조명 홈, 부조 몰딩']}>
            <div className="cl-lw-attach">
              <button type="button" className="btn-primary" disabled={!shape || !base} title={!shape ? '단면을 먼저 올리세요' : !base ? '바탕 재질을 먼저 고르세요' : undefined} onClick={() => setAttachOpen(true)}>덧붙임 재질</button>
              {attachedMats.length > 0 && <ul className="cl-lw-attlist">{attachedMats.map((m) => <li key={m.id} title={m.name}>{m.img ? <img src={m.img} alt={m.name} /> : <span className="cl-mp-noimg" />}</li>)}</ul>}
            </div>
          </UpRow>
        </ul>
        <div className="cl-up-actions"><button className="btn-primary" disabled={busy} onClick={submit}>{busy ? '업로드 중…' : '확인 업로드'}</button></div>
      </div>

      {attachOpen && shape && base && <AttachDialog shape={shape} base={base} value={per} items={mats} tree={matTree} onCancel={() => setAttachOpen(false)}
        onOk={(v) => { setPer(v); setAttachOpen(false); setPreview(false); }} />}
      {ask?.k === 'type' && (
        <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="제품 유형">
          <header className="modal-head"><h3><span className="cl-lw-warn" aria-hidden="true">⚠</span> 먼저 제품 유형을 고르세요</h3><button className="cl-x" aria-label="닫기" onClick={() => setAsk(null)}>×</button></header>
          <div className="modal-body"><KSelect label="제품 유형 고르기" placeholder="고르세요" value={ask.pick ? String(ask.pick) : ''} options={LW_TYPES.map((t) => ({ value: String(t.code), label: t.name }))} onChange={(v) => setAsk({ k: 'type', pick: Number(v) })} /></div>
          <footer className="modal-foot"><button className="btn-primary" disabled={!ask.pick} onClick={() => { const p = ask.pick; setAsk(null); if (p) { changeType(String(p)); if (p !== LW_EXPOSED) requestAnimationFrame(() => fileRef.current?.click()); } }}>확인</button></footer>
        </div></div>
      )}
      {ask?.k === 'exposed' && (
        <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-label="외부 모서리 몰딩">
          <header className="modal-head"><h3><span className="cl-lw-warn" aria-hidden="true">⚠</span> 외부 모서리 몰딩 유형으로 바꾸면 파일을 다시 올려야 합니다</h3></header>
          <footer className="modal-foot">
            <button className="btn-primary" onClick={() => { setAsk(null); fileRef.current?.click(); }}>계속 올리기</button>
            <button className="btn-ghost" onClick={() => { const p = ask.prev; setAsk(null); setType(p); }}>바꾸지 않기</button>
          </footer>
        </div></div>
      )}
      {parseErr && (
        <div className="modal-backdrop" onClick={() => setParseErr('')}><div className="modal confirm-modal cl-up-alert" role="alertdialog" aria-modal="true" aria-label="해석 실패" onClick={(e) => e.stopPropagation()}>
          <header className="modal-head"><h3>해석하지 못했습니다 — {parseErr}</h3></header>
          <div className="modal-body cl-lw-rules"><p>파일은 아래 요건을 지켜야 합니다:</p>{LW_FILE_RULES.map((r) => <p key={r}>· {r}</p>)}</div>
          <footer className="modal-foot"><button className="btn-primary" onClick={() => setParseErr('')}>확인</button></footer>
        </div></div>
      )}
      {drawing && <SectionDrawLite init={shape} initPath={drawnPath} onClose={() => setDrawing(false)} onDone={(s, path) => { setDrawing(false); setShapeFrom(s, '', path); }} />}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </DecoShell>
  );
}

/** 그린 경로 → 몰딩 단면 (원호 선·둥근 모서리는 원호 한 구간 = 한 면) */
const drawnShape = (v: string) => { const s = sectionArcs(v); return shapeFromPolygon(s.points, s.bulges); };

/** 단면 직접 그리기 (HP3) — 윤곽 편집기 단면 모드. 그린 경로가 없으면 올린 CAD 단면을 원호째 경로로 바꿔 연다 */
function SectionDrawLite({ init, initPath, onClose, onDone }: { init: LwShape | null; initPath: string; onClose: () => void; onDone: (s: LwShape, path: string) => void }) {
  const [path] = useState(() => sectionStartPath(initPath ? { path: initPath }
    : init ? { path: sectionPathFromArcs(init.segs.map((g) => init.points[g.a]), init.segs.map((g) => g.bulge ?? 0)) } : undefined));
  const ctx = useMemo(() => sectionContext(path), [path]);
  const check = (v: string) => { try { drawnShape(v); return null; } catch (e) { return (e as Error).message; } };
  return (
    <ProfileEditor ev={ctx.ev} node={ctx.node} param="section" kind="line" closedDefault section title="몰딩/벽판 단면 그리기"
      onValidate={check} onSave={(v) => onDone(drawnShape(v), v)} onClose={onClose} />
  );
}
