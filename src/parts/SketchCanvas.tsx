import { useRef, useState } from 'react';
import type { Profile, Vec2 } from './types';

const SNAP = 10; // mm — 놓을 때 격자 스냅 간격
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const snapPt = (p: Vec2): Vec2 => [snap(p[0]), snap(p[1])];

/** 외곽 컨투어의 정점 목록(start + 각 segment.to). 마지막이 start와 같으면(closePath 중복) 표시에서 제외. */
function outerPoints(profile: Profile): Vec2[] {
  const c = profile.contours[0];
  if (!c) return [];
  const pts: Vec2[] = [c.start, ...c.segments.map((s) => s.to)];
  // 닫힌 사각형의 마지막 반복점 제거(표시용)
  if (pts.length > 1) {
    const last = pts[pts.length - 1];
    if (last[0] === c.start[0] && last[1] === c.start[1]) pts.pop();
  }
  return pts;
}

/** 정점 목록으로 외곽 컨투어 재구성(항상 closed line 폴리곤). */
function rebuild(profile: Profile, pts: Vec2[]): Profile {
  const contour = {
    closed: true,
    start: pts[0],
    segments: [
      ...pts.slice(1).map((p) => ({ type: 'line' as const, to: p })),
      { type: 'line' as const, to: pts[0] },
    ],
  };
  return { ...profile, contours: [contour, ...profile.contours.slice(1)] };
}

export function SketchCanvas({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const pts = outerPoints(profile);
  const [sel, setSel] = useState<number | null>(null);

  const W = 800, H = 600, PAD = 40;
  // fit: 점 범위를 뷰에 맞춤
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(0, ...xs), maxX = Math.max(100, ...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(100, ...ys);
  const sx = (W - PAD * 2) / Math.max(1, maxX - minX);
  const sy = (H - PAD * 2) / Math.max(1, maxY - minY);
  const s = Math.min(sx, sy);

  const [frozen, setFrozen] = useState<{ minX: number; minY: number; s: number } | null>(null);
  const tMinX = frozen ? frozen.minX : minX;
  const tMinY = frozen ? frozen.minY : minY;
  const tS = frozen ? frozen.s : s;
  const toPx = (p: Vec2): [number, number] => [PAD + (p[0] - tMinX) * tS, H - PAD - (p[1] - tMinY) * tS];
  // viewBox 좌표 → mm(드래그 중엔 스냅 없이 1mm 단위 자유 이동)
  const toMm = (px: number, py: number): Vec2 => [
    Math.round((px - PAD) / tS + tMinX),
    Math.round((H - PAD - py) / tS + tMinY),
  ];

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  /** 화면 픽셀 → SVG viewBox 좌표(width 100%·레터박싱 보정). */
  const clientToLocal = (clientX: number, clientY: number): Vec2 | null => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  const startDrag = (i: number, e: React.PointerEvent) => {
    setSel(i);
    setDrag(i);
    setFrozen({ minX, minY, s });
    // 포인터 캡처: 커서가 SVG 밖으로 나가도 move/up 이벤트를 계속 받는다(끊김 방지).
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const local = clientToLocal(e.clientX, e.clientY);
    if (!local) return;
    const m = toMm(local[0], local[1]);
    onChange(rebuild(profile, pts.map((p, i) => (i === drag ? m : p))));
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag != null) {
      // 놓는 순간에만 격자 스냅 → 드래그는 매끄럽고 최종 위치는 정렬됨.
      onChange(rebuild(profile, pts.map((p, i) => (i === drag ? snapPt(p) : p))));
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
    setFrozen(null);
  };

  const addPoint = () => {
    // 마지막 점과 첫 점 중간에 추가
    const a = pts[pts.length - 1]; const b = pts[0];
    const mid: Vec2 = [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)];
    onChange(rebuild(profile, [...pts, mid]));
  };
  const delPoint = () => {
    if (sel == null || pts.length <= 3) return;
    onChange(rebuild(profile, pts.filter((_, i) => i !== sel)));
    setSel(null);
  };
  const editCoord = (axis: 0 | 1, v: number) => {
    if (sel == null) return;
    const next = pts.map((p, i) => (i === sel ? (axis === 0 ? [v, p[1]] : [p[0], v]) as Vec2 : p));
    onChange(rebuild(profile, next));
  };

  const poly = pts.map(toPx).map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <svg
        ref={svgRef}
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#f5f5f2', border: '1px solid #ccc', flex: 1, touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} />
        {pts.map((p, i) => {
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
        <button onClick={addPoint}>+ 점 추가</button>
        <button onClick={delPoint} disabled={sel == null || pts.length <= 3}>점 삭제</button>
        {sel != null && (
          <>
            <span>선택점 X(mm)</span>
            <input type="number" value={pts[sel][0]} style={{ width: 70 }}
              onChange={(e) => editCoord(0, Number(e.target.value))} />
            <span>Y(mm)</span>
            <input type="number" value={pts[sel][1]} style={{ width: 70 }}
              onChange={(e) => editCoord(1, Number(e.target.value))} />
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#888' }}>스냅 {SNAP}mm</span>
      </div>
    </div>
  );
}