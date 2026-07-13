import { useMemo, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ExtrudeGeometry, Euler, Vector3 } from 'three';
import { buildShape, outlinePoints } from './partGeometry';
import type { Profile, WorkPlane } from './types';

const MM = 0.001; // mm → m

/** 작업 평면별 회전(오일러). 기본 압출은 +Z, 회전으로 해당 축에 맞춘다. */
function planeEuler(plane: WorkPlane): [number, number, number] {
  if (plane === 'XZ') return [-Math.PI / 2, 0, 0]; // 평면(바닥): 압출 +Z→+Y(위로)
  if (plane === 'YZ') return [0, Math.PI / 2, 0];  // 측면: 압출 +Z→+X
  return [0, 0, 0]; // XY(정면): 압출 +Z 그대로
}

function Mesh({ profile, depth, color, plane }: { profile: Profile; depth: number; color: string; plane: WorkPlane }) {
  const geom = useMemo(() => {
    const shape = buildShape(profile);
    // center() 하지 않음 — 도면의 (0,0)이 그대로 로컬 원점이 되도록(사용자 요청)
    return new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  }, [profile, depth]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group rotation={planeEuler(plane)}>
      <mesh geometry={geom} scale={MM}>
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

/** 단면 실제 범위(mm)로 부품 중심·크기를 구해 카메라/피벗을 맞춘다(원점 유지). */
function useProfileFrame(profile: Profile, depth: number, plane: WorkPlane) {
  return useMemo(() => {
    const pts = outlinePoints(profile.contours[0] ?? { closed: true, corners: [] });
    if (pts.length === 0) return { center: new Vector3(), size: 0.5 };
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // 로컬 중심(회전 전) → 회전 적용 → 월드 중심
    const local = new Vector3(cx * MM, cy * MM, (depth / 2) * MM);
    const center = local.applyEuler(new Euler(...planeEuler(plane)));
    const w = (Math.max(...xs) - Math.min(...xs)) * MM;
    const h = (Math.max(...ys) - Math.min(...ys)) * MM;
    const size = Math.max(w, h, depth * MM, 0.2);
    return { center, size };
  }, [profile, depth, plane]);
}

function Scene({ profile, depth, color, plane }: { profile: Profile; depth: number; color: string; plane: WorkPlane }) {
  const { center, size } = useProfileFrame(profile, depth, plane);
  const { camera } = useThree();
  // 마운트/평면 변경 시에만 카메라 재배치(편집 중 화면이 튀지 않도록 profile 제외)
  useEffect(() => {
    const d = size * 2.2;
    camera.position.set(center.x + d, center.y + d * 0.8, center.z + d);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plane, camera]);
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 2]} intensity={1} />
      <Mesh profile={profile} depth={depth} color={color} plane={plane} />
      {/* 도면 원점(0,0,0) 표시 — X(빨강)/Y(초록)/Z(파랑) */}
      <axesHelper args={[Math.max(size, 0.3)]} />
      <gridHelper args={[Math.max(2, size * 4), 20, '#555', '#2a2a2a']} />
      <OrbitControls makeDefault target={[center.x, center.y, center.z]} />
    </>
  );
}

export function ExtrudePreview({ profile, depth, color = '#d8c5a8', plane = 'XY' }: {
  profile: Profile; depth: number; color?: string; plane?: WorkPlane;
}) {
  return (
    <Canvas camera={{ position: [0.8, 0.8, 0.8], fov: 45 }} style={{ width: '100%', height: '100%', background: '#1a1c20' }}>
      <Scene profile={profile} depth={depth} color={color} plane={plane} />
    </Canvas>
  );
}