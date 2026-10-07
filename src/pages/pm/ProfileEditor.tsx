import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DoubleSide, type Vector3 } from 'three';
import { parseDxfProfile } from '../../data/dxf';
import { plankGeometry, polyOf } from '../../pm/geometry';
import { bounds, parseLinePath, parsePlankPath, rectPath, stringifyLinePath, stringifyPlankPath, syncLines, type RectAnchor, type V2 } from '../../pm/path';
import type { NumPathOut, PmEval } from '../../pm/resolve';
import type { PathLine, PathPoint, PlankShape, PmNode, PmPath } from '../../pm/types';
import { Confirm, Fx, Unverified } from './ui';
import { pointOnSegment, shiftExpr, snapPoint } from '../../pm/snap';
import { previewOf } from './ctx';
import { SECTION_TEMPLATES } from '../../pm/sections';

/**
 * 2D 윤곽 편집(编辑轮廓) · 경로 편집(编辑路径) — 쿠지알러 화면(05-profile-editor) 배치:
 *  위: 실행 취소 · 다시 실행 · 나가기(저장 안 했으면 확인) · 저장
 *  가운데: 자 눈금 2D 캔버스, 번호 붙은 꼭짓점, 맞춤·축소·확대, 오른쪽 위 작은 3D 미리보기
 *  세로 막대: 윤곽 · 구멍 · 홈(+)   오른쪽: 형상 템플릿(사용자 정의 형상 · 사각형) · 경로 복사/도형 붙여넣기 · 가로축/세로축 · 꼭짓점 목록 · 꼭짓점 추가 · 오프셋
 * 교육 문서: 꼭짓점 → 모서리 종류(둥근 모서리 반지름 · 모따기 a·b), 선 → 원호(반지름 수식), CAD(DXF) 가져오기, 경로 복사·붙여넣기.
 */

type Target = { k: 'outline' } | { k: 'hole'; i: number } | { k: 'slot'; i: number };
type Doc = PlankShape;

const CLIP_KEY = 'hp3-pm-path-clip';
const isNum = (s: string) => /^\s*[-+]?\d+(\.\d+)?\s*$/.test(s);
const round = (n: number) => Math.round(n * 10) / 10;

function pathOf(d: Doc, t: Target): PmPath {
  return t.k === 'outline' ? d.outline : t.k === 'hole' ? d.holes[t.i] : d.slots[t.i].path;
}
function withPath(d: Doc, t: Target, p: PmPath): Doc {
  const q = syncLines(p);
  if (t.k === 'outline') return { ...d, outline: q };
  if (t.k === 'hole') return { ...d, holes: d.holes.map((h, i) => (i === t.i ? q : h)) };
  return { ...d, slots: d.slots.map((s, i) => (i === t.i ? { ...s, path: q } : s)) };
}

/** 자 눈금 간격 — 화면에서 50px 이상 */
const tickStep = (scale: number) => [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * scale >= 50) ?? 10000;

