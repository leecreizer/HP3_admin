import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Folder, Item } from '../../../data/contentLibrary';
import {
  newScheme, PV_CATS, PV_CLIP_DEFAULTS, PV_CLIP_FIELDS, PV_CLIPS, PV_TILE_LIMIT, PV_TYPE_CONFIG, PV_TYPES,
  type PvClipParam, type PvClipType, type PvMachine, type PvNode, type PvParam, type PvParamType, type PvPaving, type PvScheme, type PvSprite, type PvTile,
} from '../../../data/paving';
import { itemLW, subtreeIds } from '../decoUtil';
import { colorOf, countRefs, findNode, inPoly, layoutScheme, num, rot, schemeScope, type Placed, type Scope, type V2 } from './pavingGeom';
import { drawScheme, ensureImage, fitView, nodeScreenBox, renderThumb, toWorld, type ImgCache, type View } from './pavingDraw';
import { CustomShapeEditor, HistoryModal, LabelEditor, MaterialModal, ParamForm, PvInput, PvModal, SaveModal, ShapeDiagram, type PvVersion } from './PavingParts';
import { toSprite, type PavingSave } from './pavingUtil';
import './paving.css';

/**
 * 파라메트릭 편집기 (쿠지알러 参数化编辑器 · 铺法编辑器) — 다중 타일 조합·띠 조합·보더·아트월 방안을 만든다.
 * 2026-10-07 쿠지알러에서 새 방안을 만들어 보며 확인(저장 안 함) — 화면 구성·용어·기본값·모양 정의·포설 규칙은 관찰한 그대로.
 * 쿠지알러는 배치를 서버(calculate)에서 계산하지만 HP3 는 화면에서 계산한다(pavingGeom). 결과는 ‘타일·바닥 › 파라메트릭 방안’ 상품.
 */

/** 소재 이미지 — 편집기끼리 같이 쓰는 캐시 */
const IMG_CACHE: ImgCache = new Map();
const fmt = (v: number) => String(Math.round(v * 10) / 10);
const isNum = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim());
const nid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PAGE = 20;

type Drag =
  | { kind: 'move'; ids: string[]; start: V2; cur: V2; tool: boolean }
  | { kind: 'rotate'; id: string; anchor: V2; base: number; a0: number; cur: number; snap: boolean; tool: true };
type ModalState =
  | { k: 'save'; asNew: boolean }
  | { k: 'history' } | { k: 'help' } | { k: 'exit' } | { k: 'label' }
  | { k: 'param'; init?: PvParam; preset?: { type: PvParamType; value?: string; sprites?: PvSprite[] }; bind?: (s: PvScheme, ref: string) => PvScheme }
  | { k: 'mix'; id: string } | { k: 'replace'; ids: string[] } | { k: 'shape'; id: string }
  | { k: 'confirm'; text: string; ok: () => void } | { k: 'emptyExit'; id: string };

/* ── 순수 변환 ── */
const angOf = (pv: PvPaving, sc: Scope) => num(pv.angle, sc);
function mapTiles(s: PvScheme, ids: string[], f: (t: PvTile, parent: PvPaving | null) => PvTile): PvScheme {
  return {
    ...s, nodes: s.nodes.map((n) => (n.kind === 'tile' ? (ids.includes(n.id) ? f(n, null) : n)
      : n.tiles.some((t) => ids.includes(t.id)) ? { ...n, tiles: n.tiles.map((t) => (ids.includes(t.id) ? f(t, n) : t)) } : n)),
  };
}
const mapPaving = (s: PvScheme, id: string, f: (p: PvPaving) => PvPaving): PvScheme => ({ ...s, nodes: s.nodes.map((n) => (n.kind === 'paving' && n.id === id ? f(n) : n)) });
function moveNodes(s: PvScheme, ids: string[], d: V2, sc: Scope): PvScheme {
  return {
    ...s, nodes: s.nodes.map((n) => {
      if (ids.includes(n.id)) return n.kind === 'tile' ? { ...n, x: fmt(num(n.x, sc) + d[0]), y: fmt(num(n.y, sc) + d[1]) } : { ...n, sx: fmt(num(n.sx, sc) + d[0]), sy: fmt(num(n.sy, sc) + d[1]) };
      if (n.kind === 'paving' && n.tiles.some((t) => ids.includes(t.id))) {
        const l = rot(d, -angOf(n, sc));
        return { ...n, tiles: n.tiles.map((t) => (ids.includes(t.id) ? { ...t, x: fmt(num(t.x, sc) + l[0]), y: fmt(num(t.y, sc) + l[1]) } : t)) };
      }
      return n;
    }),
  };
}
function setAngle(s: PvScheme, id: string, deg: number): PvScheme {
  const a = fmt(((deg % 360) + 360) % 360);
  const hit = findNode(s, id);
  if (!hit) return s;
  return hit.node.kind === 'paving' ? mapPaving(s, id, (p) => ({ ...p, angle: a })) : mapTiles(s, [id], (t) => ({ ...t, angle: a }));
}
/** 노드 원점(월드) — 타일 = 기준점, 포설 방식 = 시작점, 단위 안 타일 = (0,0) 단위에서의 자리 */
function originOf(s: PvScheme, id: string, sc: Scope): V2 | null {
  const hit = findNode(s, id);
  if (!hit) return null;
  if (hit.node.kind === 'paving') return [num(hit.node.sx, sc), num(hit.node.sy, sc)];
  const t = hit.node, p = hit.parent;
  if (!p) return [num(t.x, sc), num(t.y, sc)];
  const l = rot([num(t.x, sc), num(t.y, sc)], angOf(p, sc));
  return [num(p.sx, sc) + l[0], num(p.sy, sc) + l[1]];
}
const angleOf = (s: PvScheme, id: string, sc: Scope) => { const h = findNode(s, id); return h ? num(h.node.angle, sc) : 0; };
function applyDrag(s: PvScheme, d: Drag, sc: Scope): PvScheme {
  if (d.kind === 'move') return moveNodes(s, d.ids, [d.cur[0] - d.start[0], d.cur[1] - d.start[1]], sc);
  let a = d.base + (d.cur - d.a0);
  a = d.snap ? Math.round(a / 15) * 15 : Math.round(a);
  return setAngle(s, d.id, a);
}
/** 이 끌기로 수식(매개변수 연결)이 풀리는 칸이 있나 */
function dragUnbinds(s: PvScheme, d: Drag): boolean {
  const ids = d.kind === 'move' ? d.ids : [d.id];
  return ids.some((id) => {
    const h = findNode(s, id); if (!h) return false;
    if (d.kind === 'rotate') return !isNum(h.node.angle);
    return h.node.kind === 'paving' ? !isNum(h.node.sx) || !isNum(h.node.sy) : !isNum(h.node.x) || !isNum(h.node.y);
  });
}
const cloneTile = (t: PvTile): PvTile => ({ ...t, id: nid('t'), sprites: t.sprites.map((x) => ({ ...x })), machine: t.machine ? { ...t.machine, params: { ...t.machine.params }, polygon: t.machine.polygon?.map(([x, y]) => [x, y] as [number, number]) } : null });
const cloneNode = (n: PvNode): PvNode => (n.kind === 'tile' ? cloneTile(n) : { ...n, id: nid('pv'), name: `${n.name} 복사`, tiles: n.tiles.map(cloneTile), u: { ...n.u }, v: { ...n.v } });

