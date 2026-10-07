import { useEffect, useRef, useState } from 'react';
import { newId, type PbrConfig, type ShapedInfo } from '../../data/contentLibrary';
import { putAsset } from '../../data/assetStore';
import { parseDxfLoops } from '../../data/dxf';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { MB, loadImage, nameMsg, readDataUrl, submitSizeMsg } from './decoUtil';
import { DecoShell, FolderChecks, GapColor, HoverCascader, UpAlert, UpRow, SizePair } from './decoWidgets';
import { MAT_OPTIONS, matPathName, matPathOf } from './matOptions';
import { RealtimeMaterialEditor } from './pbr/RealtimeMaterialEditor';
import { SHAPE_NAME, boxAspect, defaultParams, fixSide, fixSmall, fixStar, shapeOutline, shapedPreview, shapedSize, type Pt, type ShapeKind, type ShapeParams } from './shapedTile';

/**
 * 비정형 상품 업로드 (쿠지알러 铺贴产品 / 异型产品上传 · vc/commodity/upload/shapedtile)
 * 2026-10-07 쿠지알러에서 새로 만들어 보며 확인(완료 업로드는 누르지 않음) + 화면 번들(shapedtile)의 공식·검사 규칙.
 *  왼쪽: 이미지 여러 장(같은 크기) 올리기 → ‘업로드 성공’ · 미리보기 · 이미지 교체
 *  오른쪽: 소재 이름 · 크기 · 줄눈 · 형상(형상 설정 창에서 육각형·네 꼭지 별·둥근 모서리 사각·사용자 정의 CAD 를 고르고 이미지를 틀에 맞춰 자름)
 *          · 재질(실시간 재질 분류) · 소속 분류 · 계속 올리기/완료
 * 쿠지알러 ‘미리보기’·형상 생성은 서버 렌더(shape_preview·shape_create)라 HP3 는 자른 이미지를 형상대로 깔아 캔버스로 그린다.
 */

const TILE_LIB = 4;
const EXTS = ['svg', 'png', 'jpg', 'jpeg', 'bmp', 'webp'];
const ACCEPT = EXTS.map((e) => `.${e}`).join(', ');
const MAX_FILES = 32;
const GAP = { min: 0, max: 10, step: 0.1, def: 1.5, color: '#999999' };
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const PREVIEW_NOTE = '자른 이미지를 형상대로 줄눈 간격으로 깔아 그립니다 (쿠지알러는 서버 렌더)';
const validLen = (v: string) => { const n = Number(v.trim()); return v.trim() !== '' && !Number.isNaN(n) && n >= 10 && n <= 5000; };

type Face = { src: string; w: number; h: number };
type Cad = { name: string; w: number; h: number; points: Pt[] };
type Shape = { kind: ShapeKind; params: ShapeParams; cad?: Cad; keep: boolean };

/* ───────────────────────── 형상 설정 창 (编辑形状) ───────────────────────── */

const VIEW = { w: 520, h: 400 };
const BOX = 398;
const SCALE = { min: 1, max: 3, def: 1, step: 0.05 };
const CAD_RULES = [
  '1. .dxf 파일만, 크기 5MB 이하 (쿠지알러는 .dwg 도 받지만 HP3 는 브라우저에서 읽을 수 있는 DXF 만)',
  '2. 단일 닫힌 영역이어야 하며 따로 떨어진 선과 점은 버립니다. 지금은 직선과 원호만 되고 타원·스플라인은 안 됩니다.',
  '3. 파일 원래 크기는 CAD 파일 안 도형 자체의 크기입니다',
];

/** 형상 틀 크기(px) — 쿠지알러: 육각형 398·2/√3 × 398, 별·둥근 사각 398², 사용자 정의는 CAD 비율로 긴 쪽 398 */
function boxSize(kind: ShapeKind, cad: Cad | null): [number, number] {
  if (kind === 'hexagon') return [BOX * boxAspect('hexagon'), BOX];
  if (kind === 'custom' && cad) { const a = boxAspect('custom', cad); return a >= 1 ? [BOX, BOX / a] : [BOX * a, BOX]; }
  return [BOX, BOX];
}

/** 이미지가 틀을 꽉 채우는 처음 크기·위치 (쿠지알러 setSizeAndOffset) */
function fitCover(bw: number, bh: number, iw: number, ih: number) {
  const sx = bw / iw, sy = bh / ih;
  return sx > sy ? { w: bw, h: ih * sx, x: 0, y: -(ih * sx - bh) / 2 } : { w: iw * sy, h: bh, x: -(sy * iw - bw) / 2, y: 0 };
}

