import { useRef, useState } from 'react';
import { itemsOf, newId, walkFolders, type Folder, type Item, type PbrConfig, type TileInfo } from '../../data/contentLibrary';
import { PAVING, PAVING_BY_CAT, PAVING_NAME, RENDERCAT, TILE_DEFAULTS, TILE_PAGE_SIZE, TILE_RENDER_CATS, renderPath, sizeMax, type RenderCat } from '../../data/pavingData';
import { putAsset } from '../../data/assetStore';
import { useConfirm } from '../../components/confirm';
import type { NewItemDraft, PageProps } from './createTypes';
import { MB, itemLW, loadImage, readDataUrl } from './decoUtil';
import { FolderChecks, GapColor, HoverCascader, Pager, Tip, UpAlert, UpRow, SizePair, type CascOption } from './decoWidgets';
import { pavingPreview, type PreviewOrder } from './tilePreview';
import { MAT_OPTIONS, matPathName, matPathOf } from './matOptions';
import { RealtimeMaterialEditor } from './pbr/RealtimeMaterialEditor';

/**
 * 타일 상품 업로드 (쿠지알러 铺贴产品上传 · 多面铺贴商品上传) — 2026-10-07 쿠지알러에서 새로 만들어 보며 확인(확인 업로드는 누르지 않음) + 화면 번들 규칙.
 *  ‘타일 상품 업로드’   이미지 한 장 = 상품 하나. 여러 장을 올린 뒤 일괄 수정·카드별 편집, 재질 인용으로도 상품을 만든다.
 *  ‘다면 타일 상품 업로드’ 이미지 여러 장 = 상품 하나(면마다 다른 무늬). 맞춤 배열로 칸마다 면을 정할 수 있다(일자 붙임만).
 * 쿠지알러 ‘효과 미리보기’는 서버 렌더지만 HP3 는 캔버스로 그린다(tilePreview.ts). 재질 인용 대상은 쿠지알러 기초 재질 라이브러리 대신 HP3 재질 라이브러리.
 */

const renderOpts = (list: RenderCat[]): CascOption[] => list.map((c) => ({ value: String(c.id), label: c.name, title: c.zh, children: c.children.length ? renderOpts(c.children) : undefined }));
const RENDER_OPTIONS = renderOpts(TILE_RENDER_CATS);

const EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'jp2', 'jpe'];
const ACCEPT = EXTS.map((e) => `.${e}`).join(',');
const ADD_TIP = `5MB 이하, 해상도 5000×5000 이하, 텍스처 파일 형식: ${EXTS.map((e) => `*.${e}`).join(', ')}`;
const TILE_LIB = 4;

/** 상품(또는 다면 상품의 면) 하나 */
type Face = { uid: string; name: string; src: string; w: number; h: number; err?: string };
/** 서랍에서 고치는 값 */
type TileForm = {
  name: string; L: string; W: string; gapColor: string; gapWidth: string;
  mat: string[]; cat: string[]; paving: string; angle: string;
  range: { on: boolean; minL: string; maxL: string; minW: string; maxW: string };
  folders: string[];
  custom: boolean; order: (PreviewOrder & { L: number; W: number }) | null;
  /** 실시간 재질 세부 조정 (⚙) */
  pbr: PbrConfig | null;
};
type Draft = Face & { form: TileForm; ref?: { id: string; material: string } };

const emptyRange = { on: false, minL: '', maxL: '', minW: '', maxW: '' };
const emptyForm = (name = ''): TileForm => ({ name, L: '', W: '', gapColor: TILE_DEFAULTS.gapColor, gapWidth: String(TILE_DEFAULTS.gapWidth), mat: [], cat: [], paving: '', angle: '', range: emptyRange, folders: [], custom: false, order: null, pbr: null });
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
const uid = () => Math.random().toString(36).slice(2, 10);

