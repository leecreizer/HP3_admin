import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newId } from '../../../data/contentLibrary';
import { getAsset, putAsset } from '../../../data/assetStore';
import { useConfirm } from '../../../components/confirm';
import { readDataUrl, loadImage } from '../decoUtil';
import { DISPLACE_MODEL, G, GROUP_HELP, MODELS, ballUrl, loadPbrData, type PbrAttr, type PbrData, type PbrGroup, type PbrTemplate, type PbrValue, type Rgb } from './pbrData';
import {
  applyNoEffect, defaultsOf, diffValues, hexToRgb, isNoEffect, isNormalMode, NO_EFFECT, panelRules, rgbToHex, sameValue, textureTabs, valuesFor,
  type FalloffSide, type PbrConfig, type PbrValues, type TexTab,
} from './pbrModel';
import { MAP_OF, loadTexture, type MapKey, type MapSet } from './pbrMaterial';
import { PbrViewport, type LightField, type ViewApi } from './PbrViewport';

/**
 * 실시간 재질 제작 도구 (쿠지알러 实时材质制作工具 · /pub/saas/brandgoods/material/realtime/editor 이식)
 * 2026-10-07 쿠지알러에서 열어 보며 확인(저장·렌더·업로드는 누르지 않음) + 화면 번들·문구 사전(__PUB_LANG__)·재질 스키마.
 *  왼쪽  재질 템플릿 — 분류·검색·재질 공 2열(쪽마다 20개)·쪽 넘김. 고르면 그 템플릿의 속성으로 바뀜(조정한 값이 있으면 확인)
 *  가운데 실시간 미리보기 — 표시 모델 5종(+변위), 바닥 1000*1000mm 격자, 저장, 전체 화면, 빠른 렌더 창
 *  오른쪽 맵 칸(교체·업로드·복원·무이음 이어붙이기) + 재질 매개변수(묶음 하나씩 펼침·? 설명·효과 없애기·매개변수 복원)
 *  위    되돌리기·다시 하기·자원 관리·렌더 / 설정(요철 맵 동기화·맵 해상도·광장·환경광 밝기)·도움말·닫기
 * 쿠지알러 렌더는 서버(V-Ray) 장면 렌더라 HP3 는 실시간 화면을 고해상도로 캡처한다. 상품 이미지를 확산 반사 맵으로 쓰면 그 맵은 잠긴다(쿠지알러와 같음).
 */

export type RmeProps = {
  templateId: string;
  /** 상품 이미지 — 확산 반사 맵으로 잠가 쓴다 */
  diffuse?: string;
  /** 상품 크기 mm — 맵의 실제 크기 */
  size: [number, number];
  init?: PbrConfig | null;
  onCancel: () => void;
  onSave: (cfg: PbrConfig, tpl: PbrTemplate) => void;
};

type Snap = { tpl: string; vals: PbrValues; normal?: string };
type Upload = { id: string; name: string; at: number };

const HIST_KEY = 'hp3-rme-uploads';
const HIST_MAX = 100;
const PAGE = 20;
const MAX_MB = 20, MAX_PX = 5000;

const readUploads = (): Upload[] => { try { return JSON.parse(localStorage.getItem(HIST_KEY) ?? '[]') as Upload[]; } catch { return []; } };
const writeUploads = (u: Upload[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(u.slice(0, HIST_MAX))); } catch { /* 저장 공간 부족 — 목록만 못 남김 */ } };

const fmt = (a: PbrAttr, v: number) => ((a.r?.[1] ?? 100) <= 10 ? v.toFixed(2) : v.toFixed(1));
const stepOf = (a: PbrAttr) => ((a.r?.[1] ?? 100) <= 10 ? 0.01 : 0.1);

/** 미리보기용 맵 출처 — 속성 값(주소·asset:id) 또는 잠긴 상품 이미지 */
function mapSources(t: PbrTemplate, vals: PbrValues, diffuse: string | undefined, normal: string | undefined): Partial<Record<MapKey, { src: string; srgb: boolean }>> {
  const out: Partial<Record<MapKey, { src: string; srgb: boolean }>> = {};
  for (const g of t.groups) for (const a of g.attrs) {
    const m = MAP_OF[a.k];
    if (!m) continue;
    const v = a.k === 'diffuseTex' && diffuse ? diffuse : vals[a.k];
    if (typeof v === 'string' && v) out[m.key] = { src: v, srgb: m.srgb };
  }
  if (isNormalMode(vals) && normal) out.normal = { src: normal, srgb: false };
  return out;
}

/* ───────────────────────── 작은 부품 ───────────────────────── */

function HelpPop({ id }: { id: number }) {
  const h = GROUP_HELP[id];
  if (!h) return null;
  return (
    <span className="cl-rme-help" tabIndex={0} aria-label={`${h.title} 설명`}>?
      <span className="cl-rme-help-pop" role="tooltip"><b>{h.title}</b>{h.lines.map((l, i) => <span key={i}>{l}</span>)}</span>
    </span>
  );
}