/** 틀이 늘 덮이도록 이동 범위를 묶는다 (쿠지알러 handleCropperMove) */
function clampOff(o: { x: number; y: number }, init: ReturnType<typeof fitCover>, s: number) {
  const ex = (init.w * (s - 1)) / 2, ey = (init.h * (s - 1)) / 2;
  return { x: Math.min(ex, Math.max(2 * init.x - ex, o.x)), y: Math.min(ey, Math.max(2 * init.y - ey, o.y)) };
}

/** 형상 아이콘 (쿠지알러 PNG 아이콘 대신 같은 공식으로 그린 SVG) */
function ShapeIcon({ kind }: { kind: Exclude<ShapeKind, 'custom'> }) {
  const pts = kind === 'hexagon' ? shapeOutline('hexagon', 56, 0, { straight: 0, arc: 0, side: 0 })
    : kind === 'star' ? shapeOutline('star', 40, 0, { straight: 2, arc: 9, side: 0 })
      : shapeOutline('radius', 56, 0, { straight: 1, arc: 3, side: 16 });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const w = Math.max(...xs), h = Math.max(...ys);
  return (
    <svg viewBox={`${-(64 - w) / 2} ${-(64 - h) / 2} 64 64`} width="54" height="54" aria-hidden="true">
      <path d={`M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L')} Z`} fill="currentColor" />
    </svg>
  );
}

/**
 * 틀 안에서 형상 밖(잘려 나갈 곳)을 반투명 검정으로, 형상 윤곽은 파란 점선으로.
 * 형상 상자(mm)를 틀에 그대로 늘인다 — 별은 변 길이 L 이 틀 안 마름모의 한 변 (쿠지알러 StarMask·RadiusMask 와 같음)
 */
