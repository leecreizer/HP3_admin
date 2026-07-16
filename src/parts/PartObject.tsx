import { useEffect, useMemo } from 'react';
import { ExtrudeGeometry } from 'three';
import { buildShape, planeEuler } from './partGeometry';
import { resolveProfile } from './formula';
import type { Part } from './types';

const MM = 0.001; // mm → m

/**
 * 파츠 하나를 3D 메시로 렌더(로컬 원점 기준, 작업 평면 방향 적용).
 * 위치·회전은 호출부에서 감싸는 group으로 준다. 조립·미리보기 공용.
 */
export function PartObject({ part, selected, onSelect }: { part: Part; selected?: boolean; onSelect?: () => void }) {
  const geom = useMemo(
    () => new ExtrudeGeometry(buildShape(resolveProfile(part)), { depth: part.extrude.depth, bevelEnabled: false }),
    [part],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group rotation={planeEuler(part.plane)}>
      <mesh
        geometry={geom}
        scale={MM}
        onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      >
        <meshStandardMaterial
          color={selected ? '#ffb347' : (part.material?.color ?? '#d8c5a8')}
          emissive={selected ? '#663300' : '#000000'}
        />
      </mesh>
    </group>
  );
}