function Thumb({ src, alt }: { src: string; alt: string }) {
  const id = src.startsWith('asset:') ? src.slice(6) : null;
  const [asset, setAsset] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void getAsset(id).then((u) => { if (live) setAsset({ id, url: u ?? '' }); });
    return () => { live = false; };
  }, [id]);
  const url = id ? (asset?.id === id ? asset.url : '') : src;
  return url ? <img src={url.startsWith('data:') ? url : ballUrl(url, 240) || url} alt={alt} /> : <span className="cl-rme-noimg" />;
}

function ColorField({ value, onChange, label }: { value: Rgb; onChange: (v: Rgb) => void; label: string }) {
  const can = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pick = async () => {
    type ED = { open: () => Promise<{ sRGBHex: string }> };
    const Ctor = (window as unknown as { EyeDropper: new () => ED }).EyeDropper;
    try { const r = await new Ctor().open(); onChange(hexToRgb(r.sRGBHex)); } catch { /* Esc 로 취소 */ }
  };
  return (
    <span className="cl-rme-color">
      <button type="button" className="cl-rme-eyedrop" disabled={!can} title={can ? '색 추출 — 화면에서 원하는 색을 집습니다 (Esc 로 끝)' : '이 브라우저는 색 추출을 지원하지 않습니다 — 최신 Chrome 을 쓰세요'} aria-label={`${label} 색 추출`} onClick={() => void pick()}>✎</button>
      <input type="color" value={rgbToHex(value)} aria-label={label} onChange={(e) => onChange(hexToRgb(e.target.value))} />
    </span>
  );
}

function FloatField({ a, value, onChange }: { a: PbrAttr; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(fmt(a, value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) { setLastValue(value); setText(fmt(a, value)); }
  const [lo, hi] = a.r ?? [0, 100];
  const commit = () => { const n = parseFloat(text); if (Number.isFinite(n)) onChange(n); else setText(fmt(a, value)); };
  return (
    <div className="cl-rme-float">
      <input type="range" min={lo} max={hi} step={stepOf(a)} value={Math.min(hi, Math.max(lo, value))} aria-label={a.l} title="범위가 부족하면 오른쪽 칸에 숫자를 입력해 보세요"
        onChange={(e) => onChange(Number(e.target.value))} />
      <input className="inline-input" value={text} aria-label={`${a.l} 값`} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </div>
  );
}

/* ───────────────────────── 편집기 ───────────────────────── */

export function RealtimeMaterialEditor({ templateId, diffuse, size, init, onCancel, onSave }: RmeProps) {
  const [data, setData] = useState<PbrData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadPbrData().then(setData, (e: Error) => setErr(e.message)); }, []);
  if (err) return <div className="cl-rme cl-rme-loading" role="dialog" aria-label="실시간 재질 제작 도구"><p>{err}</p><button className="btn-ghost" onClick={onCancel}>닫기</button></div>;
  if (!data) return <div className="cl-rme cl-rme-loading" role="dialog" aria-label="실시간 재질 제작 도구"><p>불러오는 중…</p></div>;
  const tpl = data.templates.find((t) => t.id === (init?.template ?? templateId)) ?? data.templates.find((t) => t.id === templateId) ?? data.templates[0];
  return <Editor data={data} first={tpl} diffuse={diffuse} size={size} init={init} onCancel={onCancel} onSave={onSave} />;
}

