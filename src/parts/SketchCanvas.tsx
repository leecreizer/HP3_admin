import { useEffect, useRef, useState } from 'react';
import type { Profile, Vec2, Corner } from './types';
import { outlinePoints, filletCorner } from './partGeometry';

const SNAP = 10; // mm — 놓을 때 격자 스냅 간격
const ALIGN_PX = 8; // 정렬 스냅 허용 오차(화면 px)
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const snapPt = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];

function corners(profile: Profile): Corner[] {
  return profile.contours[0]?.corners ?? [];
}
function build(profile: Profile, cs: Corner[]): Profile {
  return { ...profile, contours: [{ closed: true, corners: cs }, ...profile.contours.slice(1)] };
}

/** 드래그 상태: 정점 하나 또는 변(두 정점) 이동. 시작 시점 좌표를 담아 delta로 이동. */
type DragInfo =
  | { kind: 'vertex'; index: number; startCursor: Vec2; startPts: Vec2[] }
  | { kind: 'edge'; index: number; startCursor: Vec2; startPts: Vec2[]; startClient: [number, number]; moved: boolean };

/** 정렬 가이드 — 이동 점 기준 확장선(axis,v)과 다른 점에 스냅됐는지(snap). */
type Guide = { axis: 'x' | 'y'; v: number; snap: boolean };

