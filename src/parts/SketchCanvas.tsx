import { useEffect, useRef, useState } from 'react';
import type { Profile, Vec2, Corner } from './types';
import { outlinePoints } from './partGeometry';

const SNAP = 10; // mm — 놓을 때 격자 스냅 간격
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const snapPt = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];

function corners(profile: Profile): Corner[] {
  return profile.contours[0]?.corners ?? [];
}
/** 꼭지점 목록으로 외곽 컨투어 재구성. */
function build(profile: Profile, cs: Corner[]): Profile {
  return { ...profile, contours: [{ closed: true, corners: cs }, ...profile.contours.slice(1)] };
}

export function SketchCanvas({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const cs = corners(profile);
  const n = cs.length;
  const verts = cs.map((c) => c.pt);
  const [sel, setSel] = useState<number | null>(null);

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
  const [drag, setDrag] = useState<number | null>(null);
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: W, h: H });
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);

  const clientToLocal = (clientX: number, clientY: number): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  // 휠 줌: 커서 지점 고정. React onWheel은 passive라 네이티브로 등록.
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

  const setCorner = (i: number, patch: Partial<Corner>) =>
    onChange(build(profile, cs.map((c, k) => (k === i ? { ...c, ...patch } : c))));

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    setSel(i);
    setDrag(i);
    setFrozen({ minX: minX0, minY: minY0, s: s0 });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag != null) return;
    panRef.current = { lastX: e.clientX, lastY: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag != null) {
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      setCorner(drag, { pt: toMm(local[0], local[1]) });
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
    if (drag != null) {
      setCorner(drag, { pt: snapPt(verts[drag]) });
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    if (panRef.current) {
      panRef.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
    setFrozen(null);
  };
  const resetView = () => setView({ x: 0, y: 0, w: W, h: H });

  const addPoint = () => {
    // 선택 꼭지점 다음(없으면 마지막) 변 중간에 꼭지점 추가
    const e = sel ?? n - 1;
    const a = verts[e]; const b = verts[(e + 1) % n];
    const mid: Vec2 = [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)];
    const nc = [...cs]; nc.splice(e + 1, 0, { pt: mid });
    onChange(build(profile, nc));
  };
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

  // 미리보기 경계: 필렛 전개(3D와 동일한 outlinePoints)
  const outline = n > 0 ? outlinePoints({ closed: true, corners: cs }) : [];
  const poly = outline.map(toPx).map(([x, y]) => `${x},${y}`).join(' ');

  const selR = sel != null ? (cs[sel].r ?? 0) : 0;

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
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} />
        {verts.map((p, i) => {
          const [x, y] = toPx(p);
          const rounded = (cs[i].r ?? 0) > 0;
          return (
            <circle
              key={i} cx={x} cy={y} r={7}
              fill={sel === i ? '#e06' : rounded ? '#2a8' : '#36c'}
              stroke={rounded ? '#0a5' : 'none'} strokeWidth={rounded ? 2 : 0}
              onPointerDown={(e) => startDrag(i, e)}
              style={{ cursor: 'grab' }}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap' }}>
        <button onClick={addPoint}>+ 점 추가</button>
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
        <span style={{ marginLeft: 'auto', color: '#888' }}>스냅 {SNAP}mm</span>
      </div>
    </div>
  );
}