/** 서랍 검사 — 쿠지알러 문구 순서대로. 이름·이미지는 단일 편집·다면만 */
function formErrors(f: TileForm, o: { name?: boolean; image?: boolean; hasImage?: boolean; locked?: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  if (o.name) { if (!f.name.trim()) e.name = '소재 이름을 입력하세요'; else if (f.name.length > 128) e.name = '길이가 제한을 넘었습니다'; }
  const cat1 = Number(f.cat[0]) || undefined;
  if (!o.locked) {
    const max = sizeMax(cat1), l = Number(f.L), w = Number(f.W);
    if (!(l >= 10 && l <= max && w >= 10 && w <= max)) e.size = `10-${max}mm`;
  }
  const g = f.gapWidth.trim();
  if (g === '') e.gap = '줄눈 값을 입력하세요'; else if (!(Number(g) >= 0 && Number(g) <= 10)) e.gap = '0-10mm';
  if (!o.locked && f.mat.length < 2) e.mat = '재질 분류를 고르세요';
  if (!f.cat.length) e.cat = '렌더 분류를 고르세요';
  const wave = Number(f.cat[1]) === RENDERCAT.WAVE_LINE;
  if (!wave && f.cat.length) {
    if (!f.paving) e.paving = '기본 붙임 방식을 고르세요';
    else if (Number(f.paving) === PAVING.VORTEX && (!f.L || f.L !== f.W)) e.paving = '바람개비 붙임은 정사각형만 됩니다. 크기를 고치세요';
    else if (Number(f.paving) === PAVING.FISHBONE && !f.angle) e.angle = '붙임 각도를 고르세요';
  }
  if (o.image && !o.hasImage) e.image = '이미지를 올리세요';
  return e;
}

/* ───────────────────────── 작은 부품 ───────────────────────── */

function Thumb({ f, onClick, onDelete }: { f: Face; onClick: () => void; onDelete: () => void }) {
  return (
    <li className={`cl-tl-card${f.err ? ' bad' : ''}`}>
      <button type="button" className="cl-tl-img" onClick={onClick} title={f.err ?? f.name} aria-label={`${f.name} 편집`}>
        {f.err ? <span className="cl-tl-bad"><b aria-hidden="true">⊗</b>이미지 무효</span> : <img src={f.src} alt="" />}
      </button>
      <span className="cl-tl-name" title={f.name}>{f.name}</span>
      <button type="button" className="cl-tl-del" aria-label={`${f.name} 삭제`} onClick={onDelete}>×</button>
    </li>
  );
}

/* ───────────────────────── 서랍 ───────────────────────── */

type DrawerMode = 'batch' | 'single' | 'multi';

/**
 * 오른쪽 서랍 — 일괄 수정(batch) / 카드 편집(single) / 다면 소재 속성 편집(multi). ‘저장’은 목록에만 반영(아직 올리지 않음).
 * 막 올린 뒤 처음 여는 일괄 수정에서 ‘취소’하면 ‘취소하고 파일을 다시 고를까요?’ — 확인하면 올린 파일을 버린다.
 */
function TileDrawer({ mode, init, face, faces, locked, firstUpload, tree, onSave, onCancel, onDiscard }: {
  mode: DrawerMode; init: TileForm; face?: Face; faces?: Face[]; locked?: { material: string }; firstUpload?: boolean; tree: Folder[];
  onSave: (f: TileForm, face?: Face) => void; onCancel: () => void; onDiscard?: () => void;
}) {
  const [f, setF] = useState<TileForm>(init);
  const [img, setImg] = useState<Face | undefined>(face);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [pop, setPop] = useState(false);
  const [order, setOrder] = useState(false);
  const [customAsk, setCustomAsk] = useState(false);
  const [rme, setRme] = useState(false);
  const [preview, setPreview] = useState<{ busy: boolean; url: string; stale: boolean }>({ busy: false, url: '', stale: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<TileForm>) => { setF((x) => ({ ...x, ...p })); setPreview((v) => ({ ...v, stale: true })); };
  const cat1 = Number(f.cat[0]) || undefined;
  const wave = Number(f.cat[1]) === RENDERCAT.WAVE_LINE;
  const pavings = (cat1 && PAVING_BY_CAT[cat1]) || [];
  const max = sizeMax(cat1);
  const opts = { name: mode !== 'batch', image: mode === 'single', hasImage: !!img?.src && !img.err, locked: !!locked };
  const save = () => {
    const e = formErrors(f, opts);
    if (mode === 'multi' && f.custom && !f.order) e.paving = '배열 순서를 정하세요';
    setErrs(e);
    if (!Object.keys(e).length) onSave(f, img);
  };
  const doPreview = async () => {
    const e = formErrors(f, opts);
    if (Object.keys(e).length) { setErrs(e); setPreview((v) => ({ ...v, url: '', busy: false })); return; }
    setPreview({ busy: true, url: '', stale: false });
    const srcs = mode === 'multi' ? (faces ?? []).filter((x) => !x.err).map((x) => x.src) : img ? [img.src] : [];
    const url = await pavingPreview(srcs, { L: Number(f.L), W: Number(f.W), gapColor: f.gapColor, gapWidth: Number(f.gapWidth), paving: wave ? PAVING.STRAIGHT : Number(f.paving), angle: (Number(f.angle) || undefined) as 45 | 60 | undefined, order: f.custom ? f.order : null }).catch(() => '');
    setPreview({ busy: false, url, stale: false });
  };
  const replace = async (file: File) => {
    const r = await readFace(file);
    setImg(r); if (!r.err && mode === 'single' && !f.name.trim()) set({ name: r.name });
    setPreview((v) => ({ ...v, stale: true }));
  };
  const title = mode === 'batch' ? '일괄 수정' : mode === 'multi' ? '소재 속성 편집' : '상품 편집';
  return (
    <div className="cl-tl-drawer-wrap">
      <aside className="cl-tl-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <ul className="cl-tl-form">
          {mode !== 'batch' && <UpRow label="소재 이름" req err={errs.name}><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" value={f.name} onChange={(e) => set({ name: e.target.value })} /></UpRow>}
          <UpRow label="크기" req tip={[`${10}-${max}mm`]} err={errs.size}>
            <SizePair live={false} l={f.L} w={f.W} disabled={!!locked} onChange={(L, W) => set({ L, W, range: emptyRange })} />
            {locked && <p className="cl-tl-note">크기는 인용한 원래 재질과 같게 유지되며 지금은 바꿀 수 없습니다</p>}
          </UpRow>
          {cat1 === RENDERCAT.CARPET && (
            <UpRow label="가변 범위" tip={['설계 툴에서 상품 크기를 조절할 수 있는 범위']}>
              <label className="cl-tl-check"><input type="checkbox" checked={f.range.on} disabled={!f.L || !f.W || !!locked} onChange={(e) => set({ range: e.target.checked ? { ...f.range, on: true } : emptyRange })} />가변 범위 사용</label>
              {f.range.on && (
                <div className="cl-tl-range">
                  <label>길이 <input className="inline-input" value={f.range.minL} aria-label="길이 최소" onChange={(e) => set({ range: { ...f.range, minL: e.target.value } })} /> ~ <input className="inline-input" value={f.range.maxL} aria-label="길이 최대" onChange={(e) => set({ range: { ...f.range, maxL: e.target.value } })} /> mm</label>
                  <label>폭 <input className="inline-input" value={f.range.minW} aria-label="폭 최소" onChange={(e) => set({ range: { ...f.range, minW: e.target.value } })} /> ~ <input className="inline-input" value={f.range.maxW} aria-label="폭 최대" onChange={(e) => set({ range: { ...f.range, maxW: e.target.value } })} /> mm</label>
                </div>
              )}
            </UpRow>
          )}
          <UpRow label="줄눈" req err={errs.gap}>
            <div className="cl-tl-gap">
              <GapColor value={f.gapColor} onChange={(gapColor) => set({ gapColor })} />
              <span>폭</span>
              <input type="range" min={0} max={10} step={0.1} value={Number(f.gapWidth) || 0} aria-label="줄눈 폭 슬라이더" onChange={(e) => set({ gapWidth: e.target.value })} />
              <label className="cl-tl-num"><input className="inline-input" value={f.gapWidth} aria-label="줄눈 폭 mm" onChange={(e) => set({ gapWidth: e.target.value })} />mm</label>
            </div>
          </UpRow>
          <UpRow label="재질 분류" req top tip={['새 재질 선택지를 제공해 재질 표현이 크게 좋아졌습니다. 예전 재질 분류는 곧 내려갑니다(쿠지알러 안내)']} err={errs.mat}>
            {locked ? <p className="cl-tl-locked">{locked.material || '인용한 재질'}<small>재질 분류는 인용한 원래 재질과 같게 유지되며 지금은 바꿀 수 없습니다</small></p> : (
              <div className="cl-tl-mat">
                <select className="inline-input" aria-label="재질 분류 종류" value="pbr" onChange={() => {}}>
                  <option value="pbr">실시간 재질 분류</option>
                  <option value="new" disabled>새 재질 분류 (곧 종료)</option>
                </select>
                <div className="cl-rme-matrow">
                  <HoverCascader label="실시간 재질 분류" expand="click" options={MAT_OPTIONS} value={f.mat} onChange={(mat) => set({ mat, pbr: null })} />
                  <button type="button" className="cl-rme-gear" disabled={f.mat.length < 2} title={f.mat.length < 2 ? '재질 분류를 먼저 고르세요' : '실시간 재질 제작 도구 — 재질 세부 조정'} aria-label="실시간 재질 제작 도구" onClick={() => setRme(true)}>⚙</button>
                </div>
                {f.pbr && <span className="cl-rme-tuned">✓ 실시간 재질 세부 조정됨 <button type="button" onClick={() => set({ pbr: null })}>해제</button></span>}
              </div>
            )}
          </UpRow>
          <UpRow label="렌더 분류" req err={errs.cat}>
            <HoverCascader label="렌더 분류" options={RENDER_OPTIONS} value={f.cat} onChange={(cat) => set({ cat, paving: cat[0] !== f.cat[0] ? '' : f.paving, angle: cat[0] !== f.cat[0] ? '' : f.angle })} />
          </UpRow>
          {f.cat.length > 0 && !wave && (
            <UpRow label="기본 붙임 방식" req err={errs.paving ?? errs.angle}>
              <select className="inline-input cl-up-in" aria-label="기본 붙임 방식" value={f.custom ? String(PAVING.STRAIGHT) : f.paving} disabled={f.custom} onChange={(e) => set({ paving: e.target.value, angle: '' })}>
                <option value="">선택하세요</option>
                {pavings.map((p) => <option key={p} value={p} title={PAVING_NAME[p].zh}>{PAVING_NAME[p].name}</option>)}
              </select>
              {Number(f.paving) === PAVING.FISHBONE && !f.custom && (
                <select className="inline-input cl-up-in cl-tl-angle" aria-label="붙임 각도" value={f.angle} onChange={(e) => set({ angle: e.target.value })}>
                  <option value="">붙임 각도를 고르세요</option><option value="45">45도</option><option value="60">60도</option>
                </select>
              )}
              {mode === 'multi' && (
                <div className="cl-tl-custom">
                  <label className="cl-tl-check"><input type="checkbox" checked={f.custom} onChange={(e) => { if (e.target.checked) setCustomAsk(true); else set({ custom: false, order: null }); }} />맞춤 배열</label>
                  <Tip lines={['순서를 정한 배열로 이어진 무늬·아트월을 보여 줍니다. 맞춤 배열은 일자 붙임만 됩니다']} /><em className="cl-tl-beta">beta</em>
                  <button type="button" className="btn-ghost cl-tl-orderbtn" disabled={!f.custom} onClick={() => setOrder(true)}>배열 순서{f.order ? ` (${f.order.rows}×${f.order.cols})` : ''}</button>
                </div>
              )}
            </UpRow>
          )}
          <UpRow label="소속 분류">
            <FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={f.folders} onChange={(folders) => set({ folders })} />
          </UpRow>
          {mode === 'single' && (
            <UpRow label="이미지 파일" req err={errs.image}>
              <div className="cl-tl-file">
                {img && !img.err ? <img src={img.src} alt="" /> : <span className="cl-tl-bad"><b aria-hidden="true">⊗</b>{img?.err ?? '이미지 없음'}</span>}
                <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>{img ? '이미지 교체' : '이미지 올리기'}</button>
                <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void replace(x); }} />
              </div>
            </UpRow>
          )}
          {mode !== 'batch' && (
            <UpRow label="효과 미리보기" top>
              <div className="cl-tl-prev">
                {preview.url ? <img src={preview.url} alt="효과 미리보기" /> : <span>{preview.busy ? '미리보기 중…' : '오른쪽 내용을 채운 뒤 미리보기를 누르세요'}</span>}
                <button type="button" className="btn-ghost" disabled={preview.busy} onClick={() => void doPreview()}>{preview.url ? (preview.stale ? '다시 미리보기' : '다시 미리보기') : '미리보기'}</button>
              </div>
            </UpRow>
          )}
        </ul>
        <footer>
          {firstUpload ? (
            <span className="cl-tl-popwrap">
              <button className="btn-ghost" onClick={() => setPop(true)}>취소</button>
              {pop && (
                <span className="cl-tl-pop" role="alertdialog" aria-label="취소 확인">
                  <b>취소하고 파일을 다시 고를까요?</b>
                  <span><button className="btn-ghost" onClick={() => setPop(false)}>계속 편집</button><button className="btn-primary" onClick={() => onDiscard?.()}>확인</button></span>
                </span>
              )}
            </span>
          ) : <button className="btn-ghost" onClick={onCancel}>취소</button>}
          <button className="btn-primary" onClick={save}>저장</button>
        </footer>
      </aside>
      {rme && f.mat.length === 2 && (
        <RealtimeMaterialEditor templateId={f.mat[1]} diffuse={mode === 'single' && img && !img.err ? img.src : undefined}
          size={[Number(f.L) || 1000, Number(f.W) || 1000]} init={f.pbr}
          onCancel={() => setRme(false)}
          onSave={(cfg) => { set({ pbr: cfg, mat: matPathOf(cfg.template) ?? f.mat }); setRme(false); }} />
      )}
      {customAsk && <UpAlert msg="【맞춤 배열】 기능은 지금 우선 체험 단계이며 계속 다듬고 있습니다." onClose={() => { setCustomAsk(false); set({ custom: true, paving: String(PAVING.STRAIGHT), angle: '' }); setOrder(true); }} />}
      {order && faces && (
        <OrderDialog faces={faces.filter((x) => !x.err)} init={f.order} L={f.L} W={f.W} max={max}
          onCancel={() => setOrder(false)} onSave={(o) => { set({ order: o, L: String(o.L), W: String(o.W) }); setOrder(false); }} />
      )}
    </div>
  );
}

/* ───────────────────────── 배열 순서 (铺法排序) ───────────────────────── */

const GRID_W = 536, GRID_H = 310;

function OrderDialog({ faces, init, L, W, max, onCancel, onSave }: {
  faces: Face[]; init: (PreviewOrder & { L: number; W: number }) | null; L: string; W: string; max: number;
  onCancel: () => void; onSave: (o: PreviewOrder & { L: number; W: number }) => void;
}) {
  const [size, setSize] = useState({ L: init ? String(init.L) : L || '600', W: init ? String(init.W) : W || '600' });
  const [rc, setRc] = useState({ rows: String(init?.rows ?? 3), cols: String(init?.cols ?? 3) });
  const [cells, setCells] = useState<(number | null)[]>(init?.cells ?? Array(9).fill(null));
  const [hist, setHist] = useState<(number | null)[][]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [warn, setWarn] = useState('');
  const rows = parseInt(rc.rows, 10), cols = parseInt(rc.cols, 10);
  const rcOk = rows >= 1 && rows <= 10 && cols >= 1 && cols <= 10;
  const l = Number(size.L), w = Number(size.W);
  const sizeOk = l >= 10 && l <= max && w >= 10 && w <= max;
  const R = rcOk ? rows : 1, Cc = rcOk ? cols : 1;
  // 칸 크기 — 단일 타일 비율로 536×310 안에 맞춤 (쿠지알러 handleSizeChange)
  const tw = cols * (l || 1), th = rows * (w || 1);
  const k = Math.min(GRID_W / tw, GRID_H / th);
  const cw = (l || 1) * k, chh = (w || 1) * k;
  const setRC = (r: string, c: string) => {
    setRc({ rows: r, cols: c });
    const nr = parseInt(r, 10), nc = parseInt(c, 10);
    if (nr >= 1 && nr <= 10 && nc >= 1 && nc <= 10) { setHist((h) => [...h, cells]); setCells(Array(nr * nc).fill(null)); }
  };
  const put = (i: number, face: number | null) => { setHist((h) => [...h, cells]); setCells((c) => c.map((x, j) => (j === i ? face : x))); setWarn(''); };
  const save = () => {
    if (!sizeOk || !rcOk) return;
    if (cells.some((c) => c == null)) { setWarn('캔버스의 모든 칸을 채워 주세요'); return; }
    onSave({ rows: R, cols: Cc, cells, L: l, W: w });
  };
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal cl-modal xl cl-od" role="dialog" aria-modal="true" aria-label="배열 순서" onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head"><h2 className="modal-title">배열 순서</h2><span className="cl-od-warn">! 이 기능은 지금 우선 체험 단계이며 계속 다듬고 있습니다.</span></div>
        <div className="cl-od-body">
          <div className="cl-od-left">
            <div className="cl-od-row"><span>단일 타일 크기</span><SizePair live={false} l={size.L} w={size.W} onChange={(a, b) => setSize({ L: a, W: b })} />{!sizeOk && <em className="cl-up-err">{`10-${max}mm`}</em>}</div>
            <div className="cl-od-row"><span>배치 설정</span>
              <div className="cl-size">
                <label><span>행</span><input className="inline-input" value={rc.rows} aria-label="행" onChange={(e) => setRC(e.target.value, rc.cols)} /></label>
                <button type="button" className="cl-size-x" title="교환" aria-label="행·열 교환" onClick={() => setRC(rc.cols, rc.rows)}>⇄</button>
                <label><span>열</span><input className="inline-input" value={rc.cols} aria-label="열" onChange={(e) => setRC(rc.rows, e.target.value)} /></label>
              </div>
              {!rcOk && <em className="cl-up-err">1~10</em>}
            </div>
            <div className="cl-od-head"><span>배열 순서</span>
              <span><button type="button" className="cl-od-ico" title="되돌리기" aria-label="되돌리기" disabled={!hist.length} onClick={() => { setCells(hist[hist.length - 1]); setHist((h) => h.slice(0, -1)); }}>↶</button>
                <button type="button" className="cl-od-ico" title="비우기" aria-label="비우기" onClick={() => { setHist((h) => [...h, cells]); setCells(cells.map(() => null)); }}>⌫</button></span>
            </div>
            <div className="cl-od-grid" style={{ gridTemplateColumns: `repeat(${Cc}, ${cw}px)`, gridAutoRows: `${chh}px` }}>
              {Array.from({ length: R * Cc }, (_, i) => {
                const fi = cells[i];
                return (
                  <button type="button" key={i} className="cl-od-cell" aria-label={`${Math.floor(i / Cc) + 1}행 ${(i % Cc) + 1}열`}
                    onClick={() => { if (pick != null) put(i, pick); else if (fi != null) put(i, null); }}
                    onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const n = Number(e.dataTransfer.getData('text/plain')); if (!Number.isNaN(n)) put(i, n); }}>
                    {fi != null && faces[fi] && <img src={faces[fi].src} alt="" />}
                  </button>
                );
              })}
            </div>
            <p className="cl-muted cl-od-tip">오른쪽 소재를 끌어 위 칸에 놓으세요 (소재를 누른 뒤 칸을 눌러도 됩니다){warn && <b className="cl-up-err"> — {warn}</b>}</p>
          </div>
          <ul className="cl-od-faces">
            {faces.map((f, i) => (
              <li key={f.uid}><button type="button" className={pick === i ? 'on' : ''} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))} onClick={() => setPick(pick === i ? null : i)}>
                <img src={f.src} alt="" /><span>{f.name}</span></button></li>
            ))}
          </ul>
        </div>
        <div className="modal-actions cl-od-foot">
          <button className="btn-ghost" disabled title="쿠지알러 도움말 문서 — HP3 에는 없음">도움말 보기</button>
          <span><button className="btn-ghost" onClick={onCancel}>취소</button><button className="btn-primary" onClick={save}>저장</button></span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 재질 인용 (选择材质) ───────────────────────── */

