import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { PbrTemplate } from './pbrData';
import type { PbrValues } from './pbrModel';
import { createPbrMaterial, updatePbrMaterial, type MapSet } from './pbrMaterial';
import { floorTexture, modelMesh } from './pbrScene';

/** 실시간 미리보기 — 표시 모델 + 재질, 바닥 격자, 실내 조명 환경(밝은·어두운 광장), 마우스로 돌려 보기 */

export type ViewApi = { capture: (scale?: number) => string };
export type LightField = 'bright' | 'dark';

/** 실내 조명 환경(RoomEnvironment, 내려받기 없음) — 밝은 광장 / 어두운 광장(환경광 0.35배·배경 어둡게) */
function Env({ light, envI }: { light: LightField; envI: number }) {
  const gl = useThree((st) => st.gl);
  const env = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const t = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return t;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  const bg = light === 'bright' ? '#f4f5f7' : '#2f3237';
  return (
    <>
      <Environment map={env} environmentIntensity={envI * (light === 'bright' ? 1 : 0.35)} />
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 7, 22]} />
    </>
  );
}

function Floor({ dark }: { dark: boolean }) {
  const tex = useMemo(() => { const t = floorTexture(dark); t.repeat.set(40, 40); return t; }, [dark]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  );
}

function Model({ tpl, vals, maps, model, size }: { tpl: PbrTemplate; vals: PbrValues; maps: MapSet; model: number; size: [number, number] }) {
  const mesh = useMemo(() => modelMesh(model), [model]);
  useEffect(() => () => mesh.parts.forEach((p) => p.geo.dispose()), [mesh]);
  const mat = useMemo(() => createPbrMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const rx = 1000 / Math.max(10, size[0]), ry = 1000 / Math.max(10, size[1]);
  useLayoutEffect(() => { updatePbrMaterial(mat, tpl, vals, maps, [rx, ry], !!mesh.doubleSide); }, [mat, tpl, vals, maps, rx, ry, mesh]);
  return (
    <group>
      {mesh.parts.map((p, i) => <mesh key={i} geometry={p.geo} material={mat} position={p.position} rotation={p.rotation} />)}
    </group>
  );
}

function Capture({ onApi }: { onApi?: (api: ViewApi) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onApi?.({
      capture: (scale = 2) => {
        const pr = gl.getPixelRatio();
        gl.setPixelRatio(pr * scale);
        gl.render(scene, camera);
        const url = gl.domElement.toDataURL('image/png');
        gl.setPixelRatio(pr);
        gl.render(scene, camera);
        return url;
      },
    });
  }, [gl, scene, camera, onApi]);
  return null;
}

export function PbrViewport({ tpl, vals, maps, model, size, light, envI, onApi }: {
  tpl: PbrTemplate; vals: PbrValues; maps: MapSet; model: number; size: [number, number]; light: LightField; envI: number; onApi?: (api: ViewApi) => void;
}) {
  return (
    <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 0.95, 3.7], near: 0.05, far: 60 }} gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.NeutralToneMapping }}>
      <Env light={light} envI={envI} />
      <directionalLight position={[2.5, 4, 3]} intensity={light === 'bright' ? 1.1 : 0.5} />
      <ambientLight intensity={0.12} />
      <Floor dark={light === 'dark'} />
      <ContactShadows position={[0, 0.003, 0]} opacity={light === 'bright' ? 0.45 : 0.65} scale={6} blur={2.4} far={1.8} resolution={512} />
      <Model tpl={tpl} vals={vals} maps={maps} model={model} size={size} />
      <OrbitControls makeDefault target={[0, 0.5, 0]} enablePan={false} minDistance={1.6} maxDistance={8} maxPolarAngle={Math.PI * 0.49} />
      <Capture onApi={onApi} />
    </Canvas>
  );
}
