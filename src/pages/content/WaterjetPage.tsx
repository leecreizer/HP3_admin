import { useRef, useState } from 'react';
import { itemsOf, newId, type Folder, type Item, type MedallionFill } from '../../data/contentLibrary';
import { parseDxfLoops } from '../../data/dxf';
import { putAsset } from '../../data/assetStore';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { MB, itemLW } from './decoUtil';
import { FolderChecks, Pager, Tip, UpAlert } from './decoWidgets';
import { buildRegions, geometryDataUrl, regionD, renderMedallion, sameShape, type Pt, type Region, type WjFill } from './waterjet';

/**
 * 워터젯 패턴 업로드 (쿠지알러 水刀拼花上传) — 2026-10-07 쿠지알러 화면·툴팁·번들로 확인.
 * (그 계정에는 이미 서버에 남은 업로드 작업이 있고, 파일을 올리면 서버에 새 작업이 생겨 남으므로 쿠지알러에서 올려 보지는 않았다)
 * DXF 를 브라우저에서 읽어 닫힌 영역으로 나누고(틈 허용치·최소 간격), ‘재질 편집’에서 영역마다 타일 상품이나 구멍(镂空)을 채운 뒤 올린다.
 * DWG 는 브라우저에서 읽을 수 없어 HP3 는 DXF 만 받는다.
 */

const TILE_LIB = 4;
const MAX_FILES = 10;
const RULES = [
  '1、DXF 형식의 단일 워터젯 도안, 5MB 이하 (쿠지알러는 DWG 도 받지만 HP3 는 브라우저에서 DWG 를 읽지 못합니다)',
  '2、직선·원호·타원호·스플라인만 지원, 그 밖의 선 종류는 아직 지원하지 않음',
  '3、도안 안의 분해된 해치(채우기)는 지워 주세요',
  '4、겹친 선은 지워 주세요',
  '5、닫힌 영역을 이루지 않는 선과 점은 지워집니다',
];

