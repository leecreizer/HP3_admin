import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MATERIAL_RENDER_CAT } from '../../data/contentCreate';
import { fileToThumb, newId, walkFolders, type Folder, type Item } from '../../data/contentLibrary';
import materialCategories from '../../data/materialCategories.json';
import { parseDxfProfile, profileThumb } from '../../data/dxf';
import { putAsset } from '../../data/assetStore';
import { convertFbxToGlb, glbToDataUrl } from '../../data/fbxConvert';
import { glbInfo } from '../../pm/glb';
import { AssetViewer } from '../../components/AssetViewer';
import { FolderPickModal } from './ContentModals';
import { HybridMaterialPage } from './DecoPages';
import { TilePage } from './TilePage';
import { BorderPage } from './BorderPage';
import { TilePatternPage } from './TilePatternPage';
import { WaterjetPage } from './WaterjetPage';
import { SectionDraw } from '../pm/SectionDraw';
import { ShapedTilePage } from './ShapedTilePage';
import type { NewItemDraft, PageProps } from './createTypes';

/**
 * 컨텐츠 제작 카드별 생성 화면 — 쿠지알러에서 각 카드가 여는 화면을 그대로 옮겼다.
 * (화면 구성·업로드 조건은 2026-10-06 쿠지알러 HANSSEM 계정 화면을 보기만 하고 확인한 것. 업로드·만들기는 누르지 않음)
 *
 * 쿠지알러는 업로드 뒤 서버에서 모델 변환·정보 입력 단계로 넘어가지만, 그 단계는 실제로 올려 보지 않아 확인하지 못했다.
 * HP3 는 올린 파일로 바로 상품을 만들고(상품명 = 파일 이름) 상세·빠른 편집에서 정보를 채운다.
 */


type MatGroup = { name: string; zh: string; items: { id: string; name: string; zh: string }[] };
const MATERIAL_GROUPS = materialCategories as MatGroup[];
const MB = 1024 * 1024;
const extOf = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '');

function readDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error('파일을 읽을 수 없습니다')); r.readAsDataURL(f); });
}
function imageSize(f: File): Promise<{ w: number; h: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(f); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`${f.name}: 이미지를 읽을 수 없습니다`)); };
    img.src = url;
  });
}

/* ───────────────────────── 공통 ───────────────────────── */

function Shell({ crumbs, onClose, children, footer, tools }: { crumbs: string[]; onClose: () => void; children: ReactNode; footer?: ReactNode; tools?: ReactNode }) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="cl-cp" role="dialog" aria-modal="true" aria-label={crumbs.join(' › ')}>
      <header className="cl-cp-head">
        <nav className="cl-cp-crumb" aria-label="위치">{crumbs.map((c, i) => <span key={i} className={i === crumbs.length - 1 ? 'cur' : ''}>{c}</span>)}</nav>
        {tools}
        <button className="cl-x" aria-label="닫기" onClick={onClose}>×</button>
      </header>
      <div className="cl-cp-body">{children}</div>
      {footer && <footer className="cl-cp-foot">{footer}</footer>}
    </div>
  );
}

const Sec = ({ title, children }: { title: string; children: ReactNode }) => <section className="cl-cp-sec"><h3>{title}</h3>{children}</section>;

function DropZone({ accept, multiple, onFiles, busy, compact, children }: { accept: string; multiple?: boolean; onFiles: (fs: File[]) => void; busy?: string; compact?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const open = () => { if (!busy) ref.current?.click(); };
  return (
    <div className={`cl-drop${over ? ' over' : ''}${compact ? ' compact' : ''}${busy ? ' busy' : ''}`} role="button" tabIndex={0} aria-label="파일 올리기"
      onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (busy) return; const fs = [...e.dataTransfer.files]; if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1)); }}>
      {busy ? <p className="cl-drop-t">{busy}</p> : children}
      <input ref={ref} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) onFiles(fs); }} />
    </div>
  );
}
const DropText = ({ text, rules }: { text: string; rules: string[] }) => (
  <>
    <p className="cl-drop-t"><b>클릭</b> {text}</p>
    <ul className="cl-drop-rules">{rules.map((r) => <li key={r}>- {r}</li>)}</ul>
  </>
);
const Err = ({ msg }: { msg: string }) => (msg ? <p className="cl-err cl-cp-err" role="alert">{msg}</p> : null);