export function SketchCanvas({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const cs = corners(profile);
  const n = cs.length;
  const verts = cs.map((c) => c.pt);
  const [sel, setSel] = useState<number | null>(null);
  const [selEdge, setSelEdge] = useState<number | null>(null);

  const W = 800, H = 600, PAD = 40;
  const xs = verts.map((p) => p[0]); const ys = verts.map((p) => p[1]);
  const minX0 = Math.min(0, ...xs), maxX0 = Math.max(100, ...xs);
  const minY0 = Math.min(0, ...ys), maxY0 = Math.max(100, ...ys);
  const sx = (W - PAD * 2) / Math.max(1, maxX0 - minX0);
  const sy = (H - PAD * 2) / Math.max(1, maxY0 - minY0);
  const s0 = Math.min(sx, sy);

  const [frozen, setFrozen] = useState<{ minX: number; minY: number; s: number } | null>(null);
  const tMinX = frozen ? frozen.minX : minX0;
  const tMinY = frozen ? frozen.minY : minY0;
  const tS = frozen ? frozen.s : s0;
  const toPx = (p: Vec2): [number, number] => [PAD + (p[0] - tMinX) * tS, H - PAD - (p[1] - tMinY) * tS];
  const toMm = (px: number, py: number): Vec2 => [
    Math.round((px - PAD) / tS + tMinX),
    Math.round((H - PAD - py) / tS + tMinY),
  ];

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragInfo | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: W, h: H });
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);

  const clientToLocal = (clientX: number, clientY: number): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  const clientToMm = (clientX: number, clientY: number): Vec2 | null => {
    const l = clientToLocal(clientX, clientY);
    return l ? toMm(l[0], l[1]) : null;
  };

  // 휠 줌
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;
      setView((v) => {
        const f = e.deltaY < 0 ? 0.9 : 1 / 0.9;
        const nw = Math.min(W * 4, Math.max(W * 0.1, v.w * f));
        const nh = nw * (H / W);
        const px = v.x + mx * v.w, py = v.y + my * v.h;
        return { x: px - mx * nw, y: py - my * nh, w: nw, h: nh };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const setCorners = (updater: (cs: Corner[]) => Corner[]) => onChange(build(profile, updater(cs)));
  const setCorner = (i: number, patch: Partial<Corner>) =>
    setCorners((c) => c.map((v, k) => (k === i ? { ...v, ...patch } : v)));

  /**
   * 이동 대상 점들의 목표 위치를 받아, 이동하지 않는 다른 정점과 X/Y가 맞으면 스냅한다.
   * 반환: 스냅 적용된 위치들 + 표시할 가이드.
   */
  const applyAlign = (targets: Vec2[], movingIdx: number[]): { pts: Vec2[]; guides: Guide[] } => {
    const tol = ALIGN_PX / tS;
    const others = verts.filter((_, i) => !movingIdx.includes(i));
    // 공통 보정(변 이동 시 두 점이 같은 delta 유지): 첫 정렬되는 축값으로 보정량 계산
    let dx = 0, dy = 0; let snapX = false, snapY = false;
    for (const t of targets) {
      if (!snapX) {
        const m = others.find((o) => Math.abs(t[0] + dx - o[0]) <= tol);
        if (m) { dx = m[0] - t[0]; snapX = true; }
      }
      if (!snapY) {
        const m = others.find((o) => Math.abs(t[1] + dy - o[1]) <= tol);
        if (m) { dy = m[1] - t[1]; snapY = true; }
      }
    }
    const pts = targets.map((t): Vec2 => [t[0] + dx, t[1] + dy]);
    const g: Guide[] = [];
    for (const p of pts) {
      g.push({ axis: 'x', v: p[0], snap: snapX });
      g.push({ axis: 'y', v: p[1], snap: snapY });
    }
    return { pts, guides: g };
  };

  const startVertexDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setSel(i); setSelEdge(null);
    const m = clientToMm(e.clientX, e.clientY) ?? verts[i];
    dragRef.current = { kind: 'vertex', index: i, startCursor: m, startPts: [verts[i]] };
    setFrozen({ minX: minX0, minY: minY0, s: s0 });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const startEdgeDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setSelEdge(i); setSel(null);
    const m = clientToMm(e.clientX, e.clientY) ?? verts[i];
    dragRef.current = { kind: 'edge', index: i, startCursor: m, startPts: [verts[i], verts[(i + 1) % n]], startClient: [e.clientX, e.clientY], moved: false };
    setFrozen({ minX: minX0, minY: minY0, s: s0 });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  /** 변 i의 위치 P에 새 꼭지점 삽입(클릭 추가). */
  const insertOnEdge = (i: number, P: Vec2) => {
    const nc = [...cs]; nc.splice(i + 1, 0, { pt: snapPt(P) });
    onChange(build(profile, nc));
    setSelEdge(null); setSel(i + 1);
  };
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current) return;
    setSel(null); setSelEdge(null);
    panRef.current = { lastX: e.clientX, lastY: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const dr = dragRef.current;
    if (dr) {
      const m = clientToMm(e.clientX, e.clientY);
      if (!m) return;
      const dxm = m[0] - dr.startCursor[0], dym = m[1] - dr.startCursor[1];
      if (dr.kind === 'vertex') {
        const target: Vec2 = [dr.startPts[0][0] + dxm, dr.startPts[0][1] + dym];
        const { pts, guides: g } = applyAlign([target], [dr.index]);
        setCorner(dr.index, { pt: pts[0] });
        setGuides(g);
      } else {
        // 임계값 이전엔 클릭(점 추가) 후보로 보고 이동하지 않음
        const dpx = Math.hypot(e.clientX - dr.startClient[0], e.clientY - dr.startClient[1]);
        if (!dr.moved && dpx < 4) return;
        dr.moved = true;
        const targets: Vec2[] = dr.startPts.map((s): Vec2 => [s[0] + dxm, s[1] + dym]);
        const j = (dr.index + 1) % n;
        const { pts, guides: g } = applyAlign(targets, [dr.index, j]);
        setCorners((c) => c.map((v, k) => (k === dr.index ? { ...v, pt: pts[0] } : k === j ? { ...v, pt: pts[1] } : v)));
        setGuides(g);
      }
      return;
    }
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dxPx = e.clientX - panRef.current.lastX;
      const dyPx = e.clientY - panRef.current.lastY;
      panRef.current = { lastX: e.clientX, lastY: e.clientY };
      setView((v) => ({ ...v, x: v.x - dxPx * (v.w / rect.width), y: v.y - dyPx * (v.h / rect.height) }));
    }
  };
  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    const dr = dragRef.current;
    if (dr) {
      // 놓을 때 격자 스냅(정렬로 이미 맞은 좌표는 그리드로 반올림)
      if (dr.kind === 'vertex') setCorner(dr.index, { pt: snapPt(verts[dr.index]) });
      else if (!dr.moved) {
        // 이동 없이 클릭만 → 변 위 클릭 지점에 점 추가
        dragRef.current = null; setGuides([]); setFrozen(null);
        svgRef.current?.releasePointerCapture(e.pointerId);
        insertOnEdge(dr.index, dr.startCursor);
        return;
      } else {
        const j = (dr.index + 1) % n;
        setCorners((c) => c.map((v, k) => (k === dr.index || k === j ? { ...v, pt: snapPt(v.pt) } : v)));
      }
      dragRef.current = null;
      setGuides([]);
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    if (panRef.current) {
      panRef.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    setFrozen(null);
  };
  const resetView = () => setView({ x: 0, y: 0, w: W, h: H });

  const delPoint = () => {
    if (sel == null || n <= 3) return;
    onChange(build(profile, cs.filter((_, i) => i !== sel)));
    setSel(null);
  };
  const editCoord = (axis: 0 | 1, v: number) => {
    if (sel == null) return;
    const p = verts[sel];
    setCorner(sel, { pt: axis === 0 ? [v, p[1]] : [p[0], v] });
  };

  const outline = n > 0 ? outlinePoints({ closed: true, corners: cs }) : [];
  const poly = outline.map(toPx).map(([x, y]) => `${x},${y}`).join(' ');
  const selR = sel != null ? (cs[sel].r ?? 0) : 0;

  // 가이드/스냅선 렌더용: 현재 보이는 뷰(viewBox) 범위 전체를 가로지르게
  const vb = view;
  const guideLine = (g: Guide, i: number) => {
    const stroke = g.snap ? '#f80' : '#7aa';
    if (g.axis === 'x') {
      const [px] = toPx([g.v, 0]);
      return <line key={`gx${i}`} x1={px} y1={vb.y} x2={px} y2={vb.y + vb.h}
        stroke={stroke} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
    }
    const [, py] = toPx([0, g.v]);
    return <line key={`gy${i}`} x1={vb.x} y1={py} x2={vb.x + vb.w} y2={py}
      stroke={stroke} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%" height={H} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ background: '#f5f5f2', border: '1px solid #ccc', flex: 1, touchAction: 'none' }}
        onPointerDown={startPan}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {guides.map(guideLine)}
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {/* 변(edge) 히트/선택 — 정점 사이 직선(필렛 전) */}
        {verts.map((p, i) => {
          const q = verts[(i + 1) % n];
          const [x1, y1] = toPx(p); const [x2, y2] = toPx(q);
          return (
            <line
              key={`e${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={selEdge === i ? '#e06' : 'transparent'}
              strokeWidth={selEdge === i ? 3 : 12} vectorEffect="non-scaling-stroke"
              style={{ cursor: 'move' }}
              onPointerDown={(e) => startEdgeDrag(i, e)}
            />
          );
        })}
        {verts.map((p, i) => {
          const [x, y] = toPx(p);
          const rounded = (cs[i].r ?? 0) > 0;
          return (
            <circle
              key={`v${i}`} cx={x} cy={y} r={7} vectorEffect="non-scaling-stroke"
              fill={sel === i ? '#e06' : rounded ? '#2a8' : '#36c'}
              stroke={rounded ? '#0a5' : 'none'} strokeWidth={rounded ? 2 : 0}
              onPointerDown={(e) => startVertexDrag(i, e)}
              style={{ cursor: 'grab' }}
            />
          );
        })}
        {/* 필렛 접점(곡선 시작·끝) 마커 — R로 라운드된 모서리의 곡선 시·종점 */}
        {verts.map((_, i) => {
          if ((cs[i].r ?? 0) <= 0 || n < 3) return null;
          const prev = verts[(i - 1 + n) % n]; const nextv = verts[(i + 1) % n];
          const arc = filletCorner(prev, verts[i], nextv, cs[i].r);
          if (arc.length < 2) return null;
          const t1 = toPx(arc[0]); const t2 = toPx(arc[arc.length - 1]);
          return (
            <g key={`tp${i}`} pointerEvents="none">
              <circle cx={t1[0]} cy={t1[1]} r={4} fill="#fff" stroke="#0a5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              <circle cx={t2[0]} cy={t2[1]} r={4} fill="#fff" stroke="#0a5" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {/* 점 번호 + 좌표값 라벨 (줌과 무관하게 화면상 크기 유지) */}
        {verts.map((p, i) => {
          const [x, y] = toPx(p);
          const fs = view.w * 0.018; const off = fs * 0.6;
          return (
            <text
              key={`t${i}`} x={x + off} y={y - off} fontSize={fs}
              fill={sel === i ? '#c0055a' : '#234'} stroke="#fff" strokeWidth={fs * 0.14}
              paintOrder="stroke" style={{ pointerEvents: 'none', fontWeight: 700 }}
            >
              {i + 1}: {p[0]},{p[1]}
            </text>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
        <span style={{ color: '#888' }}>변(선)을 클릭해 점 추가</span>
        <button onClick={delPoint} disabled={sel == null || n <= 3}>점 삭제</button>
        <button onClick={resetView} title="화면 맞춤">⤢ 맞춤</button>
        {sel != null && (
          <>
            <span>선택점 X(mm)</span>
            <input type="number" value={verts[sel][0]} style={{ width: 70 }}
              onChange={(e) => editCoord(0, Number(e.target.value))} />
            <span>Y(mm)</span>
            <input type="number" value={verts[sel][1]} style={{ width: 70 }}
              onChange={(e) => editCoord(1, Number(e.target.value))} />
            <span style={{ borderLeft: '1px solid #ddd', paddingLeft: 8 }}>모서리 R(mm)</span>
            <input type="number" min={0} value={selR} style={{ width: 80 }}
              onChange={(e) => setCorner(sel, { r: Math.max(0, Number(e.target.value)) })} />
            {selR > 0
              ? <button onClick={() => setCorner(sel, { r: 0 })}>각지게</button>
              : <span style={{ color: '#888' }}>0 = 각진 모서리</span>}
          </>
        )}
        {sel == null && selEdge != null && <span style={{ color: '#888' }}>변 선택됨 — 드래그로 이동</span>}
        <span style={{ marginLeft: 'auto', color: '#888' }}>스냅 {SNAP}mm · 정렬 자동</span>
      </div>
    </div>
  );
}