/* ── 버전 기록 (이 브라우저) ── */
const VKEY = (k: string) => `hp3-paving-versions:${k}`;
const BKEY = (k: string) => `hp3-paving-backup:${k}`;
function readVersions(key: string): PvVersion[] {
  try {
    const list = JSON.parse(localStorage.getItem(VKEY(key)) ?? '[]') as PvVersion[];
    const b = JSON.parse(localStorage.getItem(BKEY(key)) ?? 'null') as PvVersion | null;
    return [...(b ? [{ ...b, label: '자동 백업' }] : []), ...list].sort((a, c) => c.at - a.at);
  } catch { return []; }
}
function pushVersion(key: string, scheme: PvScheme) {
  try {
    const list = JSON.parse(localStorage.getItem(VKEY(key)) ?? '[]') as PvVersion[];
    // 표기 미리보기 이미지는 빼고 (브라우저 저장 공간 절약)
    localStorage.setItem(VKEY(key), JSON.stringify([{ at: Date.now(), label: '저장', scheme: { ...scheme, label: undefined } }, ...list].slice(0, 20)));
  } catch { /* 저장 공간이 부족하면 기록만 생략 */ }
}

export function PavingEditor({ init, name: name0, itemId, folder: folder0, tiles, saveTree, onSave, onClose }: {
  init?: PvScheme; name?: string; itemId?: string; folder?: string;
  /** 소재 — 타일 상품 폴더 트리·상품 (기업 라이브러리) */
  tiles: { tree: Folder[]; items: Item[] };
  /** 저장 위치 — 파라메트릭 방안 폴더 트리 */
  saveTree: Folder[];
  /** 저장 — 만든/고친 상품 id */
  onSave: (r: PavingSave) => string | undefined;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PvScheme>(() => (init ? structuredClone(init) : newScheme()));
  const [past, setPast] = useState<PvScheme[]>([]);
  const [future, setFuture] = useState<PvScheme[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedId, setSavedId] = useState(itemId);
  const [name, setName] = useState(name0 ?? '이름 없는 방안');
  const [folder, setFolder] = useState(folder0 ?? '');
  const [sel, setSel] = useState<string[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [left, setLeft] = useState<'param' | 'lib'>('lib');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [menu, setMenu] = useState<'' | 'file' | 'tut'>('');
  const [toast, setToast] = useState('');
  const [imgVer, setImgVer] = useState(0);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState<{ item: Item; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ptr = useRef<{ down?: { x: number; y: number; w: V2; target: string | null; button: number; v: View; moved: boolean }; last: V2 }>({ last: [0, 0] });
  const latest = useRef<{ canvas: { w: number; h: number }; key: (e: KeyboardEvent) => void; backup: () => void }>({ canvas: { w: 10000, h: 10000 }, key: () => {}, backup: () => {} });
  const toastTimer = useRef<number>(0);

  const shown = useMemo(() => (drag ? applyDrag(doc, drag, schemeScope(doc)) : doc), [doc, drag]);
  const L = useMemo(() => layoutScheme(shown), [shown]);
  const sc = L.scope;
  const selV = useMemo(() => sel.filter((id) => findNode(doc, id)), [sel, doc]);
  const editing = editId ? (doc.nodes.find((n) => n.id === editId && n.kind === 'paving') as PvPaving | undefined) : undefined;
  const say = (m: string) => { setToast(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 2600); };

  /* ── 기록 ── */
  const commit = (next: PvScheme) => { setPast((p) => [...p.slice(-99), doc]); setFuture([]); setDoc(next); setDirty(true); };
  const undo = () => { if (!past.length) return; setFuture((f) => [doc, ...f]); setDoc(past[past.length - 1]); setPast((p) => p.slice(0, -1)); setDirty(true); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, doc]); setDoc(future[0]); setFuture((f) => f.slice(1)); setDirty(true); };
  const fx = { scope: sc, params: doc.params, formulas: doc.formulas, onSaveFormula: (f: { name: string; expr: string }) => { commit({ ...doc, formulas: [...doc.formulas, f] }); say(`‘${f.name}’ 수식을 저장했습니다`); } };

  /* ── 캔버스 크기·처음 화면 맞춤 ── */
  useEffect(() => { latest.current.canvas = L.canvas; }, [L.canvas]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
      if (!w || !h) return;
      setSize({ w, h });
      setView((v) => v ?? fitView(latest.current.canvas, w, h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    for (const p of L.placed) if (p.sprite?.img) ensureImage(IMG_CACHE, p.sprite.img, () => setImgVer((v) => v + 1));
  }, [L]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !view || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScheme(g, size.w, size.h, shown, L, view, { images: IMG_CACHE, editId, selIds: selV, grid: true });
  }, [shown, L, view, size, selV, editId, imgVer]);
  // 휠 확대·축소 (passive 아님)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const f = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), px: V2 = [e.clientX - r.left, e.clientY - r.top];
      setView((v) => {
        if (!v) return v;
        const W = r.width, H = r.height, w = toWorld(v, W, H)(px);
        const fit = fitView(latest.current.canvas, W, H).scale;
        const scale = Math.min(5, Math.max(fit / 20, v.scale * Math.exp(-e.deltaY * 0.0015)));
        return { scale, cx: w[0] - (px[0] - W / 2) / scale, cy: w[1] + (px[1] - H / 2) / scale };
      });
    };
    el.addEventListener('wheel', f, { passive: false });
    return () => el.removeEventListener('wheel', f);
  }, []);

  /* ── 선택 대상 ── */
  const hitAt = (w: V2): Placed | null => { for (let k = L.placed.length - 1; k >= 0; k--) if (inPoly(w, L.placed[k].poly)) return L.placed[k]; return null; };
  const targetOf = (p: Placed | null): string | null => {
    if (!p) return null;
    if (editId) return p.node === editId && p.i === 0 && p.j === 0 ? p.tile : null;
    return p.node;
  };
  const worldOf = (clientX: number, clientY: number): V2 | null => {
    const c = canvasRef.current;
    if (!c || !view) return null;
    const r = c.getBoundingClientRect();
    return toWorld(view, size.w, size.h)([clientX - r.left, clientY - r.top]);
  };

  /* ── 편집 동작 ── */
  const finishDrag = (d: Drag) => {
    setDrag(null);
    const next = applyDrag(doc, d, sc);
    if (next === doc) return;
    if (dragUnbinds(doc, d)) setModal({ k: 'confirm', text: '이 작업은 관련 매개변수(수식) 연결을 풉니다. 계속할까요?', ok: () => commit(next) });
    else commit(next);
  };
  const enterEdit = (id: string) => { setEditId(id); setSel([]); };
  const exitEdit = () => {
    if (!editing) { setEditId(null); return; }
    if (!editing.tiles.length) { setModal({ k: 'emptyExit', id: editing.id }); return; }
    setEditId(null); setSel([editing.id]);
  };
  const removeIds = (ids: string[]) => {
    commit({ ...doc, nodes: doc.nodes.filter((n) => !ids.includes(n.id)).map((n) => (n.kind === 'paving' && n.tiles.some((t) => ids.includes(t.id)) ? { ...n, tiles: n.tiles.filter((t) => !ids.includes(t.id)) } : n)) });
    setSel((s) => s.filter((x) => !ids.includes(x)));
  };
  const toPaving = () => {
    if (editId) return;
    const ts = doc.nodes.filter((n): n is PvTile => n.kind === 'tile' && selV.includes(n.id));
    if (!ts.length) { say('포설 방식으로 바꿀 타일을 고르세요'); return; }
    const S: V2 = [num(ts[0].x, sc), num(ts[0].y, sc)];
    const pv: PvPaving = {
      kind: 'paving', id: nid('pv'), name: '이름 없는 포설 방식',
      tiles: ts.map((t) => ({ ...t, x: fmt(num(t.x, sc) - S[0]), y: fmt(num(t.y, sc) - S[1]) })),
      u: { x: '0', y: '0', pos: '1', neg: '0' }, v: { x: '0', y: '0', pos: '1', neg: '0' },
      sx: fmt(S[0]), sy: fmt(S[1]), angle: '0', gap: '0', gapColor: '', cornerCut: '0',
    };
    const at = doc.nodes.findIndex((n) => n.id === ts[0].id);
    const rest = doc.nodes.filter((n) => !ts.some((t) => t.id === n.id));
    commit({ ...doc, nodes: [...rest.slice(0, at), pv, ...rest.slice(at)] });
    setSel([]);
    say('포설 방식으로 바꿨습니다 — U·V 방향 오프셋과 개수로 반복하세요');
  };
  const release = (id: string) => {
    const pv = doc.nodes.find((n) => n.id === id && n.kind === 'paving') as PvPaving | undefined;
    if (!pv) return;
    const S: V2 = [num(pv.sx, sc), num(pv.sy, sc)], a = angOf(pv, sc);
    const out = pv.tiles.map((t) => { const l = rot([num(t.x, sc), num(t.y, sc)], a); return { ...t, x: fmt(S[0] + l[0]), y: fmt(S[1] + l[1]), angle: fmt(num(t.angle, sc) + a) }; });
    const at = doc.nodes.findIndex((n) => n.id === id);
    commit({ ...doc, nodes: [...doc.nodes.slice(0, at), ...out, ...doc.nodes.slice(at + 1)] });
    setSel([]); setEditId(null);
    say('포설 방식을 풀었습니다');
  };
  const copySel = () => {
    if (!selV.length) return;
    const copies = editing ? editing.tiles.filter((t) => selV.includes(t.id)).map(cloneTile) : doc.nodes.filter((n) => selV.includes(n.id)).map(cloneNode);
    const ids = copies.map((n) => n.id);
    commit(editing
      ? mapPaving(doc, editing.id, (p) => ({ ...p, tiles: [...p.tiles, ...(copies as PvTile[])] }))
      : { ...doc, nodes: [...doc.nodes, ...copies] });
    setSel(ids);
    const p = ptr.current.last;
    setDrag({ kind: 'move', ids, start: p, cur: p, tool: true });
    say('복사본이 마우스를 따라갑니다 — 놓을 곳을 누르세요 (Esc 취소)');
  };
  const startMove = () => { if (!selV.length) return; const p = ptr.current.last; setDrag({ kind: 'move', ids: selV, start: p, cur: p, tool: true }); say('마우스를 따라 옮깁니다 — 놓을 곳을 누르세요 (Esc 취소)'); };
  const startRotate = () => {
    if (selV.length !== 1) { say('회전은 개체 하나만 고른 뒤 쓰세요'); return; }
    const id = selV[0], o = originOf(doc, id, sc);
    if (!o) return;
    const p = ptr.current.last, a0 = (Math.atan2(p[1] - o[1], p[0] - o[0]) * 180) / Math.PI;
    setDrag({ kind: 'rotate', id, anchor: o, base: angleOf(doc, id, sc), a0, cur: a0, snap: false, tool: true });
    say('마우스로 돌린 뒤 누르세요 — Shift 15° 단위 (Esc 취소)');
  };
  const replaceSel = () => {
    const ids = selV.filter((id) => findNode(doc, id)?.node.kind === 'tile');
    if (!ids.length) { say('소재를 바꿀 타일을 고르세요'); return; }
    setModal({ k: 'replace', ids });
  };
  const addTileAt = (it: Item, w: V2) => {
    const sp = toSprite(it);
    if (!sp) { say('크기(mm)가 없는 상품은 놓을 수 없습니다'); return; }
    if (L.placed.length >= PV_TILE_LIMIT) { say(`타일 수가 제한(${PV_TILE_LIMIT.toLocaleString()}장)을 넘어 더 놓을 수 없습니다`); return; }
    const t: PvTile = { kind: 'tile', id: nid('t'), sprites: [sp], multi: false, machine: null, x: '0', y: '0', angle: '0' };
    if (editing) {
      const l = rot([w[0] - num(editing.sx, sc), w[1] - num(editing.sy, sc)], -angOf(editing, sc));
      commit(mapPaving(doc, editing.id, (p) => ({ ...p, tiles: [...p.tiles, { ...t, x: fmt(l[0] - sp.w / 2), y: fmt(l[1] - sp.h / 2) }] })));
    } else commit({ ...doc, nodes: [...doc.nodes, { ...t, x: fmt(w[0] - sp.w / 2), y: fmt(w[1] - sp.h / 2) }] });
    setSel([t.id]);
  };

  /* ── 저장 ── */
  const doSave = async (asNew: boolean, nm: string, fd: string) => {
    const thumb = await renderThumb(doc, IMG_CACHE, 480);
    const id = onSave({ scheme: doc, name: nm, folder: fd, thumb, asNew, id: asNew ? undefined : savedId });
    const key = id ?? savedId ?? 'new';
    pushVersion(key, doc);
    if (id) setSavedId(id);
    setName(nm); setFolder(fd); setDirty(false);
    say(asNew || !savedId ? `‘${nm}’ 방안을 파라메트릭 방안에 넣었습니다 — 컨텐츠 라이브러리 상단 ‘저장’으로 영구 반영` : `‘${nm}’ 방안을 저장했습니다`);
  };
  const save = () => { setMenu(''); if (savedId) void doSave(false, name, folder); else setModal({ k: 'save', asNew: false }); };
  const saveAs = () => { setMenu(''); setModal({ k: 'save', asNew: true }); };
  const exit = () => { if (dirty) setModal({ k: 'exit' }); else onClose(); };

  /* ── 단축키 · 자동 백업 ── */
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (modal || document.querySelector('.pm-modal-bg')) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (ctrl && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); }
    else if (ctrl && k === 'g') { e.preventDefault(); if (e.shiftKey) { const pv = editing ?? (selV.length === 1 ? doc.nodes.find((n) => n.id === selV[0] && n.kind === 'paving') : undefined); if (pv) release(pv.id); } else toPaving(); }
    else if (ctrl && k === 'c') { e.preventDefault(); copySel(); }
    else if (k === 'delete' || k === 'backspace') { if (selV.length) { e.preventDefault(); removeIds(selV); } }
    else if (!ctrl && k === 'm') startMove();
    else if (!ctrl && k === 'r') startRotate();
    else if (!ctrl && k === 'c') replaceSel();
    else if (k === 'escape') { if (drag) setDrag(null); else if (editId) exitEdit(); else setSel([]); }
  };
  useEffect(() => {
    latest.current.key = onKey;
    latest.current.backup = () => {
      if (!dirty) return;
      try { localStorage.setItem(BKEY(savedId ?? 'new'), JSON.stringify({ at: Date.now(), label: '자동 백업', scheme: { ...doc, label: undefined } })); } catch { /* 공간 부족 */ }
    };
  });
  useEffect(() => {
    const f = (e: KeyboardEvent) => latest.current.key(e);
    window.addEventListener('keydown', f);
    const iv = window.setInterval(() => latest.current.backup(), 60_000);
    return () => { window.removeEventListener('keydown', f); window.clearInterval(iv); };
  }, []);

  /* ── 캔버스 포인터 ── */
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const w = worldOf(e.clientX, e.clientY);
    if (!w || !view) return;
    ptr.current.last = w;
    if (drag?.tool) { finishDrag(drag); return; }
    const target = e.button === 0 ? targetOf(hitAt(w)) : null;
    e.currentTarget.setPointerCapture(e.pointerId);
    ptr.current.down = { x: e.clientX, y: e.clientY, w, target, button: e.button, v: view, moved: false };
    if (target) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) setSel((s) => (s.includes(target) ? s.filter((x) => x !== target) : [...s.filter((x) => findNode(doc, x)), target]));
      else if (!selV.includes(target)) setSel([target]);
    }
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const w = worldOf(e.clientX, e.clientY);
    if (!w) return;
    ptr.current.last = w;
    if (drag?.tool) {
      if (drag.kind === 'move') setDrag({ ...drag, cur: w });
      else setDrag({ ...drag, cur: (Math.atan2(w[1] - drag.anchor[1], w[0] - drag.anchor[0]) * 180) / Math.PI, snap: e.shiftKey });
      return;
    }
    const d = ptr.current.down;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    if (d.target && d.button === 0) {
      const ids = selV.includes(d.target) ? selV : [d.target];
      setDrag({ kind: 'move', ids, start: d.w, cur: w, tool: false });
    } else setView({ ...d.v, cx: d.v.cx - (e.clientX - d.x) / d.v.scale, cy: d.v.cy + (e.clientY - d.y) / d.v.scale });
  };
  const onUp = () => {
    const d = ptr.current.down;
    ptr.current.down = undefined;
    if (drag && !drag.tool) { finishDrag(drag); return; }
    if (d && !d.moved && !d.target && d.button === 0) setSel([]);
  };
  const onDbl = (e: RMouseEvent<HTMLCanvasElement>) => {
    const w = worldOf(e.clientX, e.clientY);
    if (!w || editId) return;
    const p = hitAt(w);
    const n = p && doc.nodes.find((x) => x.id === p.node);
    if (n?.kind === 'paving') enterEdit(n.id);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const id = e.dataTransfer.getData('application/x-hp3-item');
    if (!id) return;
    e.preventDefault();
    const it = tiles.items.find((i) => i.id === id), w = worldOf(e.clientX, e.clientY);
    if (it && w) addTileAt(it, w);
  };

  /* ── 기업 라이브러리 ── */
  const catIds = useMemo(() => (cat ? subtreeIds(tiles.tree, cat) : null), [cat, tiles.tree]);
  const libList = useMemo(() => {
    const k = q.trim().toLowerCase();
    return tiles.items.filter((i) => itemLW(i) && (!catIds || catIds.has(i.folder) || (i.extraFolders ?? []).some((f) => catIds.has(f))) && (!k || i.name.toLowerCase().includes(k)));
  }, [tiles.items, catIds, q]);
  const pages = Math.max(1, Math.ceil(libList.length / PAGE));
  const libPage = libList.slice(page * PAGE, page * PAGE + PAGE);

  /* ── 떠 있는 메뉴 ── */
  const one = selV.length === 1 ? findNode(doc, selV[0]) : null;
  const box = view && selV.length ? (() => {
    const bs = selV.map((id) => nodeScreenBox(L, id, !!doc.nodes.find((n) => n.id === id), view, size.w, size.h)).filter((b): b is NonNullable<typeof b> => !!b);
    if (!bs.length) return null;
    return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
  })() : null;
  type MK = 'edit' | 'rel' | 'pv' | 'move' | 'copy' | 'rep' | 'rot' | 'del';
  const MI: Record<MK, { icon: string; tip: string }> = {
    edit: { icon: '✎', tip: '편집' }, rel: { icon: '⊟', tip: '포설 방식 해제(Ctrl+Shift+G)' }, pv: { icon: '▦', tip: '포설 방식으로 변환(Ctrl+G)' },
    move: { icon: '✥', tip: '이동(M)' }, copy: { icon: '⧉', tip: '복사(Ctrl+C)' }, rep: { icon: '⇄', tip: '소재 교체(C)' }, rot: { icon: '⟳', tip: '회전(R)' }, del: { icon: '🗑', tip: '삭제(Del)' },
  };
  // 쿠지알러 메뉴 구성: 단위 안 타일 / 포설 방식 / 타일
  const menuKeys: MK[] = !selV.length || drag ? [] : editId ? ['move', 'rep', 'rot', 'del']
    : one?.node.kind === 'paving' ? ['edit', 'rel', 'move', 'copy', 'rot', 'del']
      : selV.every((id) => doc.nodes.find((n) => n.id === id)?.kind === 'tile') ? ['pv', 'move', 'copy', ...(selV.length === 1 ? (['rep', 'rot'] as MK[]) : []), 'del']
        : ['move', 'copy', 'del'];
  const runMenu = (k: MK) => {
    const pvId = one?.node.kind === 'paving' ? one.node.id : null;
    if (k === 'edit' && pvId) enterEdit(pvId);
    else if (k === 'rel' && pvId) release(pvId);
    else if (k === 'pv') toPaving();
    else if (k === 'move') startMove();
    else if (k === 'copy') copySel();
    else if (k === 'rep') replaceSel();
    else if (k === 'rot') startRotate();
    else if (k === 'del') removeIds(selV);
  };

  /* ── 오른쪽 속성 ── */
  const setTile = (id: string, f: (t: PvTile) => PvTile) => commit(mapTiles(doc, [id], f));
  const setPv = (id: string, f: (p: PvPaving) => PvPaving) => commit(mapPaving(doc, id, f));
  const In = (p: { label: string; value: string; on: (v: string) => void; min?: number; max?: number; count?: boolean; unit?: string }) => (
    <PvInput key={p.label} label={p.label} value={p.value} onCommit={p.on} min={p.min} max={p.max} count={p.count} unit={p.unit} {...fx} />
  );
  /** 칸에서 ‘＋ 매개변수 추가’ — 만든 매개변수를 그 칸에 바로 연결 (bind = 문서 변환) */
  const addParamFor = (preset: { type: PvParamType; value?: string; sprites?: PvSprite[] }, bind: (s: PvScheme, ref: string) => PvScheme) => setModal({ k: 'param', preset, bind });
  const clipMax = (m: PvMachine, k: PvClipParam): number | undefined => {
    const v = (x: PvClipParam, d: number) => num(m.params[x], sc, d);
    if (k === 'arcHigh') return Math.floor((m.type === 'STAR' ? v('size', 120) : v('smallSize', 120)) / Math.sqrt(8) * 100) / 100;
    if (k === 'smallSize') return Math.floor(v('size', 800) / Math.SQRT2 * 100) / 100;
    if (k === 'straightEdge') return (m.type === 'STAR' ? v('size', 120) : v('smallSize', 120)) / 2;
    if (k === 'angle') return 180;
    if (k === 'expansion') return 10;
    return 10000;
  };
  const tilePanel = (t: PvTile, parent: PvPaving | null) => {
    const sp = t.sprites[0];
    const m = t.machine;
    const spriteParams = doc.params.filter((p) => p.type === 'MULTI_SPRITE');
    return (
      <div className="pv-props">
        <h3>소재 속성</h3>
        {sp && <div className="pv-prodcard"><img src={sp.img} alt="" /><div><b>{sp.name}</b><small>크기: {sp.w}*{sp.h}</small>{t.multi && <small>다중 타일 혼합 {t.sprites.length}종</small>}{parent && <small>포설 방식 ‘{parent.name}’ 단위</small>}</div></div>}
        <section><h4>매개변수 연결</h4>
          <select value={t.spriteRef ?? ''} aria-label="매개변수 연결" onChange={(e) => {
            const v = e.target.value;
            if (v === '__new') addParamFor({ type: 'MULTI_SPRITE', sprites: t.sprites }, (s, ref) => mapTiles(s, [t.id], (x) => ({ ...x, spriteRef: ref })));
            else setTile(t.id, (x) => ({ ...x, spriteRef: v || undefined }));
          }}>
            <option value="">미정의</option>
            {spriteParams.map((p) => <option key={p.ref} value={p.ref}>{p.name} ({p.ref})</option>)}
            <option value="__new">＋ 매개변수 추가</option>
          </select>
        </section>
        <section><h4>소재 선택</h4>
          <div className="pv-radios">
            <label><input type="radio" checked={!t.multi} onChange={() => setTile(t.id, (x) => ({ ...x, multi: false, sprites: x.sprites.slice(0, 1) }))} />단일 타일 평붙임</label>
            <label><input type="radio" checked={t.multi} onChange={() => setModal({ k: 'mix', id: t.id })} />다중 타일 혼합</label>
          </div>
          {t.multi && <><ul className="pv-chips">{t.sprites.map((s) => <li key={s.id}><img src={s.img} alt="" />{s.name}<em>비율 {s.weight}</em></li>)}</ul>
            <button className="pv-btn block" onClick={() => setModal({ k: 'mix', id: t.id })}>소재·비율 바꾸기</button></>}
        </section>
        <section><h4>소재 가공</h4>
          <div className="pv-radios">
            <label><input type="radio" checked={!m} onChange={() => setTile(t.id, (x) => ({ ...x, machine: null }))} />아니오</label>
            <label><input type="radio" checked={!!m} onChange={() => setTile(t.id, (x) => ({ ...x, machine: { type: 'RECTANGLE', params: { ...PV_CLIP_DEFAULTS.RECTANGLE }, texX: '0', texY: '0', texRot: '0' } }))} />예</label>
          </div>
          {m && <>
            <label className="pv-field"><span className="pv-field-name">모양</span>
              <select value={m.type} aria-label="모양" onChange={(e) => {
                const ty = e.target.value as PvClipType;
                setTile(t.id, (x) => ({ ...x, machine: { ...m, type: ty, params: { ...PV_CLIP_DEFAULTS[ty] } } }));
                if (ty === 'POLYGON' && !m.polygon) setModal({ k: 'shape', id: t.id });
              }}>{PV_CLIPS.map((c) => <option key={c.v} value={c.v}>{c.name}</option>)}</select>
            </label>
            {m.type === 'POLYGON' && <button className="pv-btn block" onClick={() => setModal({ k: 'shape', id: t.id })}>✎ 외형 편집{m.polygon ? ` (점 ${m.polygon.length}개)` : ''}</button>}
            {PV_CLIP_FIELDS.filter((f) => m.params[f.k] != null).map((f) => In({
              label: f.label(m.type), value: m.params[f.k]!, min: 0, max: clipMax(m, f.k),
              on: (v) => setTile(t.id, (x) => (x.machine ? { ...x, machine: { ...x.machine, params: { ...x.machine.params, [f.k]: v } } } : x)),
            }))}
            <h5>모양 도식</h5>
            <ShapeDiagram machine={m} size={[sp?.w ?? 600, sp?.h ?? 600]} scope={sc} />
            <h5>재질 위치</h5>
            {In({ label: 'X축 오프셋', value: m.texX, on: (v) => setTile(t.id, (x) => (x.machine ? { ...x, machine: { ...x.machine, texX: v } } : x)) })}
            {In({ label: 'Y축 오프셋', value: m.texY, on: (v) => setTile(t.id, (x) => (x.machine ? { ...x, machine: { ...x.machine, texY: v } } : x)) })}
            {In({ label: '재질 각도', value: m.texRot, on: (v) => setTile(t.id, (x) => (x.machine ? { ...x, machine: { ...x.machine, texRot: v } } : x)) })}
          </>}
        </section>
        <section><h4>위치</h4>
          {In({ label: 'X축', value: t.x, on: (v) => setTile(t.id, (x) => ({ ...x, x: v })), unit: 'mm' })}
          {In({ label: 'Y축', value: t.y, on: (v) => setTile(t.id, (x) => ({ ...x, y: v })), unit: 'mm' })}
          {In({ label: '각도', value: t.angle, on: (v) => setTile(t.id, (x) => ({ ...x, angle: v })), unit: '°' })}
        </section>
      </div>
    );
  };
  const pavingPanel = (pv: PvPaving) => {
    const colorParams = doc.params.filter((p) => p.type === 'GAP_MATERIAL'), boolParams = doc.params.filter((p) => p.type === 'BOOL');
    const colorBound = colorParams.some((p) => p.ref === pv.gapColor);
    const dir = (k: 'u' | 'v', title: string) => <>
      <h5>{title}</h5>
      {In({ label: `${title} X축 오프셋`, value: pv[k].x, on: (v) => setPv(pv.id, (p) => ({ ...p, [k]: { ...p[k], x: v } })), unit: 'mm' })}
      {In({ label: `${title} Y축 오프셋`, value: pv[k].y, on: (v) => setPv(pv.id, (p) => ({ ...p, [k]: { ...p[k], y: v } })), unit: 'mm' })}
      {In({ label: `${title} 정방향 개수`, value: pv[k].pos, count: true, min: 0, on: (v) => setPv(pv.id, (p) => ({ ...p, [k]: { ...p[k], pos: v } })) })}
      {In({ label: `${title} 역방향 개수`, value: pv[k].neg, count: true, min: 0, on: (v) => setPv(pv.id, (p) => ({ ...p, [k]: { ...p[k], neg: v } })) })}
    </>;
    return (
      <div className="pv-props">
        <h3>포설 방식 속성</h3>
        <section><h4>포설 방식 설정</h4>{dir('u', 'U 방향')}{dir('v', 'V 방향')}</section>
        <section><h4>시작점</h4>
          {In({ label: '가로 오프셋', value: pv.sx, on: (v) => setPv(pv.id, (p) => ({ ...p, sx: v })), unit: 'mm' })}
          {In({ label: '세로 오프셋', value: pv.sy, on: (v) => setPv(pv.id, (p) => ({ ...p, sy: v })), unit: 'mm' })}
          {In({ label: '각도', value: pv.angle, on: (v) => setPv(pv.id, (p) => ({ ...p, angle: v })), unit: '°' })}
        </section>
        <section><h4>줄눈</h4>
          {In({ label: '줄눈', value: pv.gap, min: 0, on: (v) => setPv(pv.id, (p) => ({ ...p, gap: v })), unit: 'mm' })}
          <label className="pv-field"><span className="pv-field-name">색</span>
            <span className="pv-colorrow">
              <select value={colorBound ? pv.gapColor : ''} aria-label="줄눈 색 매개변수" onChange={(e) => {
                const v = e.target.value;
                if (v === '__new') addParamFor({ type: 'GAP_MATERIAL', value: colorOf(pv.gapColor, doc) }, (s, ref) => mapPaving(s, pv.id, (p) => ({ ...p, gapColor: ref })));
                else setPv(pv.id, (p) => ({ ...p, gapColor: v || (colorBound ? colorOf(p.gapColor, doc) : p.gapColor) }));
              }}>
                <option value="">미정의</option>
                {colorParams.map((p) => <option key={p.ref} value={p.ref}>{p.name} ({p.ref})</option>)}
                <option value="__new">＋ 매개변수 추가</option>
              </select>
              <input type="color" value={colorOf(pv.gapColor, doc)} disabled={colorBound} aria-label="줄눈 색" onChange={(e) => setPv(pv.id, (p) => ({ ...p, gapColor: e.target.value }))} />
            </span>
          </label>
        </section>
        <section><h4>기타</h4>
          <label className="pv-field"><span className="pv-field-name">모서리 따기 타일 <i className="pv-info" title="캔버스 경계에 걸려 잘린 타일을 빼고 온전한 타일만 남깁니다">ⓘ</i></span>
            <select value={pv.cornerCut === 'true' ? '1' : pv.cornerCut === 'false' ? '0' : pv.cornerCut || '0'} aria-label="모서리 따기 타일" onChange={(e) => {
              const v = e.target.value;
              if (v === '__new') addParamFor({ type: 'BOOL', value: pv.cornerCut === '1' ? 'true' : 'false' }, (s, ref) => mapPaving(s, pv.id, (p) => ({ ...p, cornerCut: ref })));
              else setPv(pv.id, (p) => ({ ...p, cornerCut: v }));
            }}>
              <option value="0">아니오</option><option value="1">예</option>
              {boolParams.map((p) => <option key={p.ref} value={p.ref}>{p.name} ({p.ref})</option>)}
              <option value="__new">＋ 매개변수 추가</option>
            </select>
          </label>
        </section>
      </div>
    );
  };
  const tc = PV_TYPE_CONFIG[doc.type];
  const schemePanel = (
    <div className="pv-props">
      <h3>기본 설정</h3>
      <section><h4>표기 미리보기 이미지</h4>
        {doc.label
          ? <figure className="pv-labelimg"><img src={doc.label} alt="표기 미리보기 이미지" /><div><button className="pv-link" onClick={() => setModal({ k: 'label' })}>다시 만들기</button><button className="pv-link danger" onClick={() => commit({ ...doc, label: undefined })}>삭제</button></div></figure>
          : <div className="pv-labelnew"><button className="pv-btn" onClick={() => setModal({ k: 'label' })}>＋ 새로 만들기</button></div>}
      </section>
      <section><h4>분류</h4>
        <label className="pv-field"><span className="pv-field-name">분류</span><select value={doc.cat} aria-label="분류" onChange={(e) => commit({ ...doc, cat: Number(e.target.value) })}>{PV_CATS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      </section>
      <section><h4>방안 유형</h4>
        <label className="pv-field"><span className="pv-field-name">유형 <span className="pv-tip" tabIndex={0} aria-label="유형 성질">ⓘ<span className="pv-tipbox" role="tooltip">
          <span className={tc.moveWithMouse ? '' : 'no'}>{tc.moveWithMouse ? '✓' : '⊘'} 배치할 때 마우스를 따라감</span>
          <span className={tc.background ? '' : 'no'}>{tc.background ? '✓' : '⊘'} 같은 유형 방안은 하나만·맨 아래</span>
          <span className={tc.positionChangeable ? '' : 'no'}>{tc.positionChangeable ? '✓' : '⊘'} 방안 위치 이동 가능</span>
        </span></span></span>
          <select value={doc.type} aria-label="방안 유형" onChange={(e) => commit({ ...doc, type: e.target.value as PvScheme['type'] })}>{PV_TYPES.map((t) => <option key={t.v} value={t.v}>{t.name}</option>)}</select>
        </label>
      </section>
      <section><h4>캔버스 속성</h4>
        {In({ label: '폭', value: doc.bbw, min: 1000, max: 100000, on: (v) => commit({ ...doc, bbw: v }), unit: 'mm' })}
        {In({ label: '높이', value: doc.bbh, min: 1000, max: 100000, on: (v) => commit({ ...doc, bbh: v }), unit: 'mm' })}
        <label className="pv-field"><span className="pv-field-name">캔버스 색</span><input type="color" value={doc.color} aria-label="캔버스 색" onChange={(e) => commit({ ...doc, color: e.target.value })} /></label>
      </section>
      <section><h4>참조선 설정</h4>
        <label className="pv-field"><span className="pv-field-name">폭</span><input type="number" min={10} value={doc.guideW} aria-label="참조선 폭" onChange={(e) => { const n = Number(e.target.value); if (n >= 10) commit({ ...doc, guideW: n }); }} /></label>
        <label className="pv-field"><span className="pv-field-name">높이</span><input type="number" min={10} value={doc.guideH} aria-label="참조선 높이" onChange={(e) => { const n = Number(e.target.value); if (n >= 10) commit({ ...doc, guideH: n }); }} /></label>
      </section>
    </div>
  );
  /** 사용자 정의 모양 — 편집 중인 타일 */
  const shapeHit = modal?.k === 'shape' ? findNode(doc, modal.id) : null;
  const shapeTile = shapeHit?.node.kind === 'tile' ? shapeHit.node : null;
  const onShapeDone = (id: string, pts: [number, number][]) => {
    setModal(null);
    setTile(id, (x) => ({ ...x, machine: { ...(x.machine ?? { texX: '0', texY: '0', texRot: '0', params: {} }), type: 'POLYGON', params: { ...PV_CLIP_DEFAULTS.POLYGON, ...(x.machine?.type === 'POLYGON' ? x.machine.params : {}) }, polygon: pts } }));
    say(`사용자 정의 모양(점 ${pts.length}개)을 적용했습니다`);
  };
  const rightPanel: ReactNode = selV.length > 1 ? <div className="pv-props"><h3>속성</h3><p className="pv-muted">여러 개체를 골랐습니다 — 속성 설정이 없습니다</p></div>
    : one?.node.kind === 'tile' ? tilePanel(one.node, one.parent)
      : one?.node.kind === 'paving' ? pavingPanel(one.node)
        : editing ? pavingPanel(editing) : schemePanel;

  /* ── 구조 탐색 ── */
  const tileName = (t: PvTile) => (t.spriteRef ? `${t.sprites[0]?.name ?? '소재'} · ${t.spriteRef}` : t.multi ? `다중 혼합 ${t.sprites.length}종` : t.sprites[0]?.name ?? '타일');
  const navRow = (id: string, label: string, icon: string, depth: number, onPick: () => void) => (
    <li key={id} className={selV.includes(id) ? 'on' : ''} style={{ paddingLeft: 8 + depth * 14 }}>
      <button className="pv-nav-name" onClick={onPick} onDoubleClick={() => { if (doc.nodes.find((n) => n.id === id && n.kind === 'paving')) setRenaming(id); }}>
        <i>{icon}</i>{renaming === id
          ? <input autoFocus defaultValue={label} aria-label="포설 방식 이름" onClick={(e) => e.stopPropagation()} onBlur={(e) => { const v = e.target.value.trim(); setRenaming(null); if (v && v !== label) setPv(id, (p) => ({ ...p, name: v })); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          : <span>{label}</span>}
      </button>
      <button className="pv-x" aria-label={`${label} 삭제`} onClick={() => removeIds([id])}>🗑</button>
    </li>
  );

  const zoomBy = (k: number) => setView((v) => (v ? { ...v, scale: Math.min(5, Math.max(fitView(L.canvas, size.w, size.h).scale / 20, v.scale * k)) } : v));
  const fitScale = size.w ? fitView(L.canvas, size.w, size.h).scale : 1;
  const sliderVal = view ? Math.round(((Math.log(view.scale) - Math.log(fitScale / 20)) / (Math.log(5) - Math.log(fitScale / 20))) * 100) : 0;
  const cursor = drag?.tool ? (drag.kind === 'rotate' ? 'alias' : 'move') : 'default';

  return (
    <div className="pv-root" role="dialog" aria-modal="true" aria-label="파라메트릭 편집기">
      <header className="pv-top">
        <div className="pv-title"><i>▦</i><b>포설 방식 편집기</b><small>{name}{dirty ? ' · 저장 안 됨' : savedId ? ' · 저장됨' : ''}</small></div>
        <nav className="pv-topmenu">
          <div className="pv-dd">
            <button onClick={() => setMenu(menu === 'tut' ? '' : 'tut')} aria-expanded={menu === 'tut'}>튜토리얼 ▾</button>
            {menu === 'tut' && <div className="pv-ddmenu" onMouseLeave={() => setMenu('')}>
              <button disabled title="HP3 튜토리얼은 아직 없습니다">그림·글 튜토리얼</button>
              <button disabled title="HP3 튜토리얼은 아직 없습니다">영상 튜토리얼</button>
            </div>}
          </div>
          <button onClick={() => setModal({ k: 'help' })}>도움말</button>
          <button disabled={!past.length} onClick={undo} title="Ctrl+Z">실행 취소</button>
          <button disabled={!future.length} onClick={redo} title="Ctrl+Y">다시 실행</button>
          <div className="pv-dd">
            <button onClick={() => setMenu(menu === 'file' ? '' : 'file')} aria-expanded={menu === 'file'}>파일 ▾</button>
            {menu === 'file' && <div className="pv-ddmenu" onMouseLeave={() => setMenu('')}>
              <button onClick={save}>저장<kbd>Ctrl+S</kbd></button>
              <button onClick={saveAs}>다른 이름으로 저장<kbd>Ctrl+Shift+S</kbd></button>
            </div>}
          </div>
          <button onClick={() => setModal({ k: 'history' })}>기록</button>
          <button className="pv-exit" onClick={exit}>나가기</button>
        </nav>
      </header>
      <div className="pv-body">
        <nav className="pv-rail" aria-label="왼쪽 패널">
          <button className={left === 'param' && leftOpen ? 'on' : ''} onClick={() => { setLeft('param'); setLeftOpen(true); }}><i>⇄</i>매개변수</button>
          <button disabled title="HP3 에는 공용 소재 라이브러리가 없습니다 — 기업 라이브러리를 쓰세요"><i>⬡</i>소재 라이브러리</button>
          <button className={left === 'lib' && leftOpen ? 'on' : ''} onClick={() => { setLeft('lib'); setLeftOpen(true); }}><i>⬢</i>기업 라이브러리</button>
          {left === 'lib' && <ul className="pv-cats" aria-label="기업 라이브러리 분류">
            <li><button className={cat == null ? 'on' : ''} onClick={() => { setCat(null); setPage(0); }}>전체</button></li>
            {tiles.tree.filter((f) => !f.hidden).map((f) => <li key={f.id}><button className={cat === f.id ? 'on' : ''} title={f.name} onClick={() => { setCat(f.id); setPage(0); setLeftOpen(true); }}>{f.name}</button></li>)}
          </ul>}
        </nav>
        {leftOpen && <aside className="pv-left">
          {left === 'param' ? <>
            <div className="pv-left-head"><b>사용자 정의 매개변수</b><button className="pv-icon" aria-label="매개변수 추가" onClick={() => setModal({ k: 'param' })}>＋</button></div>
            <table className="pv-params"><thead><tr><th>이름</th><th>참조명</th><th>현재값</th><th /></tr></thead>
              <tbody>{doc.params.map((p) => <tr key={p.ref} onClick={() => setModal({ k: 'param', init: p })}>
                <td>{p.name}</td><td>{p.ref}</td>
                <td>{p.type === 'GAP_MATERIAL' ? <i className="pv-sw" style={{ background: p.value }} /> : p.type === 'BOOL' ? (p.value === 'true' ? '예' : '아니오') : p.type === 'MULTI_SPRITE' ? `소재 ${p.sprites?.length ?? 0}종` : p.value}</td>
                <td><button className="pv-x" aria-label={`${p.name} 삭제`} onClick={(e) => {
                  e.stopPropagation();
                  if (countRefs(doc, p.ref) > 0) { say('이 매개변수는 참조되고 있어 삭제할 수 없습니다'); return; }
                  setModal({ k: 'confirm', text: `‘${p.name}’ 매개변수를 삭제할까요?`, ok: () => commit({ ...doc, params: doc.params.filter((x) => x.ref !== p.ref) }) });
                }}>×</button></td>
              </tr>)}
                {!doc.params.length && <tr><td colSpan={4} className="pv-muted">＋ 로 매개변수를 만들면 칸의 수식에서 참조명으로 씁니다</td></tr>}</tbody>
            </table>
            <p className="pv-muted pv-sys">시스템: BBW(캔버스 폭) {sc.BBW} · BBH(높이) {sc.BBH}</p>
          </> : <>
            <input className="pv-search" placeholder="검색" aria-label="상품 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
            <ul className="pv-prods" onMouseLeave={() => setHover(null)}>
              {libPage.map((i) => <li key={i.id} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-hp3-item', i.id); e.dataTransfer.effectAllowed = 'copy'; setHover(null); }}
                onMouseEnter={(e) => setHover({ item: i, y: (e.currentTarget as HTMLElement).getBoundingClientRect().top })} title={`${i.name} — 캔버스로 끌어 놓으세요`}>
                <img src={i.img} alt={i.name} loading="lazy" draggable={false} /><span className="pv-badge">상품</span>
              </li>)}
              {!libPage.length && <li className="pv-muted pv-empty">조건에 맞는 상품이 없습니다 (크기 mm 가 있는 타일 상품만)</li>}
            </ul>
            <div className="pv-pager"><button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="이전 쪽">‹</button><span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="다음 쪽">›</button></div>
            {hover && (() => { const lw = itemLW(hover.item); return <div className="pv-hovercard" style={{ top: Math.max(56, hover.y - 20) }}><img src={hover.item.img} alt="" /><b>{hover.item.name}</b>{lw && <><span>상세</span><em>크기: {lw[0]} x {lw[1]}mm</em></>}</div>; })()}
          </>}
        </aside>}
        <button className="pv-collapse left" aria-label={leftOpen ? '왼쪽 패널 접기' : '왼쪽 패널 펼치기'} onClick={() => setLeftOpen(!leftOpen)}>{leftOpen ? '◂' : '▸'}</button>
        <main className="pv-stage" ref={stageRef} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-hp3-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={onDrop}>
          <canvas ref={canvasRef} className="pv-canvas" style={{ width: size.w, height: size.h, cursor }} aria-label="방안 캔버스"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDbl} onContextMenu={(e) => e.preventDefault()} />
          {editId && <button className="pv-back" title="포설 방식 편집 끝내기" aria-label="포설 방식 편집 끝내기" onClick={exitEdit}>‹</button>}
          {!doc.nodes.length && <div className="pv-empty-hint">왼쪽 기업 라이브러리에서 타일을 캔버스로 끌어 놓으세요 → 타일을 고르고 <b>포설 방식으로 변환(Ctrl+G)</b> → U·V 방향 오프셋과 개수로 반복</div>}
          {L.overflow && <div className="pv-warn" role="alert">타일 수가 제한({PV_TILE_LIMIT.toLocaleString()}장)을 넘어 일부만 그립니다 — 반복 개수·오프셋을 확인하세요</div>}
          {box && menuKeys.length > 0 && <div className="pv-floatmenu" role="toolbar" aria-label="개체 메뉴"
            style={{ left: Math.min(Math.max(8, box.x1 - 20), size.w - 46 * menuKeys.length - 8), top: Math.max(8, box.y0 - 44) }}>
            {menuKeys.map((k) => <button key={k} aria-label={MI[k].tip} onClick={() => runMenu(k)}><span>{MI[k].icon}</span><em>{MI[k].tip}</em></button>)}
          </div>}
          <div className={`pv-nav${navOpen ? '' : ' closed'}`}>
            <header><b>구조 탐색</b><button className="pv-icon" aria-label={navOpen ? '구조 탐색 접기' : '구조 탐색 펼치기'} onClick={() => setNavOpen(!navOpen)}>{navOpen ? '⇱' : '⇲'}</button></header>
            {navOpen && <ul>
              {doc.nodes.map((n) => n.kind === 'tile'
                ? navRow(n.id, tileName(n), '▢', 0, () => { setEditId(null); setSel([n.id]); })
                : [navRow(n.id, n.name, '▦', 0, () => { setEditId(null); setSel([n.id]); }), ...n.tiles.map((t) => navRow(t.id, tileName(t), '▢', 1, () => { setEditId(n.id); setSel([t.id]); }))])}
              {!doc.nodes.length && <li className="pv-muted">개체가 없습니다</li>}
            </ul>}
          </div>
          <footer className="pv-bottom">
            <span>포설 방식 해제: Ctrl+Shift+G</span>
            <div className="pv-zoom">
              <button aria-label="화면 맞춤" title="화면 맞춤" onClick={() => setView(fitView(L.canvas, size.w, size.h))}>⛶</button>
              <button aria-label="축소" onClick={() => zoomBy(1 / 1.25)}>−</button>
              <input type="range" min={0} max={100} value={sliderVal} aria-label="확대 비율" onChange={(e) => {
                const lo = Math.log(fitScale / 20), hi = Math.log(5);
                const scale = Math.exp(lo + (Number(e.target.value) / 100) * (hi - lo));
                setView((v) => (v ? { ...v, scale } : v));
              }} />
              <button aria-label="확대" onClick={() => zoomBy(1.25)}>＋</button>
            </div>
          </footer>
        </main>
        <button className="pv-collapse right" aria-label={rightOpen ? '오른쪽 패널 접기' : '오른쪽 패널 펼치기'} onClick={() => setRightOpen(!rightOpen)}>{rightOpen ? '▸' : '◂'}</button>
        {rightOpen && <aside className="pv-right">{rightPanel}</aside>}
      </div>
      {toast && <div className="pv-toast" role="status">{toast}</div>}

      {modal?.k === 'save' && <SaveModal name={modal.asNew ? `${name} 복사` : name} folder={folder} tree={saveTree} onClose={() => setModal(null)}
        onOk={(nm, fd) => { const asNew = modal.asNew; setModal(null); void doSave(asNew, nm, fd); }} />}
      {modal?.k === 'history' && <HistoryModal versions={readVersions(savedId ?? 'new')} onClose={() => setModal(null)}
        onOpen={(v) => setModal({ k: 'confirm', text: `${new Date(v.at).toLocaleString('ko-KR', { hour12: false })} ${v.label} 버전을 열까요? 지금 화면은 실행 취소로 되돌릴 수 있습니다.`, ok: () => { commit({ ...structuredClone(v.scheme), label: v.scheme.label ?? doc.label }); setSel([]); setEditId(null); } })} />}
      {modal?.k === 'help' && <PvModal title="도움말" onClose={() => setModal(null)} width={560}>
        <div className="pv-help">
          <p><b>방안</b>은 타일을 놓고 <b>포설 방식</b>으로 묶어 U·V 방향으로 반복해 만듭니다. 캔버스(폭 BBW·높이 BBH) 밖은 잘립니다.</p>
          <ol>
            <li>왼쪽 기업 라이브러리에서 타일을 캔버스로 끌어 놓습니다.</li>
            <li>타일을 고르고 ‘포설 방식으로 변환(Ctrl+G)’ — 시작점은 타일 자리, 단위는 고른 타일들.</li>
            <li>포설 방식 속성에서 U·V 방향 X·Y 오프셋(반복 한 칸의 이동)과 정·역방향 개수(숫자 또는 무한)를 넣습니다.</li>
            <li>‘편집’(더블클릭)으로 단위 안에 들어가 타일을 더 놓거나 소재 가공(모양 자르기)·다중 타일 혼합을 정합니다.</li>
            <li>칸마다 수식을 쓸 수 있습니다 — 매개변수 참조명, BBW·BBH, sin·cos·tan(도)·sqrt.</li>
          </ol>
          <table className="pv-keys"><tbody>
            {[['Ctrl+G', '포설 방식으로 변환'], ['Ctrl+Shift+G', '포설 방식 해제'], ['M', '이동 (마우스를 따라감, 누르면 놓기)'], ['R', '회전 (Shift 15° 단위)'], ['C', '소재 교체'], ['Ctrl+C', '복사'], ['Del', '삭제'], ['Ctrl+Z / Ctrl+Y', '실행 취소 / 다시 실행'], ['Ctrl+S / Ctrl+Shift+S', '저장 / 다른 이름으로 저장'], ['Esc', '도구 취소 → 편집 끝내기 → 선택 해제'], ['휠 · 빈 곳 끌기', '확대·축소 · 화면 이동']].map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
          </tbody></table>
        </div>
      </PvModal>}
      {modal?.k === 'exit' && <PvModal title="나가기" onClose={() => setModal(null)} width={380}
        footer={<><button className="pv-btn" onClick={() => setModal(null)}>취소</button><button className="pv-btn primary" onClick={onClose}>나가기</button></>}>
        <p>저장하지 않은 변경이 있습니다. 나가면 변경 내용이 사라집니다 — 나갈까요?</p>
      </PvModal>}
      {modal?.k === 'emptyExit' && <PvModal title="포설 방식 편집 끝내기" onClose={() => setModal(null)} width={380}
        footer={<><button className="pv-btn" onClick={() => setModal(null)}>취소</button><button className="pv-btn primary" onClick={() => { const id = modal.id; setModal(null); setEditId(null); removeIds([id]); }}>확인</button></>}>
        <p>지금 포설 방식 안에 소재가 없습니다. 나가면 이 포설 방식이 삭제됩니다.</p>
      </PvModal>}
      {modal?.k === 'confirm' && <PvModal title="확인" onClose={() => setModal(null)} width={380}
        footer={<><button className="pv-btn" onClick={() => setModal(null)}>취소</button><button className="pv-btn primary" onClick={() => { const f = modal.ok; setModal(null); f(); }}>확인</button></>}>
        <p>{modal.text}</p>
      </PvModal>}
      {modal?.k === 'param' && <ParamForm init={modal.init} preset={modal.preset} params={doc.params} scope={sc} tree={tiles.tree} items={tiles.items} onClose={() => setModal(null)}
        onOk={(p) => {
          const { bind, init: was } = modal;
          const withP = { ...doc, params: was ? doc.params.map((x) => (x.ref === p.ref ? p : x)) : [...doc.params, p] };
          setModal(null);
          // 매개변수 추가와 칸 연결을 한 번에 (실행 취소 한 번으로 되돌림)
          commit(bind ? bind(withP, p.ref) : withP);
          say(was ? '매개변수를 바꿨습니다' : `‘${p.name}’(${p.ref}) 매개변수를 만들었습니다${bind ? ' — 칸에 연결했습니다' : ''}`);
        }} />}
      {modal?.k === 'mix' && (() => {
        const h = findNode(doc, modal.id);
        if (h?.node.kind !== 'tile') return null;
        const t = h.node;
        return <MaterialModal tree={tiles.tree} items={tiles.items} initial={t.sprites} multi allowToggle onClose={() => setModal(null)}
          onOk={(list, multi) => { setModal(null); setTile(t.id, (x) => ({ ...x, sprites: list, multi: multi && list.length > 1 })); }} />;
      })()}
      {modal?.k === 'replace' && <MaterialModal title="소재 교체" tree={tiles.tree} items={tiles.items} initial={[]} multi={false} onClose={() => setModal(null)}
        onOk={(list) => { const ids = modal.ids; setModal(null); commit(mapTiles(doc, ids, (t) => ({ ...t, sprites: list.slice(0, 1).map((s) => ({ ...s, weight: 1 })), multi: false, spriteRef: undefined }))); say('소재를 바꿨습니다'); }} />}
      {shapeTile && <CustomShapeEditor init={shapeTile.machine?.polygon} onClose={() => setModal(null)} onDone={(pts) => onShapeDone(shapeTile.id, pts)} />}
      {modal?.k === 'label' && <LabelEditor scheme={doc} images={IMG_CACHE} onClose={() => setModal(null)} onDone={(url) => { setModal(null); commit({ ...doc, label: url }); say('표기 미리보기 이미지를 만들었습니다'); }} />}
    </div>
  );
}
