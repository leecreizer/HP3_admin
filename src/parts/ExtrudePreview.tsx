import { useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ExtrudeGeometry } from 'three';
import { buildShape } from './partGeometry';
import type { Profile } from './types';

function Mesh({ profile, depth, color }: { profile: Profile; depth: number; color: string }) {
  const geom = useMemo(() => {
    const shape = buildShape(profile);
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.center();
    return g;
  }, [profile, depth]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} scale={0.001 /* mm→m */}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export function ExtrudePreview({ profile, depth, color = '#d8c5a8' }: { profile: Profile; depth: number; color?: string }) {
  return (
    <Canvas camera={{ position: [0.8, 0.8, 0.8], fov: 45 }} style={{ width: '100%', height: '100%', background: '#1a1c20' }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 2]} intensity={1} />
      <Mesh profile={profile} depth={depth} color={color} />
      <OrbitControls makeDefault />
      <gridHelper args={[2, 20, '#444', '#2a2a2a']} />
    </Canvas>
  );
}