type ImgFile = { file: File; thumb: string; w: number; h: number };
/** 이미지 일괄 검사 (형식·용량·해상도·개수) */
async function checkImages(fs: File[], have: number, opt: { exts: string[]; maxMb: number; maxPx: number; maxCount: number }) {
  const ok: ImgFile[] = []; const errs: string[] = [];
  for (const f of fs) {
    if (!opt.exts.includes(extOf(f))) { errs.push(`${f.name}: ${opt.exts.join('·')} 형식만 올릴 수 있습니다`); continue; }
    if (f.size > opt.maxMb * MB) { errs.push(`${f.name}: ${opt.maxMb}MB 를 넘습니다`); continue; }
    try {
      const s = await imageSize(f);
      if (s.w > opt.maxPx || s.h > opt.maxPx) { errs.push(`${f.name}: 해상도 ${s.w}×${s.h} — ${opt.maxPx}×${opt.maxPx} 이하만 올릴 수 있습니다`); continue; }
      ok.push({ file: f, thumb: await fileToThumb(f, 240), w: s.w, h: s.h });
    } catch (e) { errs.push((e as Error).message); }
  }
  const room = Math.max(0, opt.maxCount - have);
  if (ok.length > room) errs.push(`한 번에 최대 ${opt.maxCount}장까지 올릴 수 있습니다 — ${ok.length - room}장은 뺐습니다`);
  return { ok: ok.slice(0, room), err: errs.join('\n') };
}

