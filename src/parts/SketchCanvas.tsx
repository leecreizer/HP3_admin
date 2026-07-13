import { useState } from 'react';
import type { Profile, Vec2 } from './types';

const SNAP = 10; // mm
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

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
  const toPx = (p: Vec2): [number, number] => [PAD + (p[0] - minX) * s, H - PAD - (p[1] - minY) * s];
  const toMm = (px: number, py: number): Vec2 => [snap((px - PAD) / s + minX), snap((H - PAD - py) / s + minY)];

  const [drag, setDrag] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = toMm(e.clientX - rect.left, e.clientY - rect.top);
    const next = pts.map((p, i) => (i === drag ? m : p));
    onChange(rebuild(profile, next));
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
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#f5f5f2', border: '1px solid #ccc', flex: 1 }}
        onMouseMove={onMove} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}
      >
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} />
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          return (
            <circle
              key={i} cx={x} cy={y} r={7}
              fill={sel === i ? '#e06' : '#36c'}
              onMouseDown={() => { setSel(i); setDrag(i); }}
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