export function ProfileEditor({ ev, node, param, kind, closedDefault, title, onSave, onClose, section, onValidate, sectionHint, sectionDepth = 300 }: {
  ev: PmEval; node: PmNode; param: string; kind: 'plank' | 'line'; closedDefault: boolean; title: string;
  onSave: (value: string) => void; onClose: () => void;
  /** 단면 그리기 — 몰딩 단면 템플릿 · 닫힌 경로 고정 · 300mm 몰딩 3D 미리보기 (CAD 없이 단면 만들기) */
  section?: boolean;
  /** 저장 전 검사 — 문구를 돌려주면 저장하지 않고 알림 */
  onValidate?: (value: string) => string | null;
  /** 단면 모드 머리 안내 (기본: 몰딩 단면 안내) */
  sectionHint?: string;
  /** 단면 모드 3D 미리보기 길이 mm (기본 300 몰딩) */
  sectionDepth?: number;
}) {
  const initial = useMemo<Doc>(() => {
    const raw = node.params[param] ?? '';
    if (kind === 'plank') return parsePlankPath(raw);
    return { outline: parseLinePath(raw, closedDefault), holes: [], slots: [] };
  }, [node, param, kind, closedDefault]);
  const [hist, setHist] = useState<{ list: Doc[]; i: number }>({ list: [initial], i: 0 });
  const doc = hist.list[hist.i];
  const dirty = hist.i > 0;
  const push = (d: Doc) => setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), d].slice(-80), i: Math.min(h.i + 1, 79) }));
  const [target, setTarget] = useState<Target>({ k: 'outline' });
  /** 선택한 점들 — 마지막이 기준 점 (Ctrl/Shift 클릭 · Shift+끌기 영역 선택) */
  const [selRaw, setSel] = useState<number[]>([]);
  /** Shift+끌기 영역 선택 사각형(화면 px) */
  const [boxSel, setBoxSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** 점 끌기 중 직각 가이드 */
  const [guide, setGuide] = useState<{ lines: [V2, V2][]; marks: V2[][] } | null>(null);
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [tpl, setTpl] = useState<string>('custom');
  /** 단면 템플릿 입력값 — ‘템플릿.칸’ → 글자 */
  const [secVals, setSecVals] = useState<Record<string, string>>({});
  const [rect, setRect] = useState<{ anchor: RectAnchor; x: string; y: string; w: string; h: string }>({ anchor: 'lb', x: '0', y: '0', w: '#W', h: '#D' });
  const [confirmExit, setConfirmExit] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  const [view, setView] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  /** 처음 열 때의 윤곽 경계 — 캔버스 크기를 잰 뒤 한 번만 화면 맞춤(끄는 동안 배율이 따라 바뀌지 않게) */
  const [fit0] = useState(() => {
    const pts = ev.numPath(node, initial.outline, '윤곽점').points.map((q) => [q.x, q.y] as V2);
    return pts.length ? bounds(pts) : { x0: -300, y0: -300, x1: 300, y1: 300 };
  });
  type PtDrag = {
    kind: 'pt'; idx: number; sx: number; sy: number; moved: boolean; pushed: boolean; start: { pos: V2; x: string; y: string };
    /** 여러 점 함께 끌기 — 끌기 전 점(수식)들 */
    group?: { idx: number[]; pts: PathPoint[] };
  };
  const drag = useRef<PtDrag | { kind: 'pan'; x: number; y: number; cx: number; cy: number } | { kind: 'box'; x: number; y: number; add: boolean } | null>(null);

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t); }, [msg]);
  // 캔버스 실제 크기 — 창 크기가 바뀌어도 격자·눈금이 캔버스 전체에
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      setBox({ w: r.width, h: r.height });
      const sw = Math.max(fit0.x1 - fit0.x0, 10), sh = Math.max(fit0.y1 - fit0.y0, 10);
      setView((cur) => cur ?? { cx: (fit0.x0 + fit0.x1) / 2, cy: (fit0.y0 + fit0.y1) / 2, scale: Math.min((r.width - 120) / sw, (r.height - 120) / sh) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit0]);
  const path = pathOf(doc, target);
  const sel = selRaw.filter((i) => i < path.points.length);
  const selPt = sel.length === 1 ? sel[0] : null;
  const setSelPt = (i: number | null) => setSel(i == null ? [] : [i]);
  const isSel = (i: number) => sel.includes(i);
  const toggleSel = (i: number) => setSel(isSel(i) ? sel.filter((k) => k !== i) : [...sel, i]);
  const num = (p: PmPath, label: string): NumPathOut => ev.numPath(node, p, label);
  const outlineNum = num(doc.outline, '윤곽점');
  const nums = { outline: outlineNum, holes: doc.holes.map((h, i) => num(h, `구멍${i + 1}`)), slots: doc.slots.map((s, i) => num(s.path, `홈${i + 1}`)) };
  const curNum = target.k === 'outline' ? nums.outline : target.k === 'hole' ? nums.holes[target.i] : nums.slots[target.i];

  // 화면 맞춤
  const fitView = () => {
    const pts: V2[] = [...outlineNum.points.map((p) => [p.x, p.y] as V2), ...nums.holes.flatMap((h) => h.points.map((p) => [p.x, p.y] as V2))];
    fitTo(pts.length ? bounds(pts) : { x0: -300, y0: -300, x1: 300, y1: 300 });
  };
  const fitTo = (b: { x0: number; y0: number; x1: number; y1: number }) => {
    const el = svgRef.current?.getBoundingClientRect();
    const w = el?.width ?? box.w, h = el?.height ?? box.h;
    setBox({ w, h });
    const sw = Math.max(b.x1 - b.x0, 10), sh = Math.max(b.y1 - b.y0, 10);
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.min((w - 120) / sw, (h - 120) / sh) });
  };
  const v = view ?? (() => {
    const pts: V2[] = outlineNum.points.map((p) => [p.x, p.y]);
    const b = pts.length ? bounds(pts) : { x0: -300, y0: -300, x1: 300, y1: 300 };
    const sw = Math.max(b.x1 - b.x0, 10), sh = Math.max(b.y1 - b.y0, 10);
    return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Math.min((box.w - 120) / sw, (box.h - 120) / sh) };
  })();
  const sx = (x: number) => (x - v.cx) * v.scale + box.w / 2;
  const sy = (y: number) => (v.cy - y) * v.scale + box.h / 2;
  const toMm = (px: number, py: number): V2 => [(px - box.w / 2) / v.scale + v.cx, v.cy - (py - box.h / 2) / v.scale];

  const coord = (n: number) => String(v.scale >= 5 ? Math.round(n * 10) / 10 : Math.round(n));
  const setPoints = (pts: PathPoint[], lines?: PathLine[]) => push(withPath(doc, target, { ...path, points: pts, lines: lines ?? path.lines }));
  const setPoint = (i: number, p: Partial<PathPoint>) => setPoints(path.points.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const setLine = (i: number, l: Partial<PathLine>) => push(withPath(doc, target, { ...path, lines: path.lines.map((x, k) => (k === i ? { ...x, ...l } : x)) }));
  const addPoint = (at?: number, xy?: V2) => {
    const pts = [...path.points];
    const i = at ?? pts.length;
    const last = pts[i - 1] ?? pts[pts.length - 1];
    const np: PathPoint = xy ? { x: String(round(xy[0])), y: String(round(xy[1])), type: 0 } : { x: last ? (isNum(last.x) ? String(Number(last.x) + 100) : `${last.x}+100`) : '0', y: last?.y ?? '0', type: 0 };
    pts.splice(i, 0, np);
    const lines = [...path.lines];
    lines.splice(Math.min(i, lines.length), 0, { type: 0 });
    setPoints(pts, lines);
    setSelPt(i);
  };
  const delPoints = (idx: number[]) => {
    const min = path.closed ? 3 : 2;
    if (path.points.length - idx.length < min) { setMsg(`점이 ${min}개보다 적으면 ${path.closed ? '윤곽' : '경로'}이 되지 않아 삭제할 수 없습니다`); return; }
    // 점 i 를 지우면 그 점에서 나가는 선(i)을 지운다 — 열린 경로의 끝점이면 들어오는 선
    const gone = new Set(idx);
    const lineGone = new Set([...gone].map((i) => Math.min(i, path.lines.length - 1)));
    setPoints(path.points.filter((_, k) => !gone.has(k)), path.lines.filter((_, k) => !lineGone.has(k)));
    setSel([]);
  };
  const delPoint = (i: number) => delPoints(isSel(i) && sel.length > 1 ? sel : [i]);
  /** 선택한 점들의 모서리 종류 한꺼번에 */
  const applyCorner = (type: 0 | 1 | 2, r: string, a: string, b: string) => {
    const set = new Set(sel);
    setPoints(path.points.map((q, k) => (set.has(k) ? { ...q, type, ...(type === 1 ? { radius: r } : {}), ...(type === 2 ? { chamferA: a, chamferB: b } : {}) } : q)));
    setMsg(`점 ${sel.length}개의 모서리를 ${type === 0 ? '직각' : type === 1 ? `둥근 모서리(반지름 ${r})` : `모따기(a ${a}, b ${b})`}(으)로 바꿨습니다`);
  };
  /** 선택한 점들을 함께 옮기기 — 수식 좌표는 이동량을 더해 관계 유지 */
  const moveSel = (dx: number, dy: number) => {
    const set = new Set(sel);
    setPoints(path.points.map((q, k) => (set.has(k) ? { ...q, x: shiftExpr(q.x, dx, coord), y: shiftExpr(q.y, dy, coord) } : q)));
  };

  // 캔버스 조작
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (tool === 'draw' && e.button === 0) { addPoint(path.points.length, toMm(px, py)); return; }
    if (e.button === 0 && e.shiftKey) {
      drag.current = { kind: 'box', x: px, y: py, add: e.ctrlKey || e.metaKey };
      setBoxSel({ x0: px, y0: py, x1: px, y1: py });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button === 0 || e.button === 1) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) setSel([]);
    }
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') { setView({ ...v, cx: d.cx - (e.clientX - d.x) / v.scale, cy: d.cy + (e.clientY - d.y) / v.scale }); return; }
    const r = svgRef.current!.getBoundingClientRect();
    if (d.kind === 'box') { setBoxSel({ x0: d.x, y0: d.y, x1: e.clientX - r.left, y1: e.clientY - r.top }); return; }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    const m = toMm(e.clientX - r.left, e.clientY - r.top);
    // 직각 가이드 스냅 — 이웃과 수평·수직이면 그 점의 수식을 이어받음. 함께 움직이는 점은 기준에서 뺀다
    const moving = new Set(d.group?.idx ?? [d.idx]);
    const sn = snapPoint({
      pts: curNum.points.map((q, k) => (moving.has(k) && k !== d.idx ? [NaN, NaN] : [q.x, q.y]) as V2),
      exprs: path.points.map((q) => ({ x: q.x, y: q.y })), i: d.idx, closed: path.closed, m, tol: 8 / v.scale, start: d.start,
    });
    const dx = sn.pos[0] - d.start.pos[0], dy = sn.pos[1] - d.start.pos[1];
    // 끈 점: 스냅으로 붙은 축은 이웃 수식, 아니면 원래 좌표(수식)에 이동량을 더함
    const xs = sn.x ?? shiftExpr(d.start.x, dx, coord), ys = sn.y ?? shiftExpr(d.start.y, dy, coord);
    const first = !d.pushed;
    d.pushed = true;
    const idx = d.idx;
    const group = d.group;
    setHist((h) => {
      const cur = h.list[h.i];
      const p = pathOf(cur, target);
      const next = withPath(cur, target, {
        ...p, points: p.points.map((q, k) => {
          if (k === idx) return { ...q, x: xs, y: ys };
          if (group && group.idx.includes(k)) { const o = group.pts[k]; return { ...q, x: shiftExpr(o.x, dx, coord), y: shiftExpr(o.y, dy, coord) }; }
          return q;
        }),
      });
      if (first) return { list: [...h.list.slice(0, h.i + 1), next].slice(-80), i: Math.min(h.i + 1, 79) };
      const list = [...h.list]; list[h.i] = next;
      return { ...h, list };
    });
    setGuide({ lines: sn.guides, marks: sn.marks });
  };
  const onUp = () => {
    const d = drag.current;
    if (d?.kind === 'box' && boxSel) {
      const x0 = Math.min(boxSel.x0, boxSel.x1), x1 = Math.max(boxSel.x0, boxSel.x1), y0 = Math.min(boxSel.y0, boxSel.y1), y1 = Math.max(boxSel.y0, boxSel.y1);
      const inside = curNum.points.map((q, k) => ({ k, x: sx(q.x), y: sy(q.y) })).filter((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1).map((q) => q.k);
      setSel(d.add ? [...sel, ...inside.filter((k) => !sel.includes(k))] : inside);
      if (inside.length) setMsg(`점 ${inside.length}개를 선택했습니다`);
    }
    drag.current = null; setGuide(null); setBoxSel(null);
  };
  const onWheel = (e: RWheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const [mx, my] = toMm(e.clientX - r.left, e.clientY - r.top);
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.max(0.01, Math.min(200, v.scale * k));
    setView({ scale, cx: mx - (mx - v.cx) * (v.scale / scale), cy: my - (my - v.cy) * (v.scale / scale) });
  };
  /** 점 누르기 → 선택, 그대로 끌면 이동 (수식 좌표도 이동 — 정렬 스냅이면 수식 유지, 아니면 숫자) */
  const startPtDrag = (e: RPointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSel(i); return; }
    const together = isSel(i) && sel.length > 1;
    if (!together) setSel([i]);
    const q = curNum.points[i], src = path.points[i];
    drag.current = {
      kind: 'pt', idx: i, sx: e.clientX, sy: e.clientY, moved: false, pushed: false, start: { pos: [q.x, q.y], x: src.x, y: src.y },
      group: together ? { idx: sel, pts: path.points.map((x) => ({ ...x })) } : undefined,
    };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  /** 선 왼쪽 클릭 → 그 자리에 점 추가하고 바로 끌 수 있게 */
  const addOnLine = (e: RPointerEvent, i: number) => {
    if (e.button !== 0 || tool !== 'select') return;
    e.stopPropagation();
    const n = path.points.length;
    if (path.lines[i]?.type === 1) { setMsg('원호 선에는 점을 넣을 수 없습니다 — 점 설정에서 선 종류를 직선으로 바꾼 뒤 넣으세요'); return; }
    const r = svgRef.current!.getBoundingClientRect();
    const m = toMm(e.clientX - r.left, e.clientY - r.top);
    const a = curNum.points[i], b = curNum.points[(i + 1) % n];
    const at = pointOnSegment([a.x, a.y], [b.x, b.y], path.points[i], path.points[(i + 1) % n], m);
    const np: PathPoint = { x: at.x ?? coord(at.pos[0]), y: at.y ?? coord(at.pos[1]), type: 0 };
    const pts = [...path.points]; pts.splice(i + 1, 0, np);
    const lines = [...path.lines]; lines.splice(i + 1, 0, { type: 0 });
    setPoints(pts, lines);
    setSelPt(i + 1);
    drag.current = { kind: 'pt', idx: i + 1, sx: e.clientX, sy: e.clientY, moved: false, pushed: true, start: { pos: at.pos, x: np.x, y: np.y } };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); delPoints(sel); }
      else if (e.key === 'Escape' && sel.length) { e.preventDefault(); e.stopPropagation(); setSel([]); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(path.points.map((_, k) => k)); }
    };
  });
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  const polyD = (n: NumPathOut) => {
    const pts = polyOf(n);
    if (!pts.length) return '';
    return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ') + (n.closed ? ' Z' : '');
  };

  const copyPath = () => { localStorage.setItem(CLIP_KEY, JSON.stringify(path)); setMsg('경로를 복사했습니다 — 다른 판재·로프트의 편집 창에서 ‘도형 붙여넣기’'); };
  const pastePath = () => {
    try {
      const p = JSON.parse(localStorage.getItem(CLIP_KEY) ?? 'null') as PmPath | null;
      if (!p?.points?.length) { setMsg('복사한 경로가 없습니다'); return; }
      push(withPath(doc, target, { ...p, closed: target.k === 'outline' && kind === 'line' ? p.closed : true }));
      setMsg('도형을 붙여 넣었습니다');
    } catch { setMsg('복사한 경로를 읽을 수 없습니다'); }
  };
  const importDxf = async (f: File) => {
    try {
      const s = parseDxfProfile(await f.text());
      const pts: PathPoint[] = s.points.map(([x, y]) => ({ x: String(round(x)), y: String(round(y)), type: 0 }));
      push(withPath(doc, target, { points: pts, lines: pts.map(() => ({ type: 0 as const })), closed: true }));
      setMsg(`DXF 에서 점 ${pts.length}개를 가져왔습니다 — 좌표가 숫자이니 필요한 곳을 #W 같은 변수 수식으로 바꾸세요`);
    } catch (e) { setMsg(`DXF 를 읽지 못했습니다: ${(e as Error).message}`); }
  };
  /** 단면 템플릿 적용 — 숫자(mm)로 몰딩 단면을 바로 그리고 화면을 맞춘다 */
  const applySection = () => {
    const t = SECTION_TEMPLATES.find((x) => x.key === tpl);
    if (!t) return;
    const vals: Record<string, number> = {};
    for (const f of t.fields) {
      const n = Number(secVals[`${t.key}.${f.k}`] ?? f.v);
      if (!(n > 0)) { setMsg(`${f.label}은(는) 0보다 큰 숫자여야 합니다`); return; }
      vals[f.k] = n;
    }
    const p = t.build(vals);
    push(withPath(doc, { k: 'outline' }, p));
    setTarget({ k: 'outline' });
    setSel([]);
    setTpl('custom');
    const pts = polyOf(num(p, '윤곽점'));
    if (pts.length) fitTo(bounds(pts));
    setMsg(`${t.name} 단면을 그렸습니다 — 점을 끌거나 ‘그리기’로 고칠 수 있습니다`);
  };
  const applyTemplate = () => {
    const p = rectPath(rect.x, rect.y, rect.w, rect.h, rect.anchor);
    push(withPath(doc, target, p));
    setTpl('custom');
    setMsg('사각형을 그렸습니다');
  };
  const save = () => {
    const out = kind === 'plank' ? stringifyPlankPath(doc) : stringifyLinePath(section ? { ...doc.outline, closed: true } : doc.outline);
    const bad = onValidate?.(out);
    if (bad) { setMsg(bad); return; }
    onSave(out);
    onClose();
  };

  const step = tickStep(v.scale);
  const ticksX: number[] = [], ticksY: number[] = [];
  for (let x = Math.ceil(toMm(0, 0)[0] / step) * step; x <= toMm(box.w, 0)[0]; x += step) ticksX.push(x);
  for (let y = Math.ceil(toMm(0, box.h)[1] / step) * step; y <= toMm(0, 0)[1]; y += step) ticksY.push(y);
  const thick = kind === 'plank' ? ev.numParam(node, 'thickness', 18) : section ? sectionDepth : 0;
  const shapeKey = kind === 'plank' || section ? JSON.stringify([outlineNum, nums.holes, thick]) : '';

  const selP = selPt != null ? path.points[selPt] : null;
  const lineIdx = selPt != null && selPt < path.lines.length ? selPt : null;
  const selL = lineIdx != null ? path.lines[lineIdx] : null;

  return (
    <div className="pm-modal-bg">
      <div className="pm-modal pm-pe" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><b>{title}</b><small>{section ? sectionHint ?? '단면(mm) — 왼쪽 아래가 (0,0). 오른쪽 단면 템플릿에서 시작하거나 ‘그리기’로 점을 찍으세요 · 3D 미리보기는 300mm 몰딩' : `${node.name}${kind === 'plank' ? ` · 두께 ${thick}` : ''} — 좌표는 수식(#W, #D …) 그대로 저장됩니다`}</small></div>
          <button className="pm-icon" title="실행 취소" aria-label="실행 취소" disabled={hist.i === 0} onClick={() => setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) }))}>↶</button>
          <button className="pm-icon" title="다시 실행" aria-label="다시 실행" disabled={hist.i >= hist.list.length - 1} onClick={() => setHist((h) => ({ ...h, i: Math.min(h.list.length - 1, h.i + 1) }))}>↷</button>
          <button className="pm-btn" onClick={() => (dirty ? setConfirmExit(true) : onClose())}>나가기</button>
          <button className="pm-primary" onClick={save}>저장</button>
        </header>
        <div className="body">
          <div className="pm-pe-canvas">
            <svg ref={svgRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
              style={{ cursor: tool === 'draw' ? 'crosshair' : 'default' }} aria-label="2D 윤곽 캔버스">
              {/* 격자 */}
              {ticksX.map((x) => <line key={`gx${x}`} x1={sx(x)} x2={sx(x)} y1={0} y2={box.h} stroke={x === 0 ? '#c4cad3' : '#ececec'} />)}
              {ticksY.map((y) => <line key={`gy${y}`} y1={sy(y)} y2={sy(y)} x1={0} x2={box.w} stroke={y === 0 ? '#c4cad3' : '#ececec'} />)}
              {/* 구멍·홈(다른 대상은 흐리게) */}
              {kind === 'plank' && <path d={[polyD(nums.outline), ...nums.holes.map(polyD)].join(' ')} fill="#ffffff" fillRule="evenodd" stroke="none" />}
              {nums.slots.map((s, i) => <path key={`s${i}`} d={polyD(s)} fill="#dfe8f7" stroke={target.k === 'slot' && target.i === i ? '#2266e8' : '#9db4d8'} strokeDasharray="5 3" />)}
              {nums.holes.map((h, i) => <path key={`h${i}`} d={polyD(h)} fill="none" stroke={target.k === 'hole' && target.i === i ? '#2266e8' : '#8a93a0'} strokeWidth={1.4} />)}
              <path d={polyD(nums.outline)} fill={kind === 'plank' ? 'none' : 'none'} stroke={target.k === 'outline' ? '#2b3340' : '#8a93a0'} strokeWidth={1.6} />
              {/* 선 — 왼쪽 클릭: 점 추가 */}
              {curNum && curNum.points.map((p, i) => {
                if (i >= (curNum.closed ? curNum.points.length : curNum.points.length - 1)) return null;
                const q = curNum.points[(i + 1) % curNum.points.length];
                return <line key={`l${i}`} x1={sx(p.x)} y1={sy(p.y)} x2={sx(q.x)} y2={sy(q.y)} stroke="transparent" strokeWidth={10}
                  style={{ cursor: tool === 'select' ? 'copy' : 'crosshair' }} onPointerDown={(e) => addOnLine(e, i)}><title>클릭: 점 추가</title></line>;
              })}
              {/* 직각 가이드 */}
              {guide?.lines.map(([a, b], k) => <line key={`g${k}`} x1={sx(a[0])} y1={sy(a[1])} x2={sx(b[0])} y2={sy(b[1])} stroke="#e5484d" strokeWidth={1} strokeDasharray="5 4" pointerEvents="none" />)}
              {guide?.marks.map((mk, k) => <polyline key={`m${k}`} points={mk.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="none" stroke="#e5484d" strokeWidth={1.5} pointerEvents="none" />)}
              {/* 꼭짓점 번호 */}
              {curNum && curNum.points.map((p, i) => (
                <g key={`p${i}`} onPointerDown={(e) => startPtDrag(e, i)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); delPoint(i); }} style={{ cursor: 'move' }}>
                  <title>{`점${i + 1} — 끌기: 이동(직각 스냅) · Ctrl/Shift 클릭: 여러 점 선택 · 오른쪽 클릭: 삭제`}</title>
                  <circle cx={sx(p.x)} cy={sy(p.y)} r={isSel(i) ? 6 : 4.5} fill={isSel(i) ? '#2266e8' : '#fff'} stroke="#2266e8" strokeWidth={1.5} />
                  <text x={sx(p.x) + 7} y={sy(p.y) - 7} fontSize={11} fill="#4b5563">{i + 1}</text>
                </g>
              ))}
              {boxSel && <rect x={Math.min(boxSel.x0, boxSel.x1)} y={Math.min(boxSel.y0, boxSel.y1)} width={Math.abs(boxSel.x1 - boxSel.x0)} height={Math.abs(boxSel.y1 - boxSel.y0)}
                fill="rgba(34,102,232,.08)" stroke="#2266e8" strokeDasharray="4 3" pointerEvents="none" />}
              {/* 자 눈금 */}
              <rect x={0} y={0} width={box.w} height={18} fill="#fafafa" />
              <rect x={0} y={0} width={18} height={box.h} fill="#fafafa" />
              {ticksX.map((x) => <g key={`tx${x}`}><line x1={sx(x)} x2={sx(x)} y1={10} y2={18} stroke="#9aa2ad" /><text x={sx(x) + 2} y={9} fontSize={9} fill="#7a8494">{x}</text></g>)}
              {ticksY.map((y) => <g key={`ty${y}`}><line y1={sy(y)} y2={sy(y)} x1={10} x2={18} stroke="#9aa2ad" /><text x={1} y={sy(y) - 2} fontSize={9} fill="#7a8494">{y}</text></g>)}
            </svg>
            {shapeKey && (
              <PreviewPanel shapeKey={shapeKey} />
            )}
            <div className="pm-pe-zoom">
              <button className="pm-icon" title="화면 맞춤" aria-label="화면 맞춤" onClick={fitView}>⛶</button>
              <button className="pm-icon" title="축소" aria-label="축소" onClick={() => setView({ ...v, scale: v.scale / 1.25 })}>−</button>
              <button className="pm-icon" title="확대" aria-label="확대" onClick={() => setView({ ...v, scale: v.scale * 1.25 })}>＋</button>
            </div>
            <div className="pm-pe-help">선 클릭: 점 추가 · 점 끌기: 이동(직각 가이드 스냅) · Ctrl/Shift 클릭·Shift+끌기: 여러 점 선택 · 오른쪽 클릭/Delete: 삭제 · 빈 곳 끌기: 화면 이동 · 휠: 확대/축소</div>
            {msg && <div className="pm-toast" style={{ top: 30 }} onClick={() => setMsg(null)}>{msg}</div>}
          </div>

          <nav className="pm-pe-strip" aria-label="도구 · 대상">
            <button className={tool === 'select' ? 'on' : ''} title="선택 — 점 끌기: 이동(직각 스냅) · 선 클릭: 점 추가 · 점 오른쪽 클릭: 삭제" onClick={() => setTool('select')}><i>⌖</i>선택</button>
            <button className={tool === 'draw' ? 'on' : ''} title="그리기 — 캔버스를 누르면 꼭짓점 추가" onClick={() => setTool('draw')}><i>✎</i>그리기</button>
            <hr />
            <button className={target.k === 'outline' ? 'on' : ''} title={kind === 'plank' ? '외곽 윤곽' : '경로'} onClick={() => { setTarget({ k: 'outline' }); setSelPt(null); }}><i>▢</i>{kind === 'plank' ? '윤곽' : section ? '단면' : '경로'}</button>
            {doc.holes.map((_, i) => <button key={`h${i}`} className={target.k === 'hole' && target.i === i ? 'on' : ''} onClick={() => { setTarget({ k: 'hole', i }); setSelPt(null); }}><i>◯</i>구멍{i + 1}</button>)}
            {doc.slots.map((_, i) => <button key={`s${i}`} className={target.k === 'slot' && target.i === i ? 'on' : ''} onClick={() => { setTarget({ k: 'slot', i }); setSelPt(null); }}><i>▭</i>홈{i + 1}</button>)}
            {kind === 'plank' && <>
              <hr />
              <button title="구멍(관통) 추가" onClick={() => { const b = bounds(polyOf(outlineNum)); const cx = round((b.x0 + b.x1) / 2), cy = round((b.y0 + b.y1) / 2); push({ ...doc, holes: [...doc.holes, rectPath(String(cx), String(cy), '50', '50', 'c')] }); setTarget({ k: 'hole', i: doc.holes.length }); }}><i>＋</i>구멍</button>
              <button title="홈(판 면을 파는 홈) 추가" onClick={() => { const b = bounds(polyOf(outlineNum)); const cx = round((b.x0 + b.x1) / 2), cy = round((b.y0 + b.y1) / 2); push({ ...doc, slots: [...doc.slots, { path: rectPath(String(cx), String(cy), '100', '10', 'c'), depth: '5', face: 'top' }] }); setTarget({ k: 'slot', i: doc.slots.length }); }}><i>＋</i>홈</button>
            </>}
          </nav>

          <aside className="pm-pe-side">
            <div className="top">
              <select className="pm-sel" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label={section ? '단면 템플릿' : '형상 템플릿'}>
                <option value="custom">사용자 정의 형상</option>
                {section ? SECTION_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>) : <option value="rect">사각형</option>}
              </select>
              <button className="pm-icon" title="경로 복사" aria-label="경로 복사" onClick={copyPath}>⧉</button>
              <button className="pm-icon" title="도형 붙여넣기" aria-label="도형 붙여넣기" onClick={pastePath}>📋</button>
              <label className="pm-icon" title="CAD(DXF) 가져오기" aria-label="DXF 가져오기" style={{ cursor: 'pointer' }}>⇪<input type="file" accept=".dxf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDxf(f); e.target.value = ''; }} /></label>
            </div>
            {!section && tpl === 'rect' && (
              <div className="pm-pe-tpl">
                <span className="pm-hint">사각형 — 기준점 · 위치 · 폭 · 높이 (현재 대상의 점을 바꿉니다) <Unverified text="기준 방식 목록 미확인" /></span>
                <div className="pm-row2"><span>기준점</span>
                  <select className="pm-sel" value={rect.anchor} onChange={(e) => setRect({ ...rect, anchor: e.target.value as RectAnchor })}>
                    <option value="lb">왼쪽 아래</option><option value="lt">왼쪽 위</option><option value="rb">오른쪽 아래</option><option value="rt">오른쪽 위</option><option value="c">가운데</option>
                  </select></div>
                <div className="pm-row2"><span>기준 X</span><div><Fx title="기준 X" value={rect.x} onChange={(x) => setRect({ ...rect, x })} /></div></div>
                <div className="pm-row2"><span>기준 Y</span><div><Fx title="기준 Y" value={rect.y} onChange={(y) => setRect({ ...rect, y })} /></div></div>
                <div className="pm-row2"><span>폭</span><div><Fx title="폭" value={rect.w} onChange={(w) => setRect({ ...rect, w })} /></div></div>
                <div className="pm-row2"><span>높이</span><div><Fx title="높이" value={rect.h} onChange={(h) => setRect({ ...rect, h })} /></div></div>
                <button className="pm-btn blue" onClick={applyTemplate}>적용</button>
              </div>
            )}
            {section && tpl !== 'custom' && (() => {
              const t = SECTION_TEMPLATES.find((x) => x.key === tpl);
              return t ? (
                <div className="pm-pe-tpl">
                  <span className="pm-hint">{t.name} — {t.desc} (mm · 지금 단면을 바꿉니다)</span>
                  {t.fields.map((f) => (
                    <div className="pm-row2" key={f.k}><span>{f.label}</span>
                      <div><input className="pm-in" inputMode="decimal" aria-label={`${t.name} ${f.label}`} value={secVals[`${t.key}.${f.k}`] ?? String(f.v)}
                        onChange={(e) => setSecVals((s) => ({ ...s, [`${t.key}.${f.k}`]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') applySection(); }} /></div></div>
                  ))}
                  <button className="pm-btn blue" onClick={applySection}>적용</button>
                </div>
              ) : null;
            })()}
            <div className="pm-pe-pts">
              {kind === 'line' && !section && target.k === 'outline' && (
                <label className="pm-check"><input type="checkbox" checked={path.closed} onChange={(e) => push(withPath(doc, target, { ...path, closed: e.target.checked }))} />닫힌 경로</label>
              )}
              {target.k === 'slot' && (
                <div className="pm-pe-detail" style={{ gridColumn: 'auto' }}>
                  <div className="pm-row2"><span>홈 깊이</span><div><Fx title="홈 깊이" value={doc.slots[target.i].depth} onChange={(x) => push({ ...doc, slots: doc.slots.map((s, i) => (i === target.i ? { ...s, depth: x } : s)) })} /></div></div>
                  <div className="pm-row2"><span>면</span><select className="pm-sel" value={doc.slots[target.i].face} onChange={(e) => push({ ...doc, slots: doc.slots.map((s, i) => (i === target.i ? { ...s, face: e.target.value as 'top' | 'bottom' } : s)) })}><option value="top">윗면</option><option value="bottom">아랫면</option></select></div>
                  <span className="pm-hint">홈 저장 형식은 쿠지알러 관찰 표본이 없어 HP3 형식(깊이·면)으로 저장합니다<Unverified /></span>
                </div>
              )}
              {target.k !== 'outline' && (
                <button className="pm-btn xs danger" style={{ alignSelf: 'flex-start' }} onClick={() => {
                  push(target.k === 'hole' ? { ...doc, holes: doc.holes.filter((_, i) => i !== target.i) } : { ...doc, slots: doc.slots.filter((_, i) => i !== target.i) });
                  setTarget({ k: 'outline' });
                }}>{target.k === 'hole' ? `구멍${target.i + 1}` : `홈${target.i + 1}`} 삭제</button>
              )}
              {sel.length > 1 && (
                <MultiEdit key={sel.join(',')} ev={ev} count={sel.length} label={[...sel].sort((a, b) => a - b).map((k) => k + 1).join(', ')}
                  common={sel.every((k) => path.points[k].type === path.points[sel[0]].type) ? path.points[sel[0]].type : null}
                  onCorner={applyCorner} onMove={moveSel} onClear={() => setSel([])} onDelete={() => delPoints(sel)}
                  canDelete={path.points.length - sel.length >= (path.closed ? 3 : 2)} />
              )}
              <div className="pm-pe-head"><span /><span>가로축(X)</span><span>세로축(Y)</span>
                <button className="pm-icon" title="전체 선택 (Ctrl+A)" aria-label="점 전체 선택" onClick={() => setSel(sel.length === path.points.length ? [] : path.points.map((_, k) => k))}>☑</button></div>
              {path.points.map((p, i) => {
                const px = previewOf(ev, p.x), py = previewOf(ev, p.y);
                return (
                  <div key={i}>
                    <div className={`pm-pe-pt ${isSel(i) ? 'on' : ''}`}>
                      <span title="클릭: 선택 · Ctrl 클릭: 여러 점 · Shift 클릭: 범위" onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) toggleSel(i);
                        else if (e.shiftKey && sel.length) { const a = sel[sel.length - 1], lo = Math.min(a, i), hi = Math.max(a, i); setSel([...sel.filter((k) => k < lo || k > hi), ...Array.from({ length: hi - lo + 1 }, (_, n) => lo + n)]); }
                        else setSelPt(selPt === i ? null : i);
                      }}>점{i + 1}{p.type === 1 ? ' ◜' : p.type === 2 ? ' ◺' : ''}</span>
                      <div><Fx title={`점${i + 1} X`} value={p.x} onChange={(x) => setPoint(i, { x })} error={px.error} /></div>
                      <div><Fx title={`점${i + 1} Y`} value={p.y} onChange={(y) => setPoint(i, { y })} error={py.error} /></div>
                      <button className="pm-icon" title="꼭짓점 설정" aria-label={`점${i + 1} 설정`} onClick={() => setSelPt(selPt === i ? null : i)}>⋮</button>
                    </div>
                    {selPt === i && selP && (
                      <div className="pm-pe-detail">
                        <div className="pm-row2"><span>모서리 종류</span>
                          <select className="pm-sel" value={selP.type} onChange={(e) => setPoint(i, { type: Number(e.target.value) as 0 | 1 | 2, radius: selP.radius ?? '10', chamferA: selP.chamferA ?? '10', chamferB: selP.chamferB ?? '10' })}>
                            <option value={0}>직각</option><option value={1}>둥근 모서리(圆角)</option><option value={2}>모따기(切角)</option>
                          </select></div>
                        {selP.type === 1 && <div className="pm-row2"><span>반지름</span><div><Fx title={`점${i + 1} 반지름`} value={selP.radius ?? ''} onChange={(r) => setPoint(i, { radius: r })} /></div></div>}
                        {selP.type === 2 && <>
                          <div className="pm-row2"><span>길이 a</span><div><Fx title={`점${i + 1} 모따기 a`} value={selP.chamferA ?? ''} onChange={(a) => setPoint(i, { chamferA: a })} /></div></div>
                          <div className="pm-row2"><span>길이 b</span><div><Fx title={`점${i + 1} 모따기 b`} value={selP.chamferB ?? ''} onChange={(b) => setPoint(i, { chamferB: b })} /></div></div>
                          <span className="pm-hint">a = 이전 점 쪽, b = 다음 점 쪽 잘라낼 길이. 모따기 저장 형식은 쿠지알러 표본 미관찰<Unverified /></span>
                        </>}
                        {selL && lineIdx === i && <><b style={{ fontSize: 11.5, color: '#4b5563' }}>점{i + 1} → 점{(i + 1) % path.points.length + 1} 선</b><LineDetail ev={ev} idx={i} line={selL} onChange={(l) => setLine(i, l)} /></>}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="pm-btn xs" onClick={() => addPoint(i + 1)}>뒤에 점 넣기</button>
                          <button className="pm-btn xs danger" disabled={path.points.length <= (path.closed ? 3 : 2)} onClick={() => delPoint(i)}>점 삭제</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <button className="pm-btn" style={{ alignSelf: 'flex-start' }} onClick={() => addPoint()}>＋ 꼭짓점 추가</button>
            </div>
            {target.k === 'outline' && (
              <div className="pm-pe-foot">
                <label className="pm-check"><input type="checkbox" checked={!!path.offset} onChange={(e) => push(withPath(doc, target, { ...path, offset: e.target.checked ? '0' : undefined }))} />오프셋</label>
                <Fx title="오프셋" value={path.offset ?? ''} disabled={path.offset == null} placeholder="오프셋 값 (양수 = 바깥쪽)" onChange={(o) => push(withPath(doc, target, { ...path, offset: o }))} />
              </div>
            )}
          </aside>
        </div>
        {confirmExit && <Confirm text="아직 저장하지 않았습니다. 편집을 끝낼까요?" ok="나가기" onCancel={() => setConfirmExit(false)} onOk={() => { setConfirmExit(false); onClose(); }} />}
      </div>
    </div>
  );
}

/** 여러 점 일괄 편집 — 모서리 종류(직각 · 둥근 모서리 반지름 · 모따기 a/b) 한꺼번에, 함께 옮기기, 선택 삭제 */
function MultiEdit({ ev, count, label, common, onCorner, onMove, onClear, onDelete, canDelete }: {
  ev: PmEval; count: number; label: string; common: 0 | 1 | 2 | null;
  onCorner: (type: 0 | 1 | 2, r: string, a: string, b: string) => void; onMove: (dx: number, dy: number) => void;
  onClear: () => void; onDelete: () => void; canDelete: boolean;
}) {
  const [type, setType] = useState<0 | 1 | 2>(common ?? 1);
  const [r, setR] = useState('10');
  const [a, setA] = useState('10');
  const [b, setB] = useState('10');
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');
  const n = (e: string) => { const t = previewOf(ev, e); return t.text != null && !Number.isNaN(Number(t.text)) ? Number(t.text) : NaN; };
  return (
    <div className="pm-pe-multi">
      <div><b>선택한 점 {count}개</b> <small>(점 {label})</small></div>
      <div className="pm-row2"><span>모서리 종류</span>
        <select className="pm-sel" value={type} onChange={(e) => setType(Number(e.target.value) as 0 | 1 | 2)} aria-label="선택한 점 모서리 종류">
          <option value={0}>직각</option><option value={1}>둥근 모서리(圆角)</option><option value={2}>모따기(切角)</option>
        </select></div>
      {type === 1 && <div className="pm-row2"><span>반지름</span><div><Fx title="선택한 점 반지름" value={r} onChange={setR} preview={previewOf(ev, r).text} /></div></div>}
      {type === 2 && <>
        <div className="pm-row2"><span>길이 a</span><div><Fx title="선택한 점 모따기 a" value={a} onChange={setA} /></div></div>
        <div className="pm-row2"><span>길이 b</span><div><Fx title="선택한 점 모따기 b" value={b} onChange={setB} /></div></div>
      </>}
      <button className="pm-btn blue" onClick={() => onCorner(type, r, a, b)}>모서리 {count}개에 적용</button>
      <div className="pm-row2"><span>X 이동</span><div><Fx title="선택한 점 X 이동" value={dx} onChange={setDx} unit="mm" /></div></div>
      <div className="pm-row2"><span>Y 이동</span><div><Fx title="선택한 점 Y 이동" value={dy} onChange={setDy} unit="mm" /></div></div>
      <button className="pm-btn" disabled={Number.isNaN(n(dx)) || Number.isNaN(n(dy)) || (n(dx) === 0 && n(dy) === 0)} onClick={() => onMove(n(dx), n(dy))}>함께 이동 — 수식 좌표는 이동량을 더함</button>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="pm-btn xs" onClick={onClear}>선택 해제 (Esc)</button>
        <button className="pm-btn xs danger" disabled={!canDelete} onClick={onDelete}>선택 삭제 (Delete)</button>
      </div>
    </div>
  );
}

type ZoomCmd = { seq: number; kind: 'in' | 'out' | 'fit' };
const PREV_KEY = 'hp3-pm-preview-size';
type PrevBox = { w: number; h: number; right: number; top: number };
function loadPrevSize(): PrevBox {
  try {
    const v = JSON.parse(localStorage.getItem(PREV_KEY) ?? 'null') as Partial<PrevBox> | null;
    if (v && v.w! > 0 && v.h! > 0) return { w: v.w!, h: v.h!, right: v.right ?? 10, top: v.top ?? 28 };
  } catch { /* 저장값이 없거나 읽을 수 없으면 기본 */ }
  return { w: 260, h: 190, right: 10, top: 28 };
}

/**
 * 오른쪽 위 3D 미리보기 창 — 윤곽을 두께만큼 세운 판(단면 그리기는 단면을 300mm 세운 몰딩).
 * 왼쪽 아래 모서리를 끌어 창 크기 조절(크기는 이 브라우저에 기억), 휠 · ＋/− 로 확대·축소, 끌어서 회전, ⛶ 로 처음 시점.
 */
function PreviewPanel({ shapeKey }: { shapeKey: string }) {
  const [open, setOpen] = useState(true);
  const [size, setSize] = useState(loadPrevSize);
  const [cmd, setCmd] = useState<ZoomCmd>({ seq: 0, kind: 'fit' });
  const zoom = (kind: ZoomCmd['kind']) => setCmd((c) => ({ seq: c.seq + 1, kind }));
  useEffect(() => { try { localStorage.setItem(PREV_KEY, JSON.stringify(size)); } catch { /* 기억 못 해도 동작 */ } }, [size]);
  const startResize = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const area = (e.currentTarget.closest('.pm-pe-canvas') as HTMLElement | null)?.getBoundingClientRect();
    const maxW = (area?.width ?? 900) * 0.85, maxH = (area?.height ?? 600) * 0.9;
    const sx = e.clientX, sy = e.clientY, w0 = size.w, h0 = size.h;
    const move = (ev: PointerEvent) => setSize((b) => ({
      ...b,
      w: Math.round(Math.max(170, Math.min(maxW, w0 + (sx - ev.clientX)))),
      h: Math.round(Math.max(120, Math.min(maxH, h0 + (ev.clientY - sy)))),
    }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** 머리줄을 끌어 창 옮기기 — 점을 가리지 않게 */
  const startMove = (e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const area = (e.currentTarget.closest('.pm-pe-canvas') as HTMLElement | null)?.getBoundingClientRect();
    const aw = area?.width ?? 900, ah = area?.height ?? 600;
    const sx = e.clientX, sy = e.clientY, r0 = size.right, t0 = size.top;
    const move = (ev: PointerEvent) => setSize((b) => ({
      ...b,
      right: Math.round(Math.max(0, Math.min(aw - 120, r0 - (ev.clientX - sx)))),
      top: Math.round(Math.max(0, Math.min(ah - 40, t0 + (ev.clientY - sy)))),
    }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`pm-pe-prev ${open ? '' : 'closed'}`} style={open ? { width: size.w, height: size.h, right: size.right, top: size.top } : { right: size.right, top: size.top }}>
      <header onPointerDown={startMove} title="끌어서 옮기기">
        <span>3D 미리보기</span>
        {open && <>
          <button className="pm-icon" title="축소" aria-label="미리보기 축소" onClick={() => zoom('out')}>−</button>
          <button className="pm-icon" title="확대" aria-label="미리보기 확대" onClick={() => zoom('in')}>＋</button>
          <button className="pm-icon" title="맞춤 — 처음 시점으로" aria-label="미리보기 맞춤" onClick={() => zoom('fit')}>⛶</button>
        </>}
        <button className="pm-icon" title={open ? '접기' : '펼치기'} aria-label={open ? '3D 미리보기 접기' : '3D 미리보기 펼치기'} onClick={() => setOpen(!open)}>{open ? '–' : '▣'}</button>
      </header>
      {open && <div className="cv"><PlankPreview shapeKey={shapeKey} cmd={cmd} /></div>}
      {open && <div className="pm-pe-prev-grip" title="끌어서 크기 조절" aria-label="미리보기 크기 조절" role="separator" onPointerDown={startResize} />}
    </div>
  );
}

function PlankPreview({ shapeKey, cmd }: { shapeKey: string; cmd: ZoomCmd }) {
  const { geo, pb, pr, t } = useMemo(() => {
    const [o, hs, th] = JSON.parse(shapeKey) as [NumPathOut, NumPathOut[], number];
    const outline = polyOf(o);
    const b = bounds(outline);
    return { geo: plankGeometry(outline, hs.map(polyOf), Math.max(th, 1)), pb: b, pr: Math.max(b.x1 - b.x0, b.y1 - b.y0, th, 10), t: th };
  }, [shapeKey]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <Canvas camera={{ position: [pr * 0.9, -pr * 1.1, pr * 0.9], up: [0, 0, 1], near: 1, far: pr * 60 }}>
      <ambientLight intensity={0.8} /><directionalLight position={[1, -2, 3]} intensity={1} />
      <mesh geometry={geo} position={[-(pb.x0 + pb.x1) / 2, -(pb.y0 + pb.y1) / 2, -t / 2]}><meshStandardMaterial color="#c9a77c" side={DoubleSide} /></mesh>
      <PreviewCam pr={pr} cmd={cmd} />
    </Canvas>
  );
}

/** 미리보기 시점 — ＋/− 는 지금 보는 방향 그대로 거리만, ⛶ 는 처음 시점. 휠 확대·축소와 회전은 OrbitControls */
function PreviewCam({ pr, cmd }: { pr: number; cmd: ZoomCmd }) {
  const camera = useThree((st) => st.camera);
  const controls = useThree((st) => st.controls) as unknown as { target: Vector3; update: () => void } | null;
  const done = useRef(-1);
  useEffect(() => {
    if (!controls || done.current === cmd.seq) return;
    done.current = cmd.seq;
    if (cmd.kind === 'fit') {
      controls.target.set(0, 0, 0);
      camera.position.set(pr * 0.9, -pr * 1.1, pr * 0.9);
    } else {
      const off = camera.position.clone().sub(controls.target).multiplyScalar(cmd.kind === 'in' ? 1 / 1.3 : 1.3);
      camera.position.copy(controls.target).add(off);
    }
    controls.update();
  }, [cmd, camera, controls, pr]);
  return <OrbitControls makeDefault enableZoom zoomSpeed={0.9} minDistance={pr * 0.12} maxDistance={pr * 20} />;
}

function LineDetail({ ev, idx, line, onChange }: { ev: PmEval; idx: number; line: PathLine; onChange: (l: Partial<PathLine>) => void }) {
  const pv = previewOf(ev, line.radius);
  return (
    <>
      <div className="pm-row2"><span>선 종류</span>
        <select className="pm-sel" value={line.type} aria-label={`선 ${idx + 1} 종류`} onChange={(e) => onChange({ type: Number(e.target.value) as 0 | 1, radius: line.radius ?? '100', minor: line.minor ?? true, clockwise: line.clockwise ?? false })}>
          <option value={0}>직선</option><option value={1}>원호(圆弧)</option>
        </select></div>
      {line.type === 1 && <>
        <div className="pm-row2"><span>반지름</span><div><Fx title={`선 ${idx + 1} 반지름`} value={line.radius ?? ''} onChange={(r) => onChange({ radius: r })} preview={pv.text} error={pv.error} /></div></div>
        <label className="pm-check"><input type="checkbox" checked={!!line.clockwise} onChange={(e) => onChange({ clockwise: e.target.checked })} />시계 방향</label>
        <label className="pm-check"><input type="checkbox" checked={line.minor !== false} onChange={(e) => onChange({ minor: e.target.checked })} />짧은 호(劣弧)</label>
        <span className="pm-hint">현 길이·호 높이로 반지름: #rad(현 길이, 호 높이). 원호 선 저장 형식은 쿠지알러 표본 미관찰<Unverified /></span>
      </>}
    </>
  );
}