function ShapeOverlay({ kind, L, params, cad, bw, bh }: { kind: ShapeKind; L: number; params: ShapeParams; cad: Cad | null; bw: number; bh: number }) {
  if (kind === 'custom' && !cad) return null;
  const W = kind === 'custom' && cad ? (L * cad.h) / cad.w : L;
  const [sw, sh] = shapedSize(kind, L, W);
  const pts = shapeOutline(kind, L, W, params, cad?.points);
  const d = `M${pts.map((p) => `${((p[0] / sw) * bw).toFixed(2)} ${((p[1] / sh) * bh).toFixed(2)}`).join(' L')} Z`;
  return (
    <svg className="cl-st-overlay" width="100%" height="100%" viewBox={`0 0 ${bw} ${bh}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0 0 H${bw} V${bh} H0 Z ${d}`} fillRule="evenodd" fill="rgba(0,0,0,0.5)" />
      <path d={d} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 3" />
    </svg>
  );
}
function ShapeDialog({ faces, L, onCancel, onOk }: { faces: Face[]; L: number; onCancel: () => void; onOk: (crops: string[], shape: Shape) => void }) {
  const first = faces[0];
  const init0 = defaultParams(L);
  const [kind, setKind] = useState<ShapeKind>('hexagon');
  const [star, setStar] = useState<ShapeParams>(init0.star);
  const [rad, setRad] = useState<ShapeParams>(init0.radius);
  const [cad, setCad] = useState<Cad | null>(null);
  const [cadFile, setCadFile] = useState<{ name: string; status: 'loading' | 'done' | 'error'; msg?: string } | null>(null);
  const [keep, setKeep] = useState(true);
  const [tip, setTip] = useState('');
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState(false);
  const [bw, bh] = boxSize(kind, cad);
  const init = fitCover(bw, bh, first.w, first.h);
  const [scale, setScale] = useState(SCALE.def);
  const [off, setOff] = useState({ x: init.x, y: init.y });
  const [boxKey, setBoxKey] = useState(`${bw}x${bh}`);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const cadRef = useRef<HTMLInputElement>(null);
  const tipTimer = useRef(0);

  // 틀이 바뀌면(형상·CAD) 위치를 처음으로 — 확대 배율은 그대로 (쿠지알러 identifyShapeType)
  const key = `${bw}x${bh}`;
  if (key !== boxKey) { setBoxKey(key); setOff({ x: init.x, y: init.y }); }

  const showTip = (m: string) => { setTip(m); window.clearTimeout(tipTimer.current); tipTimer.current = window.setTimeout(() => setTip(''), 2400); };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  const zoom = (s: number) => { const v = Math.min(SCALE.max, Math.max(SCALE.min, Math.round(s * 100) / 100)); setScale(v); setOff((o) => clampOff(o, init, v)); };
  const resetView = () => { setScale(SCALE.def); setOff({ x: init.x, y: init.y }); };
  // 스페이스 = 처음 크기·위치(쿠지알러 handleKeyDown) · Esc = 닫기. 입력 칸·단추에 초점이 있으면 스페이스는 그대로 둔다
  const cancelRef = useRef(onCancel);
  useEffect(() => { cancelRef.current = onCancel; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.querySelector('.cl-st-back .cl-up-alert')) return;
      if (e.key === 'Escape') { cancelRef.current(); return; }
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement)) { e.preventDefault(); setScale(SCALE.def); setOff({ x: init.x, y: init.y }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [init.x, init.y]);
  const dlgRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dlgRef.current?.focus(); }, []);

  const num = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0;
  const setStarVal = (k: 'straight' | 'arc', v: string) => {
    const n = num(v), f = fixStar(n, L);
    if (f !== n) showTip(k === 'straight' ? '직선 변은 변 길이의 절반보다 작아야 합니다' : '호 높이는 변 길이의 절반보다 작아야 합니다');
    setStar((p) => ({ ...p, [k]: f }));
  };
  const setRadVal = (k: 'side' | 'straight' | 'arc', v: string) => {
    const n = num(v);
    if (k === 'side') { const f = fixSide(n, L); if (f !== n) showTip('작은 타일 변 길이가 최댓값을 넘었습니다'); setRad((p) => ({ ...p, side: f })); return; }
    const f = fixSmall(n, rad.side);
    if (f !== n) showTip('직선 변은 작은 타일 변 길이의 절반보다 작아야 합니다');
    setRad((p) => ({ ...p, [k]: f }));
  };

  const readCad = async (f: File) => {
    if (f.size > 5 * MB) { setAlert('파일 크기는 5M를 넘을 수 없습니다'); return; }
    if (f.name.length > 50) { setAlert('이름이 너무 깁니다'); return; }
    const ext = f.name.split('.').pop()?.toLowerCase();
    setCadFile({ name: f.name, status: 'loading' });
    try {
      if (ext !== 'dxf') throw new Error('DWG 는 브라우저에서 읽을 수 없습니다 — CAD 에서 DXF 로 저장해 올려 주세요');
      const text = await f.text();
      if (/\n\s*0\s*\r?\n\s*(ELLIPSE|SPLINE)\s*\r?\n/.test(text)) throw new Error('타원·스플라인은 지원하지 않습니다 — 직선과 원호로 다시 그려 주세요');
      const r = parseDxfLoops(text, { gapTol: 0.01, minGap: 0 });
      if (r.loops.length !== 1) throw new Error(`단일 닫힌 영역이어야 합니다 — 닫힌 영역 ${r.loops.length}개`);
      const points = r.loops[0].map(([x, y]) => [x / r.w, (r.h - y) / r.h] as Pt);
      setCad({ name: f.name, w: r.w, h: r.h, points });
      setCadFile({ name: f.name, status: 'done' });
    } catch (e) {
      setCad(null);
      setCadFile({ name: f.name, status: 'error', msg: (e as Error).message });
    }
  };

  const confirmShape = async () => {
    if (busy) return;
    if ((kind === 'star' && star.arc === 0) || (kind === 'radius' && rad.arc === 0)) { showTip('호 높이는 0일 수 없습니다'); return; }
    if (kind === 'custom' && !cad) { setAlert('CAD 파일을 올리세요'); return; }
    setBusy(true);
    try {
      // 쿠지알러 cropImg: 원본 해상도를 살려 틀 비율로 자르고(한쪽 변 = 원본), 모든 면에 같은 자리를 쓴다
      const iw = first.w, ih = first.h;
      const ow = bw / bh > iw / ih ? iw : bw * (ih / bh), oh = bw / bh > iw / ih ? bh * (iw / bw) : ih;
      const dw = init.w * scale, dh = init.h * scale;
      const sx = (((init.w * (scale - 1)) / 2 - off.x) * iw) / dw, sy = (((init.h * (scale - 1)) / 2 - off.y) * ih) / dh;
      const crops: string[] = [];
      for (const f of faces) {
        const im = await loadImage(f.src);
        const c = document.createElement('canvas');
        c.width = Math.round(ow); c.height = Math.round(oh);
        const g = c.getContext('2d')!;
        g.drawImage(im, sx, sy, ow / scale, oh / scale, 0, 0, c.width, c.height);
        crops.push(c.toDataURL('image/jpeg', 0.92));
      }
      onOk(crops, { kind, params: kind === 'star' ? star : kind === 'radius' ? rad : { straight: 0, arc: 0, side: 0 }, cad: kind === 'custom' && cad ? cad : undefined, keep });
    } catch (e) {
      setAlert(`이미지를 자르지 못했습니다: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const bx = (VIEW.w - bw) / 2, by = (VIEW.h - bh) / 2;
  const imgStyle = (dx: number, dy: number) => ({ width: init.w * scale, height: init.h * scale, transform: `translate(${dx + off.x - (init.w * (scale - 1)) / 2}px, ${dy + off.y - (init.h * (scale - 1)) / 2}px)` });
  const params = kind === 'star' ? star : rad;
  return (
    <div className="modal-backdrop cl-st-back">
      <div ref={dlgRef} tabIndex={-1} className="modal cl-st-dlg" role="dialog" aria-modal="true" aria-label="형상 편집">
        <header className="cl-st-head"><h2>형상 편집</h2><button className="cl-x" aria-label="닫기" onClick={onCancel}>×</button></header>
        <div className="cl-st-body">
          <div className="cl-st-left">
            <div className="cl-st-view" style={{ width: VIEW.w, height: VIEW.h }}>
              <img className="cl-st-bg" src={first.src} alt="" draggable={false} style={imgStyle(bx, by)} />
              <div className="cl-st-mask" />
              <div className="cl-st-box" style={{ left: bx, top: by, width: Math.round(bw), height: Math.round(bh), backgroundPosition: `${-bx}px ${-by}px` }}
                onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX - off.x, y: e.clientY - off.y }; }}
                onPointerMove={(e) => { if (drag.current) setOff(clampOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }, init, scale)); }}
                onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
                onWheel={(e) => zoom(scale + (e.deltaY < 0 ? SCALE.step : e.deltaY > 0 ? -SCALE.step : 0))}>
                <img src={first.src} alt="자를 이미지" draggable={false} style={imgStyle(0, 0)} />
                <ShapeOverlay kind={kind} L={L} params={params} cad={cad} bw={bw} bh={bh} />
              </div>
            </div>
            <div className="cl-st-zoom">
              <button type="button" aria-label="축소" onClick={() => zoom(scale - SCALE.step)}>－</button>
              <input type="range" min={SCALE.min} max={SCALE.max} step={SCALE.step} value={scale} aria-label="확대 배율" onChange={(e) => zoom(Number(e.target.value))} />
              <button type="button" aria-label="확대" onClick={() => zoom(scale + SCALE.step)}>＋</button>
              <button type="button" className="cl-st-reset" title="처음 크기·위치로 (스페이스)" aria-label="처음 크기·위치로" onClick={resetView}>⊡</button>
            </div>
          </div>
          <div className="cl-st-right">
            <p className="cl-st-title">단위 형상 고르기</p>
            <ul className="cl-st-shapes">
              {(['hexagon', 'star', 'radius'] as const).map((k) => (
                <li key={k}><button type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} title={SHAPE_NAME[k]} aria-label={SHAPE_NAME[k]} onClick={() => setKind(k)}><ShapeIcon kind={k} /></button></li>
              ))}
              <li><button type="button" className={`cl-st-custom${kind === 'custom' ? ' on' : ''}`} aria-pressed={kind === 'custom'} onClick={() => setKind('custom')}>사용자 정의</button></li>
            </ul>
            {kind === 'star' && (
              <>
                <p className="cl-st-title">매개변수 설정</p>
                <label className="cl-st-param"><span>직선 변</span><span className="cl-st-num"><input className="inline-input" value={star.straight} aria-label="직선 변 mm" onChange={(e) => setStarVal('straight', e.target.value)} /><i>mm</i></span></label>
                <label className="cl-st-param"><span>호 높이</span><span className="cl-st-num"><input className="inline-input" value={star.arc} aria-label="호 높이 mm" onChange={(e) => setStarVal('arc', e.target.value)} /><i>mm</i></span></label>
              </>
            )}
            {kind === 'radius' && (
              <>
                <p className="cl-st-title">매개변수 설정</p>
                <label className="cl-st-param"><span>짝 맞는 작은 타일 변 길이</span><span className="cl-st-num"><input className="inline-input" value={rad.side} aria-label="짝 맞는 작은 타일 변 길이 mm" onChange={(e) => setRadVal('side', e.target.value)} /><i>mm</i></span></label>
                <label className="cl-st-param"><span>직선 변</span><span className="cl-st-num"><input className="inline-input" value={rad.straight} aria-label="직선 변 mm" onChange={(e) => setRadVal('straight', e.target.value)} /><i>mm</i></span></label>
                <label className="cl-st-param"><span>호 높이</span><span className="cl-st-num"><input className="inline-input" value={rad.arc} aria-label="호 높이 mm" onChange={(e) => setRadVal('arc', e.target.value)} /><i>mm</i></span></label>
              </>
            )}
            {kind === 'custom' && (
              <div className="cl-st-cad">
                <div className="cl-st-cadrow">
                  <button type="button" className="btn-ghost" disabled={cadFile?.status === 'loading'} onClick={() => cadRef.current?.click()}>CAD 파일 올리기</button>
                  <label className="cl-tl-check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />파일 원래 크기 유지</label>
                  <input ref={cadRef} type="file" accept=".dxf,.dwg" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void readCad(x); }} />
                </div>
                {cadFile && (
                  <p className={`cl-st-cadfile ${cadFile.status}`}>
                    <span>📄 {cadFile.name}</span>
                    {cadFile.status === 'loading' ? <em>읽는 중…</em> : cadFile.status === 'done' && cad ? <em>{cad.w} × {cad.h} mm</em> : null}
                    <button type="button" aria-label="CAD 파일 지우기" onClick={() => { setCadFile(null); setCad(null); }}>×</button>
                  </p>
                )}
                {cadFile?.status === 'error' && <p className="cl-up-err" role="alert">{cadFile.msg}</p>}
                <ul className="cl-st-rules">{CAD_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            {tip && <p className="cl-st-tip" role="status">{tip}</p>}
          </div>
        </div>
        <footer className="cl-st-foot">
          <button className="btn-ghost" onClick={onCancel}>취소</button>
          <button className="btn-primary" disabled={busy} onClick={() => void confirmShape()}>{busy ? '자르는 중…' : '확인'}</button>
        </footer>
      </div>
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
    </div>
  );
}

/* ───────────────────────── 화면 ───────────────────────── */

type UpState = { phase: 'empty' } | { phase: 'busy'; pct: number } | { phase: 'done' };

export function ShapedTilePage({ tab, st, onClose, onCreate }: PageProps) {
  const tree = st.trees[st.activeLibrary]?.[TILE_LIB] ?? [];
  const [up, setUp] = useState<UpState>({ phase: 'empty' });
  const [faces, setFaces] = useState<Face[]>([]);
  const [name, setName] = useState('');
  const [len, setLen] = useState('');
  const [wid, setWid] = useState('');
  const [gapColor, setGapColor] = useState(GAP.color);
  const [gapWidth, setGapWidth] = useState(String(GAP.def));
  const [crops, setCrops] = useState<string[]>([]);
  const [shape, setShape] = useState<Shape | null>(null);
  /** 사용자 정의 CAD 를 원래 크기로 둔 뒤 크기를 고치지 않았으면 CAD 크기를 그대로 쓴다 (쿠지알러 isSizeChangeAfterCadUpload) */
  const [cadSized, setCadSized] = useState(false);
  const [mat, setMat] = useState<string[]>([]);
  const [pbr, setPbr] = useState<PbrConfig | null>(null);
  const [rme, setRme] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);
  const [preview, setPreview] = useState<{ busy: boolean; url: string }>({ busy: false, url: '' });
  const [alert, setAlert] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const okL = validLen(len), okW = validLen(wid);
  const custom = shape?.kind === 'custom' ? shape.cad : undefined;
  const reset = () => { setUp({ phase: 'empty' }); setFaces([]); setName(''); setLen(''); setWid(''); setGapColor(GAP.color); setGapWidth(String(GAP.def)); setCrops([]); setShape(null); setCadSized(false); setMat([]); setPbr(null); setFolders([]); setPreview({ busy: false, url: '' }); };
  const cancel = () => confirm({ title: '업로드 취소', message: '업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });

  /** 이미지 올리기 — 32장까지, 한 장 2MB·5000×5000 이하, 여러 장이면 크기가 모두 같아야 (쿠지알러 문구 그대로) */
  const onFiles = async (list: File[]) => {
    if (!list.length) return;
    if (list.length > MAX_FILES) { setAlert(`최대 업로드 개수를 넘었습니다: ${MAX_FILES}`); return; }
    for (const f of list) {
      if (!EXTS.includes(f.name.split('.').pop()?.toLowerCase() ?? '')) { setAlert(`조건에 맞는 이미지를 고르세요: ${EXTS.map((e) => `*.${e}`).join(', ')}`); return; }
      if (f.size > 2 * MB) { setAlert('소재 크기는 2M를 넘을 수 없습니다'); return; }
      if (baseName(f.name).length > 128) { setAlert('소재 이름은 128자를 넘을 수 없습니다'); return; }
    }
    setUp({ phase: 'busy', pct: 0 });
    const got: Face[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const src = await readDataUrl(list[i]);
        const im = await loadImage(src);
        got.push({ src, w: im.naturalWidth, h: im.naturalHeight });
        setUp({ phase: 'busy', pct: Math.round(((i + 1) * 100) / list.length) });
      }
    } catch {
      setUp(faces.length ? { phase: 'done' } : { phase: 'empty' }); setAlert('업로드 실패'); return;
    }
    if (got.some((g) => g.w > 5000 || g.h > 5000)) { setUp(faces.length ? { phase: 'done' } : { phase: 'empty' }); setAlert('이미지 크기가 5000*5000을 넘습니다. 다시 고르세요'); return; }
    if (got.some((g) => g.w !== got[0].w || g.h !== got[0].h)) { setUp(faces.length ? { phase: 'done' } : { phase: 'empty' }); setAlert('이미지 크기가 서로 다릅니다. 다시 고르세요'); return; }
    // 쿠지알러 complateImgUpload: 이름이 비었으면 첫 파일 이름, 자른 이미지·미리보기는 지운다(형상을 다시 설정)
    setFaces(got);
    setName((n) => n || baseName(list[0].name));
    setCrops([]);
    setPreview({ busy: false, url: '' });
    setUp({ phase: 'done' });
  };

  /** 크기 — 사용자 정의 CAD 형상이면 길이·폭이 CAD 비율로 함께 움직인다 */
  const onSize = (l: string, w: string) => {
    if (custom && l !== len) { setLen(l); setWid(String(Math.round(Number(l) * (custom.h / custom.w)))); setCadSized(false); return; }
    if (custom && w !== wid) { setWid(w); setLen(String(Math.round(Number(w) * (custom.w / custom.h)))); setCadSized(false); return; }
    setLen(l); setWid(w);
  };

  const onShape = (c: string[], s: Shape) => {
    setCrops(c); setShape(s); setDialog(false); setPreview({ busy: false, url: '' });
    if (s.kind === 'custom' && s.cad) {
      if (s.keep) { setLen(String(Math.round(s.cad.w))); setWid(String(Math.round(s.cad.h))); setCadSized(true); }
      else { setWid(String(Math.round(Number(len) * (s.cad.h / s.cad.w)))); setCadSized(false); }
    }
  };

  /**
   * 형상 상자·윤곽(mm)과 저장할 상품 크기 — 쿠지알러 calcuSize: 육각형 폭 = L·√3/2, 별 = L·√2 정사각형, 둥근 사각 = L 정사각형(모두 정수로 자름),
   * 사용자 정의는 입력한 길이·폭 또는 원래 크기를 유지한 CAD 크기
   */
  const geom = (s: Shape) => {
    const kept = s.kind === 'custom' && s.cad && cadSized;
    const L = kept && s.cad ? s.cad.w : parseInt(len, 10), W = kept && s.cad ? s.cad.h : parseInt(wid, 10);
    const box = shapedSize(s.kind, L, W);
    const size: [number, number] = s.kind === 'custom' ? [L, W] : [Math.trunc(box[0]), Math.trunc(box[1])];
    return { box, outline: shapeOutline(s.kind, L, W, s.params, s.cad?.points), size };
  };
  const gapNum = () => { const g = gapWidth.trim(); const n = Number(g); return g === '' || Number.isNaN(n) ? null : Math.min(GAP.max, Math.max(GAP.min, n)); };
  const canPreview = crops.length > 0 && okL && okW && gapNum() !== null;

  const doPreview = async () => {
    if (!canPreview || !shape) return;
    setPreview({ busy: true, url: preview.url });
    const g = geom(shape);
    const url = await shapedPreview(crops, g.outline, g.box, gapColor, gapNum() ?? GAP.def, shape.kind).catch(() => '');
    setPreview({ busy: false, url });
  };

  const submit = async (keepOpen: boolean) => {
    if (saving) return;
    const msg = !faces.length ? '먼저 이미지를 올리세요!'
      : nameMsg(name) || submitSizeMsg([len, wid])
      || (gapNum() === null ? '줄눈 폭을 입력하세요!' : '')
      || (!crops.length || !shape ? '먼저 형상을 편집하세요!' : '')
      || (mat.length < 2 ? '재질을 고르세요' : '');
    if (msg || !shape) { setAlert(msg); return; }
    setSaving(true);
    try {
      const g = geom(shape);
      const [bw, bh] = g.size;
      const assets: string[] = [];
      for (const c of crops) { const id = newId('TEX'); await putAsset(id, c); assets.push(id); }
      const img = await shapedPreview(crops, g.outline, g.box, gapColor, gapNum() ?? GAP.def, shape.kind).catch(() => crops[0]);
      const info: ShapedInfo = {
        kind: shape.kind, faces: assets, gapColor, gapWidth: gapNum() ?? GAP.def, mat: mat.length === 2 ? [mat[0], mat[1]] : null,
        params: shape.kind === 'star' || shape.kind === 'radius' ? shape.params : undefined,
        pbr: pbr ?? undefined,
        cad: shape.kind === 'custom' && shape.cad ? { name: shape.cad.name, w: shape.cad.w, h: shape.cad.h, points: shape.cad.points, keep: cadSized } : undefined,
      };
      const nm = name.trim();
      onCreate([{
        name: nm, lib: TILE_LIB, folder: folders[0], extraFolders: folders.length > 1 ? folders.slice(1) : undefined,
        img, texture: assets[0], modelSize: `${bw}x${bh}(mm)`, renderCat: `비정형 상품(${SHAPE_NAME[shape.kind]})`, material: matPathName(mat), shaped: info,
      }], `비정형 상품 ‘${nm}’을(를) 올렸습니다`, keepOpen ? { keep: true } : { detail: true });
      if (keepOpen) reset();
    } catch (e) {
      setAlert(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally { setSaving(false); }
  };

  return (
    <DecoShell crumbs={[tab.label, '타일 상품', '비정형 상품 업로드']} onCancel={cancel}>
      <div className="cl-ub">
        <div className="cl-ub-in">
          {up.phase === 'empty' ? (
            <div className="cl-ub-empty">
              <h4>로컬 파일을 골라 올리세요</h4>
              <p>한 장 2M 이하, 해상도 5000*5000 이하</p>
              <p>여러 장을 올리려면 크기가 모두 같아야 합니다</p>
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>+ 파일 추가</button>
            </div>
          ) : up.phase === 'busy' ? (
            <div className="cl-st-progress" role="progressbar" aria-valuenow={up.pct} aria-valuemin={0} aria-valuemax={100} aria-label="올리는 중">
              <svg viewBox="0 0 36 36" width="96" height="96" aria-hidden="true"><circle cx="18" cy="18" r="15.9" fill="none" stroke="#e6e8eb" strokeWidth="3" /><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--sky)" strokeWidth="3" strokeDasharray={`${up.pct} 100`} transform="rotate(-90 18 18)" /></svg>
              <b>{up.pct}%</b>
            </div>
          ) : preview.url ? (
            <div className="cl-st-preview">
              <img src={preview.url} alt="효과 미리보기" />
              <div className="cl-st-preview-bar">
                <button type="button" className="btn-primary" disabled={preview.busy} title={PREVIEW_NOTE} onClick={() => void doPreview()}>{preview.busy ? '미리보기 중…' : '다시 미리보기'}</button>
                <button type="button" className="btn-ghost" disabled={preview.busy} onClick={() => fileRef.current?.click()}>+ 이미지 교체</button>
              </div>
            </div>
          ) : (
            <div className="cl-st-done">
              <h4><span aria-hidden="true">✓</span> 업로드 성공</h4>
              <p>오른쪽 내용을 채운 뒤 미리보기 하세요{faces.length > 1 ? ` · 이미지 ${faces.length}장` : ''}</p>
              <div>
                <button type="button" className="btn-ghost" disabled={!canPreview || preview.busy} title={PREVIEW_NOTE} onClick={() => void doPreview()}>{preview.busy ? '미리보기 중…' : '미리보기'}</button>
                <button type="button" className="btn-ghost" disabled={preview.busy} onClick={() => fileRef.current?.click()}>+ 이미지 교체</button>
              </div>
            </div>
          )}
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void onFiles(fs); }} />
        </div>
      </div>
      <div className="cl-up-form">
        <ul>
          <UpRow label="소재 이름" req><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></UpRow>
          <UpRow label="크기" req top tip={['설정한 길이·폭은 10-5000mm 안']}>
            <SizePair l={len} w={wid} noSwap={shape?.kind === 'custom'} onChange={onSize} />
          </UpRow>
          <UpRow label="줄눈" req>
            <div className="cl-tl-gap">
              <GapColor value={gapColor} onChange={setGapColor} />
              <span>폭</span>
              <input type="range" min={GAP.min} max={GAP.max} step={GAP.step} value={Number(gapWidth) || 0} aria-label="줄눈 폭 슬라이더" onChange={(e) => setGapWidth(e.target.value)} />
              <label className="cl-tl-num"><input className="inline-input" value={gapWidth} aria-label="줄눈 폭 mm" onChange={(e) => setGapWidth(e.target.value)}
                onBlur={() => { const n = gapNum(); if (n !== null) setGapWidth(String(n)); }} />mm</label>
            </div>
          </UpRow>
          <UpRow label="형상" req tip={['올바른 크기를 입력한 뒤 설정하세요']}>
            <div className="cl-st-set">
              <button type="button" className="btn-ghost" disabled={!(faces.length && okL && okW)} onClick={() => setDialog(true)}>형상 설정</button>
              {crops.length > 0 && shape && <span className="cl-st-hook" title={`${SHAPE_NAME[shape.kind]} 설정됨`}><b aria-hidden="true">✓</b>{SHAPE_NAME[shape.kind]}</span>}
            </div>
          </UpRow>
          <UpRow label="재질 선택" req top>
            <div className="cl-tl-mat">
              <select className="inline-input" aria-label="재질 분류 종류" value="pbr" onChange={() => {}}>
                <option value="pbr">실시간 재질 분류</option>
                <option value="new" disabled>새 재질 분류 (곧 종료)</option>
              </select>
              <div className="cl-rme-matrow">
                <HoverCascader label="실시간 재질 분류" expand="click" options={MAT_OPTIONS} value={mat} onChange={(m) => { setMat(m); setPbr(null); }} />
                <button type="button" className="cl-rme-gear" disabled={mat.length < 2} title={mat.length < 2 ? '재질 분류를 먼저 고르세요' : '실시간 재질 제작 도구 — 재질 세부 조정'} aria-label="실시간 재질 제작 도구" onClick={() => setRme(true)}>⚙</button>
              </div>
              {pbr && <span className="cl-rme-tuned">✓ 실시간 재질 세부 조정됨 <button type="button" onClick={() => setPbr(null)}>해제</button></span>}
            </div>
          </UpRow>
          <UpRow label="소속 분류">
            <FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={folders} onChange={setFolders} />
          </UpRow>
        </ul>
        <div className="cl-up-actions">
          <button className="btn-ghost" disabled={saving} onClick={() => void submit(true)}>계속 올리기</button>
          <button className="btn-primary" disabled={saving} onClick={() => void submit(false)}>{saving ? '저장 중…' : '완료'}</button>
        </div>
      </div>
      {rme && mat.length === 2 && (
        <RealtimeMaterialEditor templateId={mat[1]} diffuse={faces.length === 1 ? faces[0].src : undefined}
          size={[Number(len) || 1000, Number(wid) || 1000]} init={pbr}
          onCancel={() => setRme(false)}
          onSave={(cfg) => { setPbr(cfg); setMat(matPathOf(cfg.template) ?? mat); setRme(false); }} />
      )}
      {dialog && faces.length > 0 && <ShapeDialog faces={faces} L={parseInt(len, 10)} onCancel={() => setDialog(false)} onOk={onShape} />}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </DecoShell>
  );
}