const REF_PAGE = 20;

function RefDialog({ items, tree, onCancel, onOk }: { items: Item[]; tree: Folder[]; onCancel: () => void; onOk: (picked: Item[]) => void }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows: { f: Folder; depth: number }[] = [];
  walkFolders(tree, (f, path) => rows.push({ f, depth: path.length }));
  const scope = folder ? new Set([folder, ...(findIn(tree, folder)?.ids ?? [])]) : null;
  const ql = q.trim().toLowerCase();
  const list = items.filter((i) => (!scope || scope.has(i.folder)) && (!ql || i.name.toLowerCase().includes(ql)));
  const pages = Math.max(1, Math.ceil(list.length / REF_PAGE));
  const cur = Math.min(page, pages);
  const shown = list.slice((cur - 1) * REF_PAGE, cur * REF_PAGE);
  const allOn = shown.length > 0 && shown.every((i) => sel.has(i.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const fname = folder ? rows.find((r) => r.f.id === folder)?.f.name : '재질 라이브러리';
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal cl-modal xl cl-rf" role="dialog" aria-modal="true" aria-label="재질 선택" onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head"><h2 className="modal-title">재질 선택</h2><button className="cl-x" aria-label="닫기" onClick={onCancel}>×</button></div>
        <div className="cl-rf-body">
          <ul className="cl-rf-tree">
            <li><button className={folder == null ? 'on' : ''} onClick={() => { setFolder(null); setPage(1); }}>▾ 📁 재질 라이브러리</button></li>
            {rows.map(({ f, depth }) => <li key={f.id}><button className={folder === f.id ? 'on' : ''} style={{ paddingLeft: 14 + depth * 14 }} onClick={() => { setFolder(f.id); setPage(1); }}>📁 {f.name}</button></li>)}
          </ul>
          <div className="cl-rf-main">
            <div className="cl-rf-bar"><b>{fname}</b>
              <label className="cl-tl-check"><input type="checkbox" checked={allOn} onChange={() => setSel((s) => { const n = new Set(s); shown.forEach((i) => (allOn ? n.delete(i.id) : n.add(i.id))); return n; })} />이 쪽 전체 선택</label>
              <label className="search inset cl-rf-q"><input type="search" placeholder="재질 이름" aria-label="재질 이름" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
            </div>
            <ul className="cl-rf-grid">
              {shown.map((i) => (
                <li key={i.id}><button className={sel.has(i.id) ? 'on' : ''} aria-pressed={sel.has(i.id)} onClick={() => toggle(i.id)}>
                  {i.img ? <img src={i.img} alt="" loading="lazy" /> : <span className="cl-mp-noimg" />}<span>{i.name}</span>{sel.has(i.id) && <i className="cl-mp-check" aria-hidden="true">✓</i>}</button></li>
              ))}
              {!shown.length && <li className="cl-muted">재질이 없습니다</li>}
            </ul>
            {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
          </div>
        </div>
        <div className="modal-actions"><span className="cl-muted">{sel.size}개 선택</span><button className="btn-ghost" onClick={onCancel}>취소</button><button className="btn-primary" disabled={!sel.size} onClick={() => onOk(items.filter((i) => sel.has(i.id)))}>확인</button></div>
      </div>
    </div>
  );
}

function findIn(tree: Folder[], id: string): { ids: Set<string> } | null {
  let out: { ids: Set<string> } | null = null;
  walkFolders(tree, (f) => { if (f.id === id) { const ids = new Set<string>(); walkFolders(f.children ?? [], (c) => ids.add(c.id)); out = { ids }; } });
  return out;
}

/* ───────────────────────── 파일 읽기 ───────────────────────── */

async function readFace(file: File): Promise<Face> {
  const name = baseName(file.name);
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const id = uid();
  if (!EXTS.includes(ext)) return { uid: id, name, src: '', w: 0, h: 0, err: '지원하지 않는 파일 형식' };
  if (file.size > 5 * MB) return { uid: id, name, src: '', w: 0, h: 0, err: '이미지가 5MB 를 넘습니다' };
  try {
    const src = await readDataUrl(file);
    const im = await loadImage(src);
    if (im.naturalWidth > 5000 || im.naturalHeight > 5000) return { uid: id, name, src: '', w: im.naturalWidth, h: im.naturalHeight, err: '이미지 해상도가 5000*5000 을 넘습니다' };
    return { uid: id, name, src, w: im.naturalWidth, h: im.naturalHeight };
  } catch { return { uid: id, name, src: '', w: 0, h: 0, err: '이 브라우저에서 읽을 수 없는 이미지' }; }
}

/* ───────────────────────── 화면 ───────────────────────── */

type Done = { ok: number; ids: string[] };

export function TilePage({ tab, st, onClose, onCreate, onReveal }: PageProps) {
  const [view, setView] = useState<'single' | 'multi'>('single');
  const tree = st.trees[st.activeLibrary]?.[TILE_LIB] ?? [];
  const matLib = itemsOf(st).filter((i) => !i.deletedAt && i.lib === 39);
  const matTree = st.trees[st.activeLibrary]?.[39] ?? [];
  // 타일 상품 업로드
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [batch, setBatch] = useState<TileForm | null>(null);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<{ mode: 'batch'; first: boolean } | { mode: 'single'; uid: string } | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  // 다면 타일 상품 업로드
  const [faces, setFaces] = useState<Face[]>([]);
  const [multiForm, setMultiForm] = useState<TileForm | null>(null);
  const [multiDrawer, setMultiDrawer] = useState<{ first: boolean } | null>(null);
  const [mq, setMq] = useState('');
  // 공통
  const [progress, setProgress] = useState<{ i: number; n: number; label: string } | null>(null);
  const [alert, setAlert] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const addRef = useRef<HTMLInputElement>(null);

  const readAll = async (files: File[]) => {
    const out: Face[] = [];
    setProgress({ i: 0, n: files.length, label: '업로드 중' });
    for (let i = 0; i < files.length; i++) { out.push(await readFace(files[i])); setProgress({ i: i + 1, n: files.length, label: '업로드 중' }); }
    setProgress(null);
    return out;
  };
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const got = await readAll(files);
    if (view === 'single') {
      const base = batch ?? emptyForm();
      setDrafts((d) => [...d, ...got.map((g) => ({ ...g, form: { ...base, name: g.name } }))]);
      setDrawer({ mode: 'batch', first: !batch });
    } else {
      setFaces((f) => [...f, ...got]);
      if (!multiForm) setMultiDrawer({ first: true });
    }
  };

  const invalid = (view === 'single' ? drafts : faces).filter((d) => d.err).length;
  const total = view === 'single' ? drafts.length : faces.length;
  const pages = Math.max(1, Math.ceil(drafts.length / TILE_PAGE_SIZE));
  const cur = Math.min(page, pages);
  const shown = drafts.slice((cur - 1) * TILE_PAGE_SIZE, cur * TILE_PAGE_SIZE);
  const mshown = faces.filter((f) => !mq.trim() || f.name.toLowerCase().includes(mq.trim().toLowerCase()));

  const tileInfo = (f: TileForm, extra: Partial<TileInfo>): TileInfo => {
    const wave = Number(f.cat[1]) === RENDERCAT.WAVE_LINE;
    const r = f.range;
    return {
      gapColor: f.gapColor, gapWidth: Number(f.gapWidth), paving: wave ? 0 : f.custom ? PAVING.CUSTOM : Number(f.paving),
      angle: Number(f.paving) === PAVING.FISHBONE ? (Number(f.angle) as 45 | 60) : undefined,
      cat: f.cat.map(Number), mat: f.mat.length === 2 ? [f.mat[0], f.mat[1]] : null,
      range: r.on && r.minL && r.maxL && r.minW && r.maxW ? { minL: Number(r.minL), maxL: Number(r.maxL), minW: Number(r.minW), maxW: Number(r.maxW) } : undefined,
      pbr: f.pbr ?? undefined,
      ...extra,
    };
  };
  const matName = (f: TileForm) => matPathName(f.mat);
  const leafName = (f: TileForm) => renderPath(f.cat.map(Number)).at(-1)?.name ?? '';

  const uploadSingle = async () => {
    const valid = drafts.filter((d) => !d.err);
    const bad = valid.filter((d) => Object.keys(formErrors(d.form, { name: true, locked: !!d.ref })).length);
    if (bad.length) { setAlert(`정보를 먼저 채워 주세요 — 빠진 항목이 있는 상품 ${bad.length}개`); setDrawer({ mode: 'single', uid: bad[0].uid }); return; }
    const out: NewItemDraft[] = [];
    for (let i = 0; i < valid.length; i++) {
      const d = valid[i];
      setProgress({ i, n: valid.length, label: '업로드 중' });
      const f = d.form;
      const wave = Number(f.cat[1]) === RENDERCAT.WAVE_LINE;
      const img = await pavingPreview([d.src], { L: Number(f.L), W: Number(f.W), gapColor: f.gapColor, gapWidth: Number(f.gapWidth), paving: wave ? PAVING.STRAIGHT : Number(f.paving), angle: (Number(f.angle) || undefined) as 45 | 60 | undefined }).catch(() => d.src);
      let texture: string | undefined;
      if (d.src.startsWith('data:')) { texture = newId('TEX'); await putAsset(texture, d.src); }
      out.push({
        name: f.name.trim(), lib: TILE_LIB, folder: f.folders[0], extraFolders: f.folders.length > 1 ? f.folders.slice(1) : undefined,
        img, texture, modelSize: `${Number(f.L)}x${Number(f.W)}(mm)`, renderCat: leafName(f), material: d.ref ? d.ref.material : matName(f),
        tile: tileInfo(f, { refId: d.ref?.id }),
      });
    }
    setProgress(null);
    const ids = onCreate(out, `타일 상품 ${out.length}개를 올렸습니다`, { keep: true });
    setDone({ ok: out.length, ids });
  };
  const uploadMulti = async () => {
    const valid = faces.filter((f) => !f.err);
    if (!multiForm) { setMultiDrawer({ first: false }); return; }
    const e = formErrors(multiForm, { name: true });
    if (Object.keys(e).length || !valid.length) { setAlert(valid.length ? '정보를 먼저 채워 주세요' : '유효한 이미지가 없습니다 — ‘저장’ 뒤 이미지 정보를 채워 주세요'); return; }
    setProgress({ i: 0, n: valid.length, label: '업로드 중' });
    const assets: string[] = [];
    for (let i = 0; i < valid.length; i++) { const id = newId('TEX'); await putAsset(id, valid[i].src); assets.push(id); setProgress({ i: i + 1, n: valid.length, label: '업로드 중' }); }
    const f = multiForm;
    const img = await pavingPreview(valid.map((x) => x.src), { L: Number(f.L), W: Number(f.W), gapColor: f.gapColor, gapWidth: Number(f.gapWidth), paving: f.custom ? PAVING.STRAIGHT : Number(f.paving), angle: (Number(f.angle) || undefined) as 45 | 60 | undefined, order: f.custom ? f.order : null }).catch(() => valid[0].src);
    setProgress(null);
    const ids = onCreate([{
      name: f.name.trim(), lib: TILE_LIB, folder: f.folders[0], extraFolders: f.folders.length > 1 ? f.folders.slice(1) : undefined,
      img, texture: assets[0], modelSize: `${Number(f.L)}x${Number(f.W)}(mm)`, renderCat: leafName(f), material: matName(f),
      tile: tileInfo(f, { faces: assets, order: f.custom && f.order ? f.order : undefined }),
    }], `다면 타일 상품 ‘${f.name.trim()}’을(를) 올렸습니다`, { keep: true });
    setDone({ ok: 1, ids });
  };

  const close = () => {
    if (!drafts.length && !faces.length) { onClose(); return; }
    confirm({ title: '업로드 취소', message: '올리지 않은 상품이 있습니다. 업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });
  };
  const singleDraft = drawer?.mode === 'single' ? drafts.find((d) => d.uid === drawer.uid) : undefined;

  return (
    <div className="cl-cp" role="dialog" aria-modal="true" aria-label="타일 상품 업로드">
      <header className="cl-cp-head">
        <nav className="cl-cp-crumb" aria-label="위치"><span>{tab.label}</span><span className="cur">타일 상품</span></nav>
        <div className="cl-cp-tabs cl-tl-tabs" role="tablist">
          <button role="tab" aria-selected={view === 'single'} className={view === 'single' ? 'on' : ''} onClick={() => setView('single')}>타일 상품 업로드</button>
          <button role="tab" aria-selected={view === 'multi'} className={view === 'multi' ? 'on' : ''} onClick={() => setView('multi')}>다면 타일 상품 업로드</button>
        </div>
        <button className="cl-x" aria-label="닫기" onClick={close}>×</button>
      </header>
      <div className="cl-tl">
        <div className="cl-tl-bar">
          <button className="btn-ghost" title={ADD_TIP} onClick={() => addRef.current?.click()}>+ 상품 추가</button>
          <input ref={addRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void addFiles(fs); }} />
          {view === 'single' ? (
            <>
              <button className="btn-ghost" onClick={() => setRefOpen(true)}>+ 재질 인용</button>
              <button className="btn-ghost" disabled={!drafts.length} onClick={() => setDrawer({ mode: 'batch', first: false })}>일괄 수정</button>
              <button className="btn-ghost" disabled={!drafts.length} onClick={() => confirm({ title: '비우기', message: '모든 상품을 비울까요?', confirmLabel: '예, 비우기', onConfirm: () => { setDrafts([]); setBatch(null); setPage(1); } })}>비우기</button>
            </>
          ) : (
            <>
              <button className="btn-ghost" disabled={!faces.length} onClick={() => setMultiDrawer({ first: false })}>소재 속성 편집</button>
              <button className="btn-ghost" disabled={!faces.length} onClick={() => confirm({ title: '비우기', message: '모든 상품을 비울까요?', confirmLabel: '예, 비우기', onConfirm: () => { setFaces([]); setMultiForm(null); } })}>비우기</button>
              <label className="search inset cl-tl-q"><input type="search" placeholder="이미지 이름 입력" aria-label="이미지 이름" value={mq} onChange={(e) => setMq(e.target.value)} /></label>
            </>
          )}
        </div>
        <div className="cl-tl-content">
          {!total ? (
            <div className="cl-tl-empty"><b>상품이 없습니다</b><p>{view === 'single' ? '왼쪽 위 ‘상품 추가’ 또는 ‘재질 인용’을 누르세요' : '왼쪽 위 ‘상품 추가’를 누르세요'}</p></div>
          ) : view === 'single' ? (
            <>
              <ul className="cl-tl-grid">{shown.map((d) => <Thumb key={d.uid} f={d} onClick={() => setDrawer({ mode: 'single', uid: d.uid })}
                onDelete={() => confirm({ title: '삭제', message: '선택한 상품을 삭제할까요?', confirmLabel: '예, 삭제', onConfirm: () => setDrafts((x) => x.filter((y) => y.uid !== d.uid)) })} />)}</ul>
              {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
            </>
          ) : (
            <ul className="cl-tl-grid">{mshown.map((f) => <Thumb key={f.uid} f={f} onClick={() => setMultiDrawer({ first: false })}
              onDelete={() => confirm({ title: '삭제', message: multiForm?.custom ? '선택한 상품을 삭제할까요? 맞춤 배열을 다시 정해야 합니다' : '선택한 상품을 삭제할까요?', confirmLabel: '예, 삭제', onConfirm: () => { setFaces((x) => x.filter((y) => y.uid !== f.uid)); if (multiForm?.custom) setMultiForm({ ...multiForm, custom: false, order: null }); } })} />)}</ul>
          )}
        </div>
        <footer className="cl-tl-foot">
          {invalid > 0 && <span className="cl-tl-invalid">{invalid}개 무효</span>}
          <span>총 {total}개</span>
          <button className="btn-primary" disabled={total - invalid === 0 || !!progress} onClick={() => void (view === 'single' ? uploadSingle() : uploadMulti())}>업로드 확인</button>
        </footer>
      </div>

      {drawer?.mode === 'batch' && (
        <TileDrawer mode="batch" tree={tree} init={batch ?? emptyForm()} firstUpload={drawer.first}
          onCancel={() => setDrawer(null)}
          onDiscard={() => { setDrafts([]); setBatch(null); setDrawer(null); }}
          onSave={(f) => { setBatch(f); setDrafts((ds) => ds.map((d) => (d.ref ? { ...d, form: { ...f, name: d.form.name, L: d.form.L, W: d.form.W, mat: d.form.mat } } : { ...d, form: { ...f, name: d.form.name } }))); setDrawer(null); }} />
      )}
      {drawer?.mode === 'single' && singleDraft && (
        <TileDrawer key={singleDraft.uid} mode="single" tree={tree} init={singleDraft.form} face={singleDraft.err ? undefined : singleDraft} locked={singleDraft.ref ? { material: singleDraft.ref.material } : undefined}
          onCancel={() => setDrawer(null)}
          onSave={(f, img) => { setDrafts((ds) => ds.map((d) => (d.uid === singleDraft.uid ? { ...d, ...(img ?? {}), uid: d.uid, name: f.name, form: f } : d))); setDrawer(null); }} />
      )}
      {multiDrawer && (
        <TileDrawer mode="multi" tree={tree} init={multiForm ?? emptyForm(faces[0]?.name ?? '')} faces={faces} firstUpload={multiDrawer.first && !multiForm}
          onCancel={() => setMultiDrawer(null)}
          onDiscard={() => { setFaces([]); setMultiForm(null); setMultiDrawer(null); }}
          onSave={(f) => { setMultiForm(f); setMultiDrawer(null); }} />
      )}
      {refOpen && (
        <RefDialog items={matLib} tree={matTree} onCancel={() => setRefOpen(false)}
          onOk={(picked) => {
            setDrafts((d) => [...d, ...picked.map((m): Draft => {
              const lw = itemLW(m);
              return { uid: uid(), name: m.name, src: m.img, w: 0, h: 0, err: m.img ? undefined : '이미지 없음', ref: { id: m.id, material: m.material || m.renderCat },
                form: { ...(batch ?? emptyForm()), name: m.name, L: lw ? String(lw[0]) : '', W: lw ? String(lw[1]) : '' } };
            })]);
            setRefOpen(false);
          }} />
      )}
      {progress && (
        <div className="modal-backdrop"><div className="modal cl-tl-progress" role="status">
          <div className="cl-tl-bar2"><span style={{ width: `${progress.n ? (progress.i / progress.n) * 100 : 0}%` }} /></div>
          <p><span>{progress.label}</span><b>{progress.i}/{progress.n}</b></p>
        </div></div>
      )}
      {done && (
        <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-label="업로드 완료">
          <h2 className="modal-title">✓ 업로드 완료</h2>
          <p className="cl-up-alert-msg">상품 {done.ok}개를 올렸습니다</p>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => { const id = done.ids[0]; setDone(null); if (id) onReveal(id); else onClose(); }}>상품 목록 보기</button>
            <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => { setDone(null); if (view === 'single') { setDrafts([]); setBatch(null); setPage(1); } else { setFaces([]); setMultiForm(null); } }}>계속 올리기</button>
          </div>
        </div></div>
      )}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </div>
  );
}

