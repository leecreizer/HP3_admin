import { useEffect, useRef, useState } from 'react';
import type { Profile, Vec2, Segment } from './types';
import { sampleArc } from './partGeometry';

const SNAP = 10; // mm — 놓을 때 격자 스냅 간격
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const snapPt = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];

/** 변(edge) 서술 — 정점 i → 정점 (i+1)%n 을 잇는 구간의 종류. */
type Edge = { type: 'line' } | { type: 'arc'; radius: number; ccw: boolean };

/** 외곽 컨투어를 정점(verts) + 변(edges)로 분해. edges[i]는 verts[i]→verts[(i+1)%n]. */
function parseOuter(profile: Profile): { verts: Vec2[]; edges: Edge[] } {
  const c = profile.contours[0];
  if (!c || c.segments.length === 0) return { verts: [], edges: [] };
  const segs = c.segments;
  const n = segs.length; // closed: 마지막 세그먼트의 to === start
  const verts: Vec2[] = [c.start, ...segs.slice(0, n - 1).map((s) => s.to)];
  const edges: Edge[] = segs.map((s) =>
    s.type === 'arc' ? { type: 'arc', radius: s.radius, ccw: !!s.ccw } : { type: 'line' },
  );
  return { verts, edges };
}

/** 정점+변 → 외곽 컨투어(항상 closed). */
function build(profile: Profile, verts: Vec2[], edges: Edge[]): Profile {
  const n = verts.length;
  const segments: Segment[] = verts.map((_, i) => {
    const to = verts[(i + 1) % n];
    const e = edges[i] ?? { type: 'line' };
    return e.type === 'arc'
      ? { type: 'arc', to, radius: e.radius, ccw: e.ccw }
      : { type: 'line', to };
  });
  return { ...profile, contours: [{ closed: true, start: verts[0], segments }, ...profile.contours.slice(1)] };
}

export function SketchCanvas({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const { verts, edges } = parseOuter(profile);
  const n = verts.length;
  const [sel, setSel] = useState<number | null>(null);
  // 선택 정점으로 "들어오는" 변(이전 정점 → 선택 정점). 이 변에 곡선/R을 적용.
  const inEdge = sel == null ? null : (sel - 1 + n) % n;

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
  // 화면 이동/줌을 위한 뷰포트(viewBox). 기본은 0,0,W,H (맞춤 상태).
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: W, h: H });
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);

  const clientToLocal = (clientX: number, clientY: number): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  // 휠 줌: 커서 지점을 고정한 채 확대/축소. React onWheel은 passive라 네이티브로 등록.
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
        const px = v.x + mx * v.w, py = v.y + my * v.h; // 커서 아래 viewBox 좌표
        return { x: px - mx * nw, y: py - my * nh, w: nw, h: nh };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const startDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation(); // 정점 드래그 시 팬 시작 방지
    setSel(i);
    setDrag(i);
    setFrozen({ minX: minX0, minY: minY0, s: s0 });
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  // 빈 공간 포인터다운 → 화면 이동(팬) 시작
  const startPan = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag != null) return;
    panRef.current = { lastX: e.clientX, lastY: e.clientY };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag != null) {
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const m = toMm(local[0], local[1]);
      onChange(build(profile, verts.map((p, i) => (i === drag ? m : p)), edges));
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
      onChange(build(profile, verts.map((p, i) => (i === drag ? snapPt(p) : p)), edges));
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
    // 선택 정점의 다음 변(없으면 닫힘 변)을 절반으로 나눠 점 추가. 나뉜 두 변은 직선.
    const e = sel ?? n - 1;
    const a = verts[e]; const b = verts[(e + 1) % n];
    const mid: Vec2 = [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)];
    const nv = [...verts]; nv.splice(e + 1, 0, mid);
    const ne = [...edges]; ne.splice(e, 1, { type: 'line' }, { type: 'line' });
    onChange(build(profile, nv, ne));
  };
  const delPoint = () => {
    if (sel == null || n <= 3) return;
    const nv = verts.filter((_, i) => i !== sel);
    const ne = edges.filter((_, i) => i !== sel); // 선택 정점의 나가는 변 제거, 들어오는 변이 이어짐
    onChange(build(profile, nv, ne));
    setSel(null);
  };
  const editCoord = (axis: 0 | 1, v: number) => {
    if (sel == null) return;
    onChange(build(profile, verts.map((p, i) => (i === sel ? (axis === 0 ? [v, p[1]] : [p[0], v]) as Vec2 : p)), edges));
  };
  const setEdge = (idx: number, e: Edge) => {
    onChange(build(profile, verts, edges.map((old, i) => (i === idx ? e : old))));
  };

  // 미리보기 폴리곤: 각 변을 직선/원호로 전개한 뒤 px 변환(3D와 동일한 sampleArc 사용).
  const polyMm: Vec2[] = [];
  if (n > 0) {
    polyMm.push(verts[0]);
    for (let i = 0; i < n; i++) {
      const from = verts[i]; const to = verts[(i + 1) % n]; const e = edges[i];
      if (e && e.type === 'arc') polyMm.push(...sampleArc(from, to, e.radius, e.ccw));
      else polyMm.push(to);
    }
  }
  const poly = polyMm.map(toPx).map(([x, y]) => `${x},${y}`).join(' ');

  const inEdgeSpec = inEdge != null ? edges[inEdge] : null;
  const isArc = inEdgeSpec?.type === 'arc';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%" height={H} viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ background: '#f5f5f2', border: '1px solid #ccc', flex: 1, touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'default' }}
        onPointerDown={startPan}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} />
        {verts.map((p, i) => {
          const [x, y] = toPx(p);
          return (
            <circle
              key={i} cx={x} cy={y} r={7}
              fill={sel === i ? '#e06' : '#36c'}
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
            {inEdge != null && (
              <>
                <span style={{ borderLeft: '1px solid #ddd', paddingLeft: 8 }}>이 점으로 오는 변</span>
                <label><input type="radio" name="edgetype" checked={!isArc}
                  onChange={() => setEdge(inEdge, { type: 'line' })} /> 직선</label>
                <label><input type="radio" name="edgetype" checked={isArc}
                  onChange={() => {
                    // 기본 R = 두 끝점 거리(충분히 완만한 호)
                    const a = verts[(inEdge)]; const b = verts[(inEdge + 1) % n];
                    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    setEdge(inEdge, { type: 'arc', radius: Math.max(SNAP, Math.round(d)), ccw: false });
                  }} /> 곡선</label>
                {isArc && inEdgeSpec?.type === 'arc' && (
                  <>
                    <span>R(mm)</span>
                    <input type="number" value={inEdgeSpec.radius} style={{ width: 80 }}
                      onChange={(e) => setEdge(inEdge, { type: 'arc', radius: Number(e.target.value), ccw: inEdgeSpec.ccw })} />
                    <button onClick={() => setEdge(inEdge, { type: 'arc', radius: inEdgeSpec.radius, ccw: !inEdgeSpec.ccw })}>방향 ⟲</button>
                  </>
                )}
              </>
            )}
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#888' }}>스냅 {SNAP}mm</span>
      </div>
    </div>
  );
}