function ImageGrid({ files, onRemove }: { files: ImgFile[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="cl-cp-files">
      {files.map((f, i) => (
        <li key={`${f.file.name}-${i}`}><img src={f.thumb} alt="" /><span title={f.file.name}>{baseName(f.file)}</span><small>{f.w}×{f.h}</small>
          <button className="cl-x" aria-label={`${f.file.name} 빼기`} onClick={() => onRemove(i)}>×</button></li>
      ))}
    </ul>
  );
}

/* ───────────────────────── 재질 텍스처 (材质贴图 · 批量创建) ───────────────────────── */

function MaterialCascader({ value, onChange }: { value: { base: string; name: string } | null; onChange: (v: { base: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="cl-casc" ref={ref}>
      <button className={`inline-input cl-casc-btn${value ? '' : ' ph'}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{value ? `${value.base} / ${value.name}` : '선택하세요'}<span aria-hidden="true">▾</span></button>
      {open && (
        <div className="cl-casc-pop" role="listbox" aria-label="재질 분류">
          <ul>{MATERIAL_GROUPS.map((g, i) => <li key={g.zh}><button className={i === base ? 'on' : ''} title={g.zh} onClick={() => setBase(i)}>{g.name}<em aria-hidden="true">›</em></button></li>)}</ul>
          <ul>{MATERIAL_GROUPS[base].items.map((m) => <li key={m.id}><button title={m.zh} onClick={() => { onChange({ base: MATERIAL_GROUPS[base].name, name: m.name }); setOpen(false); }}>{m.name}</button></li>)}</ul>
        </div>
      )}
    </div>
  );
}

function MaterialPage({ tab, portal, st, onClose, onCreate }: PageProps) {
  const [cat, setCat] = useState<{ base: string; name: string } | null>(null);
  const [files, setFiles] = useState<ImgFile[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState(false);
  const renderCat = MATERIAL_RENDER_CAT[portal.bz ?? ''];
  const add = async (fs: File[]) => {
    setBusy('이미지 확인 중…');
    const r = await checkImages(fs, files.length, { exts: ['jpg', 'jpeg', 'png'], maxMb: 10, maxPx: 10000, maxCount: 100 });
    setFiles((cur) => [...cur, ...r.ok]); setErr(r.err); setBusy('');
  };
  const create = async (folder: string) => {
    setPick(false); setBusy('재질 만드는 중…');
    try {
      const drafts: NewItemDraft[] = [];
      for (const f of files) {
        const texture = newId('TEX');
        await putAsset(texture, await readDataUrl(f.file));
        drafts.push({ name: baseName(f.file), lib: portal.lib!, folder, img: f.thumb, texture, renderCat: renderCat ?? '', material: `${cat!.base}/${cat!.name}` });
      }
      onCreate(drafts, `재질 ${drafts.length}개를 만들었습니다`);
    } catch (e) { setErr(`저장하지 못했습니다: ${(e as Error).message}`); setBusy(''); }
  };
  return (
    <Shell crumbs={[tab.label, '재질 텍스처']} onClose={onClose}
      footer={<button className="btn-primary" disabled={!cat || !files.length || !!busy} onClick={() => setPick(true)}>만들기</button>}>
      <div className="cl-cp-tabs" role="tablist">
        <button role="tab" aria-selected="true" className="on">일괄 만들기</button>
        <button role="tab" aria-selected="false" className="cl-cp-tool" disabled title="쿠지알러 별도 도구 — HP3 에는 없음">실시간 재질 제작 도구</button>
      </div>
      <Sec title="재질 설정">
        <div className="cl-cp-row">
          <label className="cl-cp-field"><span>렌더 분류</span><input className="inline-input" disabled value={renderCat ?? '-'} title={renderCat ? '쿠지알러 全屋定制材质 — 고정' : '쿠지알러 화면 미확인'} /></label>
          <div className="cl-cp-field"><span><i className="req">*</i>재질 분류</span><MaterialCascader value={cat} onChange={setCat} /></div>
        </div>
      </Sec>
      <Sec title="폴더 설정">
        <p className="cl-muted cl-cp-note">폴더 설정 방식이 바뀌었습니다: 오른쪽 아래 ‘만들기’를 누른 뒤 폴더를 고를 수 있습니다.</p>
      </Sec>
      <Sec title="텍스처 업로드">
        <ImageGrid files={files} onRemove={(i) => setFiles(files.filter((_, k) => k !== i))} />
        <DropZone accept=".jpg,.jpeg,.png" multiple onFiles={(fs) => void add(fs)} busy={busy} compact={files.length > 0}>
          <DropText text="하거나 파일을 여기로 끌어 텍스처 가져오기" rules={['10MB 이하', '해상도 10000×10000 이하', '한 번에 최대 100장', 'jpg·jpeg·png 형식 지원']} />
        </DropZone>
        <Err msg={err} />
      </Sec>
      {pick && <FolderPickModal title="폴더 선택" tree={st.trees[st.activeLibrary]?.[portal.lib!] ?? []} okLabel="만들기" onClose={() => setPick(false)} onPick={(id) => void create(id)} />}
    </Shell>
  );
}

/* ───────────────────────── 3D 모델 (3D 模型上传 · 上传静态模型) ───────────────────────── */

const MODEL_EXTS = ['skp', 'max', 'rar', 'zip', 'fbx', 'glb', '3dm'];
function Model3dPage({ tab, portal, onClose, onCreate }: PageProps) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const upload = async ([f]: File[]) => {
    setErr('');
    const ext = extOf(f);
    if (!MODEL_EXTS.includes(ext)) { setErr(`${f.name}: .max·.skp·.fbx·.glb·.3dm (·.rar·.zip) 형식만 올릴 수 있습니다`); return; }
    if (f.size > 200 * MB) { setErr(`${f.name}: 200MB 를 넘습니다`); return; }
    if (ext !== 'fbx' && ext !== 'glb') { setErr(`${f.name}: HP3 는 브라우저에서 .fbx·.glb 만 변환합니다 — .${ext} 는 변환 서버가 없어 아직 올릴 수 없습니다`); return; }
    setBusy(ext === 'fbx' ? 'FBX → GLB 변환 중… (용량에 따라 수십 초)' : 'GLB 읽는 중…');
    try {
      let glb: string;
      if (ext === 'fbx') glb = glbToDataUrl((await convertFbxToGlb(await f.arrayBuffer())).glb);
      else glb = await readDataUrl(f);
      setBusy('미리보기·크기 계산 중…');
      const info = await glbInfo(glb);
      const asset = newId('GLB');
      await putAsset(asset, glb);
      onCreate([{ name: baseName(f), lib: portal.lib!, img: info.thumb, modelSize: `${info.size.w} X ${info.size.d} X ${info.size.h} mm`, model3d: { kind: 'glb', asset, file: f.name } }], `‘${baseName(f)}’ 3D 모델을 올렸습니다`);
    } catch (e) { setErr(`${f.name}: 변환하지 못했습니다 — ${(e as Error).message}`); setBusy(''); }
  };
  return (
    <Shell crumbs={[`${tab.label} 소재`, '3D 모델 업로드']} onClose={onClose}>
      <div className="cl-cp-tabs" role="tablist"><button role="tab" aria-selected="true" className="on">정적 모델 업로드</button></div>
      <DropZone accept={MODEL_EXTS.map((e) => `.${e}`).join(',')} onFiles={(fs) => void upload(fs)} busy={busy}>
        <div className="cl-drop-exts" aria-hidden="true">{MODEL_EXTS.map((e) => <span key={e} className={`x-${e}`}>.{e}</span>)}</div>
        <DropText text="하거나 파일을 여기로 끌어 업로드" rules={['파일 하나당 200MB 이하', '.max(2021 이하 버전)·.skp·.fbx·.glb·.3dm 모델 형식 지원, 그 밖의 형식은 모델링 가이드 참고']} />
        <p className="cl-drop-hp3">HP3 는 브라우저에서 <b>.fbx·.glb</b> 만 변환합니다 (.skp·.max·.3dm·.rar·.zip 은 변환 서버가 필요해 아직 올릴 수 없음)</p>
      </DropZone>
      <Err msg={err} />
      <div className="cl-cp-guides">
        <div><b>모델링 가이드</b><p>모델 업로드 모델링 규범 — 모델 취득·형식·재질·크기·파일 용량·면 수·오브젝트·장면 안 물체·텍스처·감마값·모델 방향에 대한 요구 사항과 주의 사항.</p></div>
        <div><b>모델 업로드 가이드</b><p>3D 모델 업로드 절차 — 업로드·분류·편집·제출. 시공 도면을 만들어야 하는 경우 올바른 분류 선택과 특수 요소 처리를 특히 강조합니다.</p></div>
      </div>
    </Shell>
  );
}

/* ───────────────────────── 몰딩 프로파일 (线条轮廓 · DXF) ───────────────────────── */

function ProfilePage({ tab, portal, onClose, onCreate }: PageProps) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [draw, setDraw] = useState(false);
  const upload = async ([f]: File[]) => {
    setErr('');
    if (extOf(f) !== 'dxf') { setErr(`${f.name}: DXF 파일만 올릴 수 있습니다`); return; }
    if (f.size > 5 * MB) { setErr(`${f.name}: 5MB 를 넘습니다`); return; }
    setBusy('DXF 읽는 중…');
    try {
      const profile = parseDxfProfile(await f.text());
      onCreate([{ name: baseName(f), lib: portal.lib!, img: profileThumb(profile), profile, size: `${profile.w} X ${profile.h} mm` }], `‘${baseName(f)}’ 몰딩 프로파일을 올렸습니다 — 단면 ${profile.w} × ${profile.h} mm`);
    } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); setBusy(''); }
  };
  return (
    <Shell crumbs={[tab.label, '몰딩 프로파일']} onClose={onClose}>
      <Sec title="몰딩 프로파일 업로드">
        <DropZone accept=".dxf" onFiles={(fs) => void upload(fs)} busy={busy}>
          <DropText text="하거나 파일을 여기로 끌어 업로드" rules={['파일 하나당 5MB 이하', 'DXF 파일 형식 지원 — 단면을 닫힌 폴리선(또는 이어진 선·호)으로']} />
        </DropZone>
        <Err msg={err} />
      </Sec>
      <Sec title="단면 직접 그리기">
        <div className="cl-sec-draw">
          <p>CAD 도면 없이 단면을 바로 그려 몰딩 프로파일을 만듭니다 — 사각형·걸레받이·모따기 판·L자·계단형·사분원·코브 템플릿에서 시작하거나 점을 찍어 그리고, 둥근 모서리·모따기·원호로 다듬습니다.</p>
          <button className="btn-primary" onClick={() => setDraw(true)}>✎ 단면 그리기</button>
        </div>
      </Sec>
      {draw && <SectionDraw onClose={() => setDraw(false)} onDone={(name, shape) => {
        setDraw(false);
        onCreate([{ name, lib: portal.lib!, img: profileThumb(shape), profile: shape, size: `${shape.w} X ${shape.h} mm` }], `‘${name}’ 단면을 그려 몰딩 프로파일을 만들었습니다 — 단면 ${shape.w} × ${shape.h} mm`);
      }} />}
    </Shell>
  );
}

/* ───────────────────────── 가상 모델 (虚拟模型) ───────────────────────── */

function VirtualModelPage({ tab, portal, onClose, onCreate }: PageProps) {
  const [err, setErr] = useState('');
  const upload = async ([f]: File[]) => {
    setErr('');
    const ext = extOf(f);
    if (!['gif', 'jpeg', 'jpg', 'png', 'svg'].includes(ext)) { setErr(`${f.name}: gif·jpeg·jpg·png·svg 파일만 올릴 수 있습니다`); return; }
    if (f.size > 5 * MB) { setErr(`${f.name}: 5MB 를 넘습니다`); return; }
    try {
      const img = ext === 'svg' || ext === 'gif' ? await readDataUrl(f) : await fileToThumb(f, 240);
      onCreate([{ name: baseName(f), lib: portal.lib!, img }], `‘${baseName(f)}’ 가상 모델을 올렸습니다`);
    } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
  };
  return (
    <Shell crumbs={[tab.label, '가상 모델']} onClose={onClose}>
      <Sec title="가상 모델 업로드">
        <DropZone accept=".gif,.jpeg,.jpg,.png,.svg" onFiles={(fs) => void upload(fs)}>
          <DropText text="하거나 파일을 여기로 끌어 업로드" rules={['파일 하나당 5MB 이하', 'gif·jpeg·jpg·png·svg 파일 지원']} />
        </DropZone>
        <Err msg={err} />
      </Sec>
    </Shell>
  );
}

/* ───────────────────────── 프린트 패턴 (印花图案) ───────────────────────── */

function PatternPage({ tab, portal, onClose, onCreate }: PageProps) {
  const [files, setFiles] = useState<ImgFile[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const add = async (fs: File[]) => {
    setBusy('이미지 확인 중…');
    const r = await checkImages(fs, files.length, { exts: ['jpg', 'jpeg', 'png'], maxMb: 10, maxPx: 5000, maxCount: 100 });
    setFiles((cur) => [...cur, ...r.ok]); setErr(r.err); setBusy('');
  };
  const upload = async () => {
    setBusy('패턴 저장 중…');
    try {
      const drafts: NewItemDraft[] = [];
      for (const f of files) {
        const texture = newId('TEX');
        await putAsset(texture, await readDataUrl(f.file));
        drafts.push({ name: baseName(f.file), lib: portal.lib!, img: f.thumb, texture });
      }
      onCreate(drafts, `패턴 ${drafts.length}개를 올렸습니다`);
    } catch (e) { setErr(`저장하지 못했습니다: ${(e as Error).message}`); setBusy(''); }
  };
  return (
    <Shell crumbs={[tab.label, '프린트 패턴']} onClose={onClose}
      footer={<button className="btn-primary" disabled={!files.length || !!busy} onClick={() => void upload()}>업로드</button>}>
      <Sec title="패턴 업로드">
        <ImageGrid files={files} onRemove={(i) => setFiles(files.filter((_, k) => k !== i))} />
        <DropZone accept=".jpg,.jpeg,.png" multiple onFiles={(fs) => void add(fs)} busy={busy} compact={files.length > 0}>
          <DropText text="하거나 파일을 여기로 끌어 패턴 가져오기" rules={['10MB 이하', '해상도 5000×5000 이하', '한 번에 최대 100장', 'jpg·jpeg·png 형식 지원']} />
        </DropZone>
        <Err msg={err} />
      </Sec>
    </Shell>
  );
}

/* ───────────────────────── 3D 모델 분할 (模型切割工具) ───────────────────────── */

function ModelCuttingPage({ portal, st, onClose }: PageProps) {
  const [choosing, setChoosing] = useState(true);
  const [folder, setFolder] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [product, setProduct] = useState<Item | null>(null);
  const tree: Folder[] = st.trees[st.activeLibrary]?.[portal.lib!] ?? [];
  const items = useMemo(() => (st.activeLibrary === 'main' ? st.items : st.extraItems[st.activeLibrary] ?? []).filter((i) => !i.deletedAt && i.lib === portal.lib), [st, portal.lib]);
  const rows: { f: Folder; depth: number }[] = [];
  walkFolders(tree, (f, path) => rows.push({ f, depth: path.length }));
  const query = q.trim().toLowerCase();
  const list = items.filter((i) => (query ? i.name.toLowerCase().includes(query) : folder != null && i.folder === folder));
  return (
    <Shell crumbs={['모델 분할 도구']} onClose={onClose}
      tools={<div className="cl-cp-tools">
        <button className="btn-ghost" onClick={() => setChoosing(true)}>상품 선택</button>
        <button className="btn-ghost" disabled title="분할 결과의 저장 형식을 쿠지알러에서 확인하지 못해 아직 옮기지 않았습니다">저장</button>
      </div>}>
      <div className="cl-cut">
        <aside><button className="btn-primary" disabled title="분할면 동작·저장 형식은 쿠지알러에서 확인하지 못해 아직 옮기지 않았습니다">분할면 추가</button>
          <p className="cl-muted">쿠지알러 설명: 모델을 작은 모듈로 잘라 파라메트릭 모델링에 씁니다. 화면에서 확인한 것은 ‘상품 선택’(백엔드 › 반제품 라이브러리)까지이고, 분할면·저장 결과는 미확인이라 비워 두었습니다.</p></aside>
        <div className="cl-cut-view">
          {product?.model3d?.asset
            ? <AssetViewer key={product.model3d.asset} asset={{ id: product.model3d.asset, name: `${product.name}.glb`, type: '모델링' }} />
            : <p className="cl-muted">{product ? `‘${product.name}’ — 3D 모델이 없는 상품입니다` : '분할할 상품을 고르세요'}</p>}
        </div>
      </div>
      {choosing && (
        <div className="modal-backdrop" onClick={() => setChoosing(false)}>
          <div className="modal cl-modal xl cl-cut-pick" role="dialog" aria-modal="true" aria-label="상품 선택" onClick={(e) => e.stopPropagation()}>
            <div className="cl-modal-head"><h2 className="modal-title">상품 선택</h2>
              <label className="search inset cl-cut-q"><input type="search" placeholder="키워드 입력" aria-label="키워드 입력" value={q} onChange={(e) => setQ(e.target.value)} /></label>
              <button className="cl-x" aria-label="닫기" onClick={() => setChoosing(false)}>×</button></div>
            <div className="cl-modal-body cl-cut-body">
              <ul className="cl-cut-tree">
                <li className="cl-tree-group">백엔드</li>
                <li><b>반제품 라이브러리</b>
                  <ul>{rows.map(({ f, depth }) => <li key={f.id}><button className={folder === f.id ? 'on' : ''} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => { setFolder(f.id); setQ(''); }}>📁 {f.name}</button></li>)}</ul>
                </li>
              </ul>
              <div className="cl-cut-list">
                {!query && folder == null ? <p className="cl-muted">분류를 선택하세요</p> : (
                  <ul>
                    {list.map((i) => <li key={i.id}><button className={picked === i.id ? 'on' : ''} onClick={() => setPicked(i.id)}>{i.img ? <img src={i.img} alt="" /> : <span className="cl-noimg">없음</span>}<span>{i.name}</span></button></li>)}
                    {!list.length && <li className="cl-muted">상품이 없습니다</li>}
                  </ul>
                )}
              </div>
            </div>
            <div className="modal-actions"><button className="btn-primary" disabled={!picked} onClick={() => { setProduct(items.find((i) => i.id === picked) ?? null); setChoosing(false); }}>확인</button></div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ───────────────────────── 화면 미확인 카드 ───────────────────────── */

function UnverifiedPage({ tab, portal, onClose }: PageProps) {
  return (
    <Shell crumbs={[tab.label, portal.title]} onClose={onClose}>
      <div className="cl-cp-unv">
        <b>{portal.title} <small>{portal.origin}</small></b>
        <p>{portal.desc}</p>
        <p className="cl-muted">이 카드가 여는 쿠지알러 화면(<code>{portal.link}</code>)은 아직 열어 보지 않아 생성 조건을 옮기지 않았습니다.
          화면을 확인한 뒤 같은 방식으로 이식합니다 — 임의의 입력 양식으로 만들지 않습니다.</p>
      </div>
    </Shell>
  );
}

export function CreatePage(props: PageProps) {
  switch (props.portal.kind) {
    case 'material': return <MaterialPage {...props} />;
    case 'model3d': return <Model3dPage {...props} />;
    case 'profile': return <ProfilePage {...props} />;
    case 'virtualModel': return <VirtualModelPage {...props} />;
    case 'pattern': return <PatternPage {...props} />;
    case 'modelCutting': return <ModelCuttingPage {...props} />;
    case 'hybrid': return <HybridMaterialPage {...props} />;
    case 'tile': return <TilePage {...props} />;
    case 'border': return <BorderPage {...props} />;
    case 'tilePattern': return <TilePatternPage {...props} />;
    case 'waterjet': return <WaterjetPage {...props} />;
    case 'shaped': return <ShapedTilePage {...props} />;
    default: return <UnverifiedPage {...props} />;
  }
}