function Editor({ data, first, diffuse, size, init, onCancel, onSave }: { data: PbrData; first: PbrTemplate; diffuse?: string; size: [number, number]; init?: PbrConfig | null; onCancel: () => void; onSave: RmeProps['onSave'] }) {
  const { confirm, confirmDialog } = useConfirm();
  const byId = useMemo(() => new Map(data.templates.map((t) => [t.id, t])), [data]);
  const initVals = useMemo(() => valuesFor(first, init?.template === first.id ? init.values : undefined), [first, init]);
  const initNormal = (init?.template === first.id ? (init.values.__normal as string | undefined) : undefined) ?? first.normal;
  const [snap, setSnap] = useState<Snap>({ tpl: first.id, vals: initVals, normal: initNormal });
  const [base] = useState<Snap>({ tpl: first.id, vals: initVals, normal: initNormal });
  const [past, setPast] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const lastKey = useRef<{ k: string; at: number } | null>(null);
  const tpl = byId.get(snap.tpl) ?? first;
  const vals = snap.vals;

  const [model, setModel] = useState<number>(init?.model ?? first.model);
  const [modelMenu, setModelMenu] = useState(false);
  const [group, setGroup] = useState<number | null>(tpl.groups[0]?.id ?? null);
  const [tab, setTab] = useState<string>(() => textureTabs(first)[0]?.key ?? '');
  const [falloff, setFalloff] = useState<Record<number, FalloffSide>>({});
  const [settings, setSettings] = useState({ syncBump: false, res: 1024, light: 'bright' as LightField, envI: 1 });
  const [pop, setPop] = useState<'settings' | 'help' | 'res' | 'replace' | null>(null);
  const [replaceTab, setReplaceTab] = useState<'preset' | 'history'>('preset');
  const [cat, setCat] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  const [render, setRender] = useState<{ open: boolean; img?: string; big?: boolean; folded?: boolean }>({ open: true });
  const [notice, setNotice] = useState('');
  const [guide, setGuide] = useState<number | null>(null);
  const [uploads, setUploads] = useState<Upload[]>(readUploads);
  const [maps, setMaps] = useState<MapSet>({});
  const [busy, setBusy] = useState('');
  const viewApi = useRef<ViewApi | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef(0);

  const toast = (m: string) => { setNotice(m); window.clearTimeout(noticeTimer.current); noticeTimer.current = window.setTimeout(() => setNotice(''), 2600); };
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  /* 값 바꾸기 — 같은 칸을 잇달아 움직이면 되돌리기 한 번으로 묶는다 */
  const commit = useCallback((next: Snap, key?: string) => {
    const now = Date.now();
    const merge = key && lastKey.current && lastKey.current.k === key && now - lastKey.current.at < 800;
    lastKey.current = key ? { k: key, at: now } : null;
    if (!merge) setPast((p) => [...p.slice(-49), snap]);
    setFuture([]);
    setSnap(next);
  }, [snap]);
  const setVal = (k: string, v: PbrValue) => commit({ ...snap, vals: { ...vals, [k]: v } }, k);
  const undo = () => { const prev = past[past.length - 1]; if (!prev) return; setPast(past.slice(0, -1)); setFuture([snap, ...future]); setSnap(prev); lastKey.current = null; };
  const redo = () => { const nx = future[0]; if (!nx) return; setFuture(future.slice(1)); setPast([...past, snap]); setSnap(nx); lastKey.current = null; };

  /* 미리보기 맵 불러오기 — 맵 출처가 바뀔 때만 (슬라이더를 움직일 때는 다시 읽지 않음) */
  const srcKey = useMemo(() => JSON.stringify(mapSources(tpl, vals, diffuse, snap.normal)), [tpl, vals, diffuse, snap.normal]);
  const res = settings.res;
  useEffect(() => {
    let live = true;
    const entries = Object.entries(JSON.parse(srcKey) as Record<string, { src: string; srgb: boolean }>) as [MapKey, { src: string; srgb: boolean }][];
    Promise.all(entries.map(async ([k, m]) => [k, await loadTexture(m.src, m.srgb, res).catch(() => null)] as const)).then((loaded) => {
      if (!live) return;
      const next: MapSet = {};
      for (const [k, tex] of loaded) next[k] = tex;
      setMaps(next);
    });
    return () => { live = false; };
  }, [srcKey, res]);

  const rules = useMemo(() => panelRules(tpl, vals, falloff), [tpl, vals, falloff]);
  const tabs = useMemo(() => textureTabs(tpl), [tpl]);
  const curTab = tabs.find((x) => x.key === tab) ?? tabs[0];
  const changed = snap.tpl !== base.tpl || Object.keys(vals).some((k) => !sameValue(vals[k], base.vals[k])) || snap.normal !== base.normal;
  const changedFromTpl = Object.keys(diffValues(tpl, vals)).filter((k) => !(k === 'diffuseTex' && diffuse)).length > 0 || snap.normal !== tpl.normal;
  const locked = (k: string) => k === 'diffuseTex' && !!diffuse;

  /* 템플릿 바꾸기 — 조정한 값이 있으면 확인 (쿠지알러 切换材质分类将清空…) */
  const switchTemplate = (t: PbrTemplate) => {
    if (t.id === tpl.id) return;
    const go = () => {
      commit({ tpl: t.id, vals: defaultsOf(t), normal: t.normal });
      setGroup(t.groups[0]?.id ?? null);
      setTab(textureTabs(t)[0]?.key ?? '');
      setFalloff({});
      if (t.model !== model && (t.model === -1 || model === -1)) setModel(t.model === -1 ? -1 : 0);
    };
    if (changedFromTpl) confirm({ title: '재질 분류 바꾸기', message: '재질 분류를 바꾸면 지금 조정한 매개변수가 지워집니다. 바꿀까요?', confirmLabel: '바꾸기', onConfirm: go });
    else go();
  };
  const resetParams = () => { commit({ tpl: tpl.id, vals: defaultsOf(tpl), normal: tpl.normal }); toast('템플릿 매개변수로 되돌렸습니다'); };
  const clearEffect = (g: PbrGroup) => commit({ ...snap, vals: applyNoEffect(g, vals) });

  /* 맵 — 업로드·교체·복원 */
  const addUpload = (id: string, name: string) => { const next = [{ id, name, at: Date.now() }, ...uploads.filter((u) => u.id !== id)].slice(0, HIST_MAX); setUploads(next); writeUploads(next); };
  const setMap = (t: TexTab, src: string) => {
    if (t.attr.k === 'newBump' && isNormalMode(vals)) commit({ ...snap, normal: src });
    else commit({ ...snap, vals: { ...vals, [t.attr.k]: src } });
  };
  const onUpload = async (t: TexTab, f: File) => {
    if (!/\.(jpe?g|png)$/i.test(f.name)) { toast('jpg·jpeg·png 이미지를 올리세요'); return; }
    if (f.size > MAX_MB * 1024 * 1024) { toast(`업로드 실패 — 이미지가 ${MAX_MB}M 보다 큽니다`); return; }
    setBusy('맵 올리는 중…');
    try {
      const url = await readDataUrl(f);
      const im = await loadImage(url);
      if (im.naturalWidth > MAX_PX || im.naturalHeight > MAX_PX) { toast(`해상도가 제한을 넘습니다 — ${MAX_PX}*${MAX_PX} 이하로 줄여 주세요`); return; }
      const id = newId('MAP');
      await putAsset(id, url);
      addUpload(id, f.name.replace(/\.[^.]+$/, ''));
      setMap(t, `asset:${id}`);
    } catch { toast('업로드 실패'); } finally { setBusy(''); }
  };
  const tabValue = (t: TexTab): string | undefined => {
    if (locked(t.attr.k)) return diffuse;
    if (t.attr.k === 'newBump' && isNormalMode(vals)) return snap.normal;
    const v = vals[t.attr.k];
    return typeof v === 'string' && v ? v : undefined;
  };
  const tabIsDefault = (t: TexTab) => !locked(t.attr.k) && (t.attr.k === 'newBump' && isNormalMode(vals) ? snap.normal === tpl.normal : sameValue(vals[t.attr.k], t.attr.v));
  const restoreMap = (t: TexTab) => { if (t.attr.k === 'newBump' && isNormalMode(vals)) commit({ ...snap, normal: tpl.normal }); else commit({ ...snap, vals: { ...vals, [t.attr.k]: t.attr.v } }); };
  const presetKey = (t: TexTab) => (t.attr.k === 'newBump' ? (isNormalMode(vals) ? 'normalTex' : 'newBump') : t.attr.k);

  /* 요철 맵 동기화 — 확산 반사 맵을 흑백으로 바꿔 요철 맵으로 (쿠지알러 同步凹凸贴图) */
  const syncBump = async (on: boolean) => {
    setSettings((s) => ({ ...s, syncBump: on }));
    const bumpAttr = tpl.groups.flatMap((g) => g.attrs).find((a) => a.k === 'newBump');
    if (!bumpAttr) { if (on) toast('이 템플릿에는 요철 속성이 없습니다'); return; }
    if (!on) { commit({ ...snap, vals: { ...vals, newBump: bumpAttr.v } }); return; }
    const src = diffuse ?? (typeof vals.diffuseTex === 'string' ? vals.diffuseTex : '');
    if (!src) { toast('확산 반사 맵이 없어 요철 맵을 만들지 못했습니다'); return; }
    setBusy('요철 맵 만드는 중…');
    try {
      const url = src.startsWith('asset:') ? await getAsset(src.slice(6)) : src;
      const im = await loadImage(url ?? '', !url?.startsWith('data:'));
      const w = Math.min(1024, im.naturalWidth), h = Math.round((w / im.naturalWidth) * im.naturalHeight);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      g.drawImage(im, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      for (let i = 0; i < d.data.length; i += 4) { const y = 0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]; d.data[i] = d.data[i + 1] = d.data[i + 2] = y; }
      g.putImageData(d, 0, 0);
      const id = newId('MAP');
      await putAsset(id, c.toDataURL('image/jpeg', 0.9));
      const next: PbrValues = { ...vals, newBump: `asset:${id}` };
      if ('normalBumpOption' in vals) next.normalBumpOption = 0;
      commit({ ...snap, vals: next });
      toast('확산 반사 맵으로 요철 맵을 만들었습니다 — 요철 속성에서 더 조정할 수 있습니다');
    } catch { toast('요철 맵을 만들지 못했습니다'); setSettings((s) => ({ ...s, syncBump: false })); } finally { setBusy(''); }
  };

  /* 저장·닫기 */
  const save = () => {
    if (!changed) { toast('먼저 매개변수를 고친 뒤 저장하세요'); return; }
    const values = diffValues(tpl, vals);
    if (diffuse) delete values.diffuseTex;
    if (snap.normal && snap.normal !== tpl.normal) values.__normal = snap.normal;
    onSave({ template: tpl.id, values, model }, tpl);
  };
  const close = () => {
    if (changed) confirm({ title: '닫기', message: '닫으면 모든 재질 매개변수와 렌더 기록이 지워집니다. 닫을까요?', confirmLabel: '닫기', onConfirm: onCancel });
    else onCancel();
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.cl-rme .confirm-modal, .cl-rme-guide')) return;
      e.stopPropagation();
      if (pop || modelMenu) { setPop(null); setModelMenu(false); return; }
      closeRef.current();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [pop, modelMenu]);

  const doRender = () => {
    const api = viewApi.current;
    if (!api) return;
    setRender({ open: true, img: api.capture(2), folded: false });
  };
  const onApi = useCallback((a: ViewApi) => { viewApi.current = a; }, []);
  const fullscreen = () => { const el = centerRef.current; if (!el) return; if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen?.(); };

  /* 왼쪽 템플릿 목록 */
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.templates.filter((t) => (cat === 'all' || t.cat === cat) && (!ql || t.name.toLowerCase().includes(ql) || t.zh.includes(q.trim())));
  }, [data, cat, q]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = list.slice((cur - 1) * PAGE, cur * PAGE);
  const models = tpl.groups.some((g) => g.id === G.DISPLACE) ? [DISPLACE_MODEL, ...MODELS] : MODELS;
  const curModel = models.find((m) => m.id === model) ?? MODELS[0];

  /* 매개변수 칸 */
  const control = (g: PbrGroup, a: PbrAttr): ReactNode => {
    if (a.t === 'File' || rules.hidden.has(a.k)) return null;
    const v = vals[a.k];
    let ctl: ReactNode = null;
    if (a.t === 'Option' && a.o) {
      ctl = (
        <span className="cl-rme-radios" role="radiogroup" aria-label={`${g.name} ${a.l}`}>
          {a.o.map(([name, , val]) => <label key={val}><input type="radio" name={`${tpl.id}-${a.k}`} checked={v === val} onChange={() => setVal(a.k, val)} />{name}</label>)}
        </span>
      );
    } else if (a.t === 'AColor' || a.t === 'Color') {
      ctl = <ColorField value={(Array.isArray(v) ? v : [1, 1, 1]) as Rgb} label={a.l} onChange={(c) => setVal(a.k, c)} />;
    } else if (a.t === 'Float') {
      ctl = <FloatField a={a} value={typeof v === 'number' ? v : Number(a.v)} onChange={(n) => setVal(a.k, n)} />;
    } else if (a.t === 'Switch') {
      ctl = <button type="button" role="switch" aria-checked={v === true} aria-label={a.l} className={`cl-rme-switch${v === true ? ' on' : ''}`} onClick={() => setVal(a.k, v !== true)}><i /></button>;
    }
    const wide = a.t === 'Float';
    return <div key={a.k} className={`cl-rme-row${wide ? ' wide' : ''}`}><span>{a.l}</span>{ctl}</div>;
  };

  const tabOff = (t: TexTab) => rules.offTex.has(t.attr.k);
  return (
    <div className="cl-rme" role="dialog" aria-modal="true" aria-label="실시간 재질 제작 도구">
      <header className="cl-rme-head">
        <h2>실시간 재질 제작 도구</h2>
        <nav className="cl-rme-tools" aria-label="도구">
          <button type="button" disabled={!past.length} onClick={undo}><i aria-hidden="true">↶</i>되돌리기</button>
          <button type="button" disabled={!future.length} onClick={redo}><i aria-hidden="true">↷</i>다시 하기</button>
          <button type="button" className={pop === 'res' ? 'on' : ''} onClick={() => setPop(pop === 'res' ? null : 'res')}><i aria-hidden="true">▤</i>자원 관리</button>
          <button type="button" title="실시간 화면을 고해상도로 캡처합니다 (쿠지알러는 서버 렌더)" onClick={doRender}><i aria-hidden="true">◉</i>렌더</button>
        </nav>
        <div className="cl-rme-right">
          <button type="button" className={pop === 'settings' ? 'on' : ''} onClick={() => setPop(pop === 'settings' ? null : 'settings')}><i aria-hidden="true">⚙</i>설정</button>
          <button type="button" className={pop === 'help' ? 'on' : ''} onClick={() => setPop(pop === 'help' ? null : 'help')}><i aria-hidden="true">?</i>도움말</button>
          <button type="button" className="cl-x" aria-label="닫기" onClick={close}>×</button>
        </div>
        {pop === 'settings' && (
          <div className="cl-rme-pop cl-rme-settings" role="dialog" aria-label="설정">
            <div className="cl-rme-row"><span>요철 맵 동기화 <span className="cl-tip" tabIndex={0}>?<span className="cl-tip-pop"><span>켜면 확산 반사 맵으로 요철 맵을 자동으로 만듭니다. 요철 속성에서 효과를 더 조정할 수 있습니다</span></span></span></span>
              <button type="button" role="switch" aria-checked={settings.syncBump} aria-label="요철 맵 동기화" className={`cl-rme-switch${settings.syncBump ? ' on' : ''}`} onClick={() => void syncBump(!settings.syncBump)}><i /></button></div>
            <div className="cl-rme-row"><span>맵 해상도 <span className="cl-tip" tabIndex={0}>?<span className="cl-tip-pop"><span>고해상도 맵은 실시간 효과가 더 선명하고, 저해상도 맵은 도구가 더 매끄럽습니다</span></span></span></span>
              <select className="inline-input" aria-label="맵 해상도" value={settings.res} onChange={(e) => setSettings((s) => ({ ...s, res: Number(e.target.value) }))}><option value={1024}>1024</option><option value={2048}>2048</option></select></div>
            <div className="cl-rme-row"><span>광장</span>
              <select className="inline-input" aria-label="광장" value={settings.light} onChange={(e) => setSettings((s) => ({ ...s, light: e.target.value as LightField }))}><option value="bright">밝은 광장</option><option value="dark">어두운 광장</option></select></div>
            <div className="cl-rme-row wide"><span>환경광 밝기</span>
              <FloatField a={{ k: 'envI', t: 'Float', l: '환경광 밝기', v: 1, r: [0, 3] }} value={settings.envI} onChange={(n) => setSettings((s) => ({ ...s, envI: Math.max(0, n) }))} /></div>
          </div>
        )}
        {pop === 'help' && (
          <div className="cl-rme-pop cl-rme-helpmenu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setPop(null); setGuide(0); }}>새 사용자 안내</button>
          </div>
        )}
        {pop === 'res' && (
          <div className="cl-rme-pop cl-rme-res" role="dialog" aria-label="자원 관리">
            <header><b>자원 관리</b><span className="cl-tip" tabIndex={0}>?<span className="cl-tip-pop"><span>이 도구에서 올린 맵이 여기에 모입니다. 맵을 맵 칸으로 끌어 놓으면 지금 맵을 바로 바꿉니다</span></span></span>
              <button type="button" className="btn-ghost" disabled={!uploads.length} onClick={() => confirm({ title: '한 번에 정리', message: '정리할까요? 정리하면 목록의 모든 이미지가 사라집니다 (이미 상품에 쓴 맵은 남습니다)', confirmLabel: '정리', onConfirm: () => { setUploads([]); writeUploads([]); } })}>한 번에 정리</button>
              <button type="button" className="cl-x" aria-label="닫기" onClick={() => setPop(null)}>×</button></header>
            {uploads.length >= HIST_MAX && <p className="cl-rme-warn">자원 관리 맵이 한도({HIST_MAX}장)에 이르렀습니다. 정리해 주세요</p>}
            {uploads.length ? (
              <ul className="cl-rme-reslist">
                {uploads.map((u) => (
                  <li key={u.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/hp3-map', `asset:${u.id}`)} title={u.name}>
                    <Thumb src={`asset:${u.id}`} alt="" /><span>{u.name}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="cl-muted cl-rme-empty">아직 맵이 없습니다 — 이 도구에서 올린 맵이 여기에 나옵니다</p>}
          </div>
        )}
      </header>

      <div className={`cl-rme-body${collapsed ? ' collapsed' : ''}`}>
        <aside className="cl-rme-left" aria-label="재질 템플릿">
          <div className="cl-rme-cats">
            <div className="cl-rme-cattab"><b aria-hidden="true">✚</b>재질 템플릿</div>
            <ul>
              <li><button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => { setCat('all'); setPage(1); }}>전체</button></li>
              {data.cats.map((c) => <li key={c.v}><button type="button" className={cat === c.v ? 'on' : ''} title={c.zh} onClick={() => { setCat(c.v); setPage(1); }}>{c.name}</button></li>)}
            </ul>
          </div>
          <div className="cl-rme-tpls">
            <label className="search inset"><input type="search" placeholder="재질 검색" aria-label="재질 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
            {shown.length ? (
              <ul className="cl-rme-grid">
                {shown.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={t.id === tpl.id ? 'on' : ''} title={`${t.name} (${t.zh})`} onClick={() => switchTemplate(t)}>
                      <img src={ballUrl(t.ball, 144)} alt="" loading="lazy" /><span>{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="cl-muted cl-rme-empty">재질을 찾지 못했습니다</p>}
            <nav className="cl-rme-pager" aria-label="쪽 넘김">
              <button type="button" disabled={cur <= 1} aria-label="이전 쪽" onClick={() => setPage(cur - 1)}>‹</button>
              <input className="inline-input" value={cur} aria-label="쪽" onChange={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= pages) setPage(n); }} />
              <span>/ {pages}</span>
              <button type="button" disabled={cur >= pages} aria-label="다음 쪽" onClick={() => setPage(cur + 1)}>›</button>
            </nav>
          </div>
          <button type="button" className="cl-rme-fold" aria-label={collapsed ? '재질 템플릿 펼치기' : '재질 템플릿 접기'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? '›' : '‹'}</button>
        </aside>

        <main className="cl-rme-center" ref={centerRef}>
          <PbrViewport tpl={tpl} vals={vals} maps={maps} model={model} size={size} light={settings.light} envI={settings.envI} onApi={onApi} />
          {render.open && (
            <section className={`cl-rme-render${render.folded ? ' folded' : ''}`} aria-label="빠른 렌더">
              <header>
                <span aria-hidden="true">⠿</span>
                <button type="button" disabled={!render.img} aria-label="크게 보기" title="크게 보기" onClick={() => setRender((r) => ({ ...r, big: true }))}>⤢</button>
                <a className={render.img ? '' : 'off'} href={render.img} download={`${tpl.name}-렌더.png`} aria-label="렌더 이미지 내려받기" title="내려받기" onClick={(e) => { if (!render.img) e.preventDefault(); }}>⤓</a>
                <button type="button" aria-label={render.folded ? '펼치기' : '접기'} title={render.folded ? '펼치기' : '접기'} onClick={() => setRender((r) => ({ ...r, folded: !r.folded }))}>{render.folded ? '▢' : '–'}</button>
                <button type="button" aria-label="렌더 창 닫기" title="닫기" onClick={() => setRender({ open: false })}>×</button>
              </header>
              {!render.folded && (
                <div className="cl-rme-render-body">
                  {render.img ? <img src={render.img} alt="렌더 결과" /> : <span className="cl-rme-render-ph" aria-hidden="true">◍</span>}
                  <button type="button" className="cl-rme-render-go" title="실시간 화면을 고해상도로 캡처합니다 (쿠지알러는 서버 렌더)" onClick={doRender}>⟳ 빠른 렌더</button>
                </div>
              )}
            </section>
          )}
          {render.big && render.img && (
            <div className="cl-rme-big" role="dialog" aria-label="렌더 크게 보기" onClick={() => setRender((r) => ({ ...r, big: false }))}><img src={render.img} alt="렌더 결과" /></div>
          )}
          <div className="cl-rme-model">
            <button type="button" aria-haspopup="listbox" aria-expanded={modelMenu} onClick={() => setModelMenu((m) => !m)}><i aria-hidden="true">{curModel.icon}</i>{curModel.name}<em aria-hidden="true">{modelMenu ? '▾' : '▴'}</em></button>
            {modelMenu && (
              <ul role="listbox" aria-label="표시 모델">
                {models.map((m) => <li key={m.id}><button type="button" role="option" aria-selected={m.id === model} className={m.id === model ? 'on' : ''} onClick={() => { setModel(m.id); setModelMenu(false); }}><i aria-hidden="true">{m.icon}</i>{m.name}</button></li>)}
              </ul>
            )}
          </div>
          <button type="button" className="cl-rme-save btn-ghost" onClick={save}><i aria-hidden="true">💾</i> 저장</button>
          <button type="button" className="cl-rme-full" aria-label="전체 화면" title="전체 화면" onClick={fullscreen}>⛶</button>
          {busy && <p className="cl-rme-busy" role="status">{busy}</p>}
          {notice && <p className="cl-rme-notice" role="status">{notice}</p>}
        </main>

        <aside className="cl-rme-panel" aria-label="재질 매개변수">
          <div className="cl-rme-maps">
            <h3>{tpl.name} - 재질 템플릿</h3>
            {tabs.length > 0 && curTab && (
              <>
                <div className="cl-rme-tabs" role="tablist">
                  {tabs.map((t) => <button type="button" role="tab" key={t.key} aria-selected={t.key === curTab.key} className={t.key === curTab.key ? 'on' : ''} onClick={() => { setTab(t.key); setPop(pop === 'replace' ? null : pop); }}>{t.label}</button>)}
                </div>
                <div className="cl-rme-mapbox">
                  <div className="cl-rme-mapimg" onDragOver={(e) => { if (!locked(curTab.attr.k)) e.preventDefault(); }}
                    onDrop={(e) => { const src = e.dataTransfer.getData('text/hp3-map'); if (src && !locked(curTab.attr.k)) { e.preventDefault(); setMap(curTab, src); } else { const f = e.dataTransfer.files?.[0]; if (f && !locked(curTab.attr.k)) { e.preventDefault(); void onUpload(curTab, f); } } }}>
                    {tabValue(curTab) ? <Thumb src={tabValue(curTab)!} alt={`${curTab.label} 맵`} /> : <span className="cl-rme-noimg">맵 없음</span>}
                    {tabIsDefault(curTab) && <em className="cl-rme-badge">기본 맵</em>}
                    {tabOff(curTab) && <i className="cl-rme-off" title="이 맵은 지금 효과가 없습니다 (효과가 색·수치)">⊘</i>}
                  </div>
                  <div className="cl-rme-mapbtns">
                    {(data.presets[presetKey(curTab)]?.length ?? 0) > 0 && <button type="button" className="btn-ghost" disabled={locked(curTab.attr.k)} onClick={() => { setReplaceTab('preset'); setPop(pop === 'replace' ? null : 'replace'); }}>⇆ 교체</button>}
                    <button type="button" className="btn-ghost" disabled={locked(curTab.attr.k) || !!busy} onClick={() => fileRef.current?.click()}>⤒ 업로드</button>
                    <button type="button" className="btn-ghost" disabled={locked(curTab.attr.k) || tabIsDefault(curTab)} onClick={() => restoreMap(curTab)}>↺ 복원</button>
                    {curTab.attr.k === 'diffuseTex' && <button type="button" className="btn-ghost" disabled title={locked('diffuseTex') ? '상품 이미지를 확산 반사 맵으로 쓰는 동안은 바꿀 수 없습니다' : '무이음 이어붙이기 도구는 아직 없습니다'}>무이음 이어붙이기</button>}
                    <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onUpload(curTab, f); }} />
                  </div>
                </div>
                {pop === 'replace' && (
                  <div className="cl-rme-pop cl-rme-replace" role="dialog" aria-label="맵 교체">
                    <header><b>맵 교체</b><button type="button" className="cl-x" aria-label="닫기" onClick={() => setPop(null)}>×</button></header>
                    <div className="cl-rme-rtabs" role="tablist">
                      <button type="button" role="tab" aria-selected={replaceTab === 'preset'} className={replaceTab === 'preset' ? 'on' : ''} onClick={() => setReplaceTab('preset')}>시스템 맵</button>
                      <button type="button" role="tab" aria-selected={replaceTab === 'history'} className={replaceTab === 'history' ? 'on' : ''} onClick={() => setReplaceTab('history')}>이전 업로드</button>
                    </div>
                    <ul className="cl-rme-rgrid">
                      {(replaceTab === 'preset' ? (data.presets[presetKey(curTab)] ?? []).map((p) => ({ src: p.img, name: p.name })) : uploads.map((u) => ({ src: `asset:${u.id}`, name: u.name }))).map((p, i) => (
                        <li key={`${p.src}${i}`}><button type="button" title={p.name} onClick={() => { setMap(curTab, p.src); setPop(null); }}><Thumb src={p.src} alt="" /></button></li>
                      ))}
                    </ul>
                    {replaceTab === 'history' && !uploads.length && <p className="cl-muted cl-rme-empty">이전 업로드한 맵이 없습니다</p>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="cl-rme-params">
            <header><b>재질 매개변수</b>{changedFromTpl && <button type="button" className="cl-rme-reset" onClick={resetParams}>↺ 매개변수 복원</button>}</header>
            {tpl.groups.map((g) => {
              const open = group === g.id;
              const rows = g.attrs.map((a) => control(g, a)).filter(Boolean);
              const falloffGroup = g.attrs.some((a) => a.k.includes('TexFalloffColor'));
              return (
                <section key={`${g.id}-${g.name}`} className={`cl-rme-group${open ? ' open' : ''}`}>
                  <div className="cl-rme-ghead">
                    <button type="button" className="cl-rme-gname" aria-expanded={open} onClick={() => setGroup(open ? null : g.id)}>{g.name}</button>
                    {open && <HelpPop id={falloffGroup ? G.FALLOFF : g.id} />}
                    <span className="cl-rme-gtools">
                      {open && NO_EFFECT[g.id] && !isNoEffect(g, vals) && <button type="button" className="cl-rme-noeff" title="효과 없애기" aria-label={`${g.name} 효과 없애기`} onClick={() => clearEffect(g)}>⊠</button>}
                      <button type="button" className="cl-rme-arrow" aria-label={open ? '접기' : '펼치기'} onClick={() => setGroup(open ? null : g.id)}>{open ? '⌃' : '⌄'}</button>
                    </span>
                  </div>
                  {open && (
                    <div className="cl-rme-gbody">
                      {falloffGroup && (
                        <div className="cl-rme-side" role="radiogroup" aria-label="정면·측면">
                          {(['front', 'side'] as const).map((s) => <button type="button" key={s} role="radio" aria-checked={(falloff[g.id] ?? 'front') === s} className={(falloff[g.id] ?? 'front') === s ? 'on' : ''} onClick={() => setFalloff((f) => ({ ...f, [g.id]: s }))}>{s === 'front' ? '정면' : '측면'}</button>)}
                        </div>
                      )}
                      {rows.length ? rows : <p className="cl-muted cl-rme-empty">이 묶음은 맵만 있습니다 — 위 맵 칸에서 바꾸세요</p>}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </aside>
      </div>
      {guide !== null && <Guide step={guide} onStep={setGuide} />}
      {confirmDialog}
    </div>
  );
}

const GUIDE = [
  { area: 'left', title: '【재질 템플릿】 영역', text: '기초 재질을 하나 고르면 바로 만들기를 시작할 수 있습니다' },
  { area: 'panel', title: '【매개변수】 영역', text: '여기서 맵을 올리고 재질 매개변수를 고칩니다' },
  { area: 'center', title: '【실시간 미리보기】 영역', text: '재질 효과의 변화를 실시간으로 미리 봅니다' },
  { area: 'render', title: '【렌더】 기능', text: '눌러서 재질의 렌더 이미지를 얻습니다 (HP3 는 실시간 화면 고해상도 캡처)' },
  { area: 'save', title: '【재질 저장】 기능', text: '눌러서 재질을 저장합니다' },
];

function Guide({ step, onStep }: { step: number; onStep: (s: number | null) => void }) {
  const g = GUIDE[step];
  return (
    <div className={`cl-rme-guide at-${g.area}`} role="dialog" aria-label="새 사용자 안내">
      <div className="cl-rme-guide-card">
        <b>{g.title}</b>
        <p>{g.text}</p>
        <footer><span>{step + 1} / {GUIDE.length}</span>
          {step < GUIDE.length - 1 ? <button type="button" className="btn-primary" onClick={() => onStep(step + 1)}>다음</button> : <button type="button" className="btn-primary" onClick={() => onStep(null)}>완료</button>}
        </footer>
      </div>
    </div>
  );
}