type WjFile = {
  uid: string; name: string; w: number; h: number; loops: Pt[][]; regions: Region[];
  fills: (WjFill | null)[]; edited: boolean; folders: string[]; thumb: string; err?: string;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

/* ───────────────────────── 재질 편집 (水刀材质编辑) ───────────────────────── */

const LIST_PAGE = 20;

function MaterialEditor({ file, items, onCancel, onSave }: { file: WjFile; items: Item[]; onCancel: () => void; onSave: (fills: (WjFill | null)[]) => void }) {
  const [hist, setHist] = useState<{ list: (WjFill | null)[][]; at: number }>({ list: [file.fills], at: 0 });
  const fills = hist.list[hist.at];
  const [chosen, setChosen] = useState<WjFill | null>(null);
  const [smart, setSmart] = useState(false);
  const [brush, setBrush] = useState(false);
  const [selRegion, setSelRegion] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { confirm, confirmDialog } = useConfirm();
  const push = (next: (WjFill | null)[]) => setHist((h) => ({ list: [...h.list.slice(0, h.at + 1), next], at: h.at + 1 }));
  const ql = q.trim().toLowerCase();
  const list = items.filter((i) => !ql || i.name.toLowerCase().includes(ql) || i.code.toLowerCase().includes(ql));
  const pages = Math.max(1, Math.ceil((list.length + 1) / LIST_PAGE));
  const cur = Math.min(page, pages);
  const all: (Item | 'hollow')[] = [...list, 'hollow'];
  const shown = all.slice((cur - 1) * LIST_PAGE, cur * LIST_PAGE);
  const toFill = (i: Item): WjFill => { const lw = itemLW(i) ?? [300, 300]; return { kind: 'item', id: i.id, name: i.name, img: i.img, L: lw[0], W: lw[1], rot: 0 }; };
  const isChosen = (x: Item | 'hollow') => (x === 'hollow' ? chosen?.kind === 'hollow' : chosen?.kind === 'item' && chosen.id === x.id);

  const clickRegion = (ri: number) => {
    if (brush) { const f = fills[ri]; if (f) setChosen(f.kind === 'item' ? { ...f, rot: 0 } : f); setBrush(false); return; }
    if (chosen) {
      const targets = smart ? file.regions.map((r, i) => (sameShape(r, file.regions[ri]) ? i : -1)).filter((i) => i >= 0) : [ri];
      push(fills.map((f, i) => (targets.includes(i) ? chosen : f)));
      setSelRegion(ri);
      return;
    }
    setSelRegion(ri === selRegion ? null : ri);
  };
  const rotate = () => {
    if (selRegion == null) return;
    const f = fills[selRegion];
    if (f?.kind !== 'item') return;
    push(fills.map((x, i) => (i === selRegion ? { ...f, rot: (f.rot + 90) % 360 } : x)));
  };
  const cancel = () => (hist.at === 0 ? onCancel() : confirm({ title: '취소', message: '취소할까요? 취소하면 고친 내용을 저장하지 않습니다', confirmLabel: '예', onConfirm: onCancel }));
  const H = file.h;
  // 채움 패턴 정의 (상품마다 실제 크기 × 회전)
  const pats = new Map<string, WjFill & { kind: 'item' }>();
  fills.forEach((f) => { if (f?.kind === 'item') pats.set(`p-${f.id}-${f.rot}`, f); });
  const sel = selRegion != null ? fills[selRegion] : null;
  return (
    <div className="cl-cp cl-wj-ed" role="dialog" aria-modal="true" aria-label="워터젯 재질 편집">
      <header className="cl-cp-head"><nav className="cl-cp-crumb"><span className="cur">워터젯 재질 편집</span><span>{file.name}</span></nav><button className="cl-x" aria-label="닫기" onClick={cancel}>×</button></header>
      <div className="cl-wj-body">
        <aside className="cl-wj-left">
          <div className="cl-cp-tabs" role="tablist"><button role="tab" aria-selected="true" className="on">기업 라이브러리</button>
            <button role="tab" aria-selected="false" disabled title="쿠지알러 공용 라이브러리 — HP3 에는 없음">공용 라이브러리</button></div>
          <label className="search inset"><input type="search" placeholder="상품 이름 또는 코드 검색" aria-label="상품 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
          <ul className="cl-wj-list">
            {shown.map((x) => (
              <li key={x === 'hollow' ? 'hollow' : x.id}>
                <button type="button" className={isChosen(x) ? 'on' : ''} aria-pressed={isChosen(x)} title={x === 'hollow' ? '구멍 — 이 영역을 뚫어 비웁니다' : x.name}
                  onClick={() => { setBrush(false); setChosen(isChosen(x) ? null : x === 'hollow' ? { kind: 'hollow' } : toFill(x)); }}>
                  {x === 'hollow' ? <span className="cl-wj-hollow" /> : x.img ? <img src={x.img} alt="" loading="lazy" /> : <span className="cl-mp-noimg" />}
                  <span>{x === 'hollow' ? '구멍' : x.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
        </aside>
        <div className="cl-wj-main">
          <div className="cl-wj-bar">
            <button type="button" className="btn-ghost" disabled title="쿠지알러 서버의 자동 디자인 — HP3 에는 없음">원클릭 스마트 디자인 ▾</button>
            <span className="cl-wj-sep" />
            <label className="cl-tl-check"><input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} />스마트 영역 채우기</label><Tip lines={['켜면 형상이 같은 영역을 한꺼번에 채웁니다']} />
            <button type="button" className="cl-wj-tool" disabled={hist.at === 0} onClick={() => setHist((h) => ({ ...h, at: h.at - 1 }))}>↶<small>되돌리기</small></button>
            <button type="button" className="cl-wj-tool" disabled={hist.at >= hist.list.length - 1} onClick={() => setHist((h) => ({ ...h, at: h.at + 1 }))}>↷<small>다시 하기</small></button>
            <button type="button" className="cl-wj-tool" onClick={() => push(file.regions.map(() => null))}>⟲<small>초기화</small></button>
            <span className="cl-wj-sep" />
            <button type="button" className={`cl-wj-tool${brush ? ' on' : ''}`} title="누르면 이미 채운 상품을 집어 옵니다" onClick={() => setBrush((b) => !b)}>🖌<small>재질 브러시</small></button>
            <button type="button" className="cl-wj-tool" disabled={sel?.kind !== 'item'} title="고른 영역의 무늬를 90° 돌립니다" onClick={rotate}>⟳<small>회전</small></button>
          </div>
          <div className={`cl-wj-canvas${brush ? ' brush' : chosen ? ' paint' : ''}`}>
            <svg viewBox={`${-file.w * 0.05} ${-file.h * 0.05} ${file.w * 1.1} ${file.h * 1.1}`} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} role="img" aria-label="워터젯 도안">
              <defs>
                {[...pats].map(([id, f]) => (
                  <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={f.L} height={f.W} patternTransform={`rotate(${f.rot})`}>
                    <image href={f.img} width={f.L} height={f.W} preserveAspectRatio="none" />
                  </pattern>
                ))}
                <pattern id="wj-hollow" patternUnits="userSpaceOnUse" width={Math.max(file.w, file.h) / 40} height={Math.max(file.w, file.h) / 40}>
                  <rect width="100%" height="100%" fill="#fff" /><path d={`M0 0L${Math.max(file.w, file.h) / 40} ${Math.max(file.w, file.h) / 40}`} stroke="#c8ced6" strokeWidth={Math.max(file.w, file.h) / 400} />
                </pattern>
              </defs>
              {file.regions.map((_, i) => i).sort((a, b) => file.regions[a].depth - file.regions[b].depth).map((i) => {
                const f = fills[i];
                const fill = f?.kind === 'item' ? `url(#p-${f.id}-${f.rot})` : f?.kind === 'hollow' ? 'url(#wj-hollow)' : '#eef0f3';
                return (
                  <path key={i} d={regionD(file.loops, file.regions[i], H)} fill={fill} fillRule="evenodd" vectorEffect="non-scaling-stroke"
                    className={`cl-wj-region${hover === i ? ' hover' : ''}${selRegion === i ? ' sel' : ''}`}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => clickRegion(i)}>
                    <title>{f?.kind === 'item' ? f.name : f?.kind === 'hollow' ? '구멍' : '비어 있음'}</title>
                  </path>
                );
              })}
            </svg>
          </div>
          <footer className="cl-wj-foot">
            <label className="cl-wj-zoom">확대 <input type="range" min={0.5} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="확대" /></label>
            <span className="cl-muted">{chosen ? (chosen.kind === 'item' ? `‘${chosen.name}’ 을(를) 채울 영역을 누르세요` : '구멍으로 만들 영역을 누르세요') : brush ? '집어 올 영역을 누르세요' : '왼쪽에서 상품을 고른 뒤 영역을 누르세요'} · 채운 영역 {fills.filter(Boolean).length}/{file.regions.length}</span>
            <span><button className="btn-ghost" onClick={cancel}>취소</button><button className="btn-primary" onClick={() => onSave(fills)}>저장</button></span>
          </footer>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

/* ───────────────────────── 화면 ───────────────────────── */

export function WaterjetPage({ tab, st, onClose, onCreate, onReveal }: PageProps) {
  const tiles = itemsOf(st).filter((i) => !i.deletedAt && i.lib === TILE_LIB && i.renderCat !== '천장판' && !i.medallion && !i.border && !i.tilePattern);
  const tree: Folder[] = st.trees[st.activeLibrary]?.[TILE_LIB] ?? [];
  const [gapTol, setGapTol] = useState('0.5');
  const [minGap, setMinGap] = useState('0.2');
  const [files, setFiles] = useState<WjFile[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<{ ok: number; ids: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const add = async (list: File[]) => {
    const g = Number(gapTol), m = Number(minGap);
    if (!(g >= 0.1 && g <= 2) || !(m >= 0.01 && m <= 1)) { setAlert('틈 허용치와 최소 간격을 올바르게 입력하세요'); return; }
    if (files.length + list.length > MAX_FILES) { setAlert(`추가 파일은 모두 ${MAX_FILES}개를 넘을 수 없습니다. 계속 추가하려면 먼저 업로드를 확인하세요`); return; }
    const bad = list.find((f) => !/\.(dxf|dwg)$/i.test(f.name));
    if (bad) { setAlert('DXF/DWG 형식의 소재를 올리세요'); return; }
    const made: WjFile[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      setBusy(`올리는 중 ${i + 1}/${list.length}`);
      const base: WjFile = { uid: uid(), name: baseName(f.name), w: 0, h: 0, loops: [], regions: [], fills: [], edited: false, folders: [], thumb: '' };
      if (/\.dwg$/i.test(f.name)) { made.push({ ...base, err: 'HP3 는 브라우저에서 DWG 를 읽지 못합니다 — CAD 에서 DXF 로 저장해 올려 주세요' }); continue; }
      if (f.size > 5 * MB) { made.push({ ...base, err: '5MB 를 넘습니다' }); continue; }
      try {
        const r = parseDxfLoops(await f.text(), { gapTol: g, minGap: m });
        const regions = buildRegions(r.loops);
        const fills = regions.map(() => null);
        made.push({ ...base, w: r.w, h: r.h, loops: r.loops, regions, fills, thumb: await renderMedallion(r.loops, regions, fills, r.w, r.h, 240) });
      } catch (e) { made.push({ ...base, err: `업로드 오류 — ${(e as Error).message}` }); }
    }
    setBusy('');
    setFiles((x) => [...x, ...made]);
  };
  const valid = files.filter((f) => !f.err);
  const canUpload = valid.length > 0 && valid.every((f) => f.edited);
  const upload = async () => {
    if (valid.some((f) => !f.name.trim())) { setAlert('정보를 채운 뒤 업로드하세요'); return; }
    setBusy('업로드 중');
    const out = [];
    for (const f of valid) {
      const asset = newId('WJ');
      await putAsset(asset, geometryDataUrl(f.loops));
      const fills: (MedallionFill | null)[] = f.fills.map((x) => (x?.kind === 'item' ? { id: x.id, name: x.name, img: x.img, L: x.L, W: x.W, rot: x.rot } : x?.kind === 'hollow' ? 'hollow' : null));
      out.push({
        name: f.name.trim(), lib: TILE_LIB, folder: f.folders[0], extraFolders: f.folders.length > 1 ? f.folders.slice(1) : undefined,
        img: await renderMedallion(f.loops, f.regions, f.fills, f.w, f.h, 480), renderCat: '워터젯 패턴', modelSize: `${f.w}x${f.h}(mm)`,
        medallion: { asset, w: f.w, h: f.h, regions: f.regions.length, fills },
      });
    }
    setBusy('');
    const ids = onCreate(out, `워터젯 패턴 ${out.length}개를 올렸습니다`, { keep: true });
    setDone({ ok: out.length, ids });
  };
  const close = () => (files.length ? confirm({ title: '업로드 취소', message: '올리지 않은 파일이 있습니다. 업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose }) : onClose());
  const editingFile = files.find((f) => f.uid === editing);

  return (
    <div className="cl-cp" role="dialog" aria-modal="true" aria-label="워터젯 패턴 업로드">
      <header className="cl-cp-head"><nav className="cl-cp-crumb" aria-label="위치"><span>{tab.label}</span><span>타일 상품</span><span className="cur">워터젯 패턴 업로드</span></nav><button className="cl-x" aria-label="닫기" onClick={close}>×</button></header>
      <div className="cl-wj">
        <aside className="cl-wj-side">
          <label className="cl-wj-opt"><span><i className="req">*</i>틈 허용치<Tip lines={['틈 허용치보다 가까운 CAD 선은 이어 붙입니다. 올리기에 실패하면 틈 허용치를 조절해 보세요 (범위 0.1~2)']} /></span><input className="inline-input" value={gapTol} onChange={(e) => setGapTol(e.target.value)} aria-label="틈 허용치 mm" />mm</label>
          <label className="cl-wj-opt"><span><i className="req">*</i>최소 간격<Tip lines={['최소 간격보다 좁은 영역은 점이나 선으로 합쳐집니다 (범위 0.01~1)']} /></span><input className="inline-input" value={minGap} onChange={(e) => setMinGap(e.target.value)} aria-label="최소 간격 mm" />mm</label>
          <div className={`cl-wj-drop${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); }}>
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>+ 파일 추가</button>
            <b>파일을 끌어 놓거나 눌러서 추가</b>
            <ul>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
            <input ref={fileRef} type="file" accept=".dxf,.dwg" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void add(fs); }} />
          </div>
        </aside>
        <section className="cl-wj-right">
          <div className="cl-wj-top">
            <button className="btn-ghost" disabled={!valid.length} onClick={() => setBatch([])}>일괄 수정</button>
            <button className="btn-ghost" disabled={!files.length} onClick={() => confirm({ title: '비우기', message: '모든 파일을 비울까요?', confirmLabel: '예, 비우기', onConfirm: () => setFiles([]) })}>비우기</button>
            <span className="cl-muted">💡 HP3 는 브라우저에서 바로 읽으므로 창을 닫으면 올리던 파일이 사라집니다</span>
            <button className="btn-primary" disabled={!canUpload || !!busy} title={canUpload ? '' : '워터젯 파일의 재질을 편집해야 업로드할 수 있습니다'} onClick={() => void upload()}>업로드 확인</button>
          </div>
          {busy && <p className="cl-wj-busy" role="status">{busy}…</p>}
          {!files.length ? <p className="cl-tl-empty"><b>왼쪽에서 워터젯 파일을 올리세요</b></p> : (
            <ul className="cl-wj-cards">
              {files.map((f) => (
                <li key={f.uid} className={f.err ? 'bad' : ''}>
                  <div className="cl-wj-prev">
                    {f.err ? <span className="cl-tl-bad"><b aria-hidden="true">⊗</b>{f.err}</span> : <img src={f.thumb} alt="" />}
                    {!f.err && !f.edited && <span className="cl-wj-need">재질 편집 대기</span>}
                    {!f.err && <button type="button" className="btn-primary cl-wj-editbtn" onClick={() => setEditing(f.uid)}>재질 편집</button>}
                    <button type="button" className="cl-wj-del" aria-label={`${f.name} 삭제`} onClick={() => setFiles((x) => x.filter((y) => y.uid !== f.uid))}>×</button>
                  </div>
                  <input className="inline-input" placeholder="소재 이름을 입력하세요" maxLength={128} value={f.name} aria-label="소재 이름" onChange={(e) => setFiles((x) => x.map((y) => (y.uid === f.uid ? { ...y, name: e.target.value } : y)))} />
                  {!f.err && <FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={f.folders} onChange={(folders) => setFiles((x) => x.map((y) => (y.uid === f.uid ? { ...y, folders } : y)))} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {editingFile && (
        <MaterialEditor file={editingFile} items={tiles} onCancel={() => setEditing(null)}
          onSave={(fills) => {
            const f = editingFile;
            void renderMedallion(f.loops, f.regions, fills, f.w, f.h, 240).then((thumb) => setFiles((x) => x.map((y) => (y.uid === f.uid ? { ...y, fills, thumb, edited: fills.some(Boolean) } : y))));
            setEditing(null);
          }} />
      )}
      {batch && (
        <div className="modal-backdrop" onClick={() => setBatch(null)}>
          <div className="modal cl-modal" role="dialog" aria-modal="true" aria-label="정보 일괄 수정" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
            <div className="cl-modal-head"><h2 className="modal-title">정보 일괄 수정</h2><button className="cl-x" aria-label="닫기" onClick={() => setBatch(null)}>×</button></div>
            <div className="cl-modal-body"><div className="cl-wj-batch"><span>분류</span><FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={batch} onChange={setBatch} /></div></div>
            <div className="modal-actions"><button className="btn-ghost" onClick={() => setBatch(null)}>취소</button><button className="btn-primary" onClick={() => { const v = batch; setFiles((x) => x.map((y) => (y.err ? y : { ...y, folders: v }))); setBatch(null); }}>확인</button></div>
          </div>
        </div>
      )}
      {done && (
        <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-label="업로드 완료">
          <h2 className="modal-title">✓ 업로드 완료</h2>
          <p className="cl-up-alert-msg">상품 {done.ok}개를 올렸습니다</p>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => { const id = done.ids[0]; setDone(null); if (id) onReveal(id); else onClose(); }}>상품 목록 보기</button>
            <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => { setDone(null); setFiles([]); }}>계속 올리기</button>
          </div>
        </div></div>
      )}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </div>
  );
}
