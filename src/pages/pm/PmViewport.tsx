import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Edges, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Vector3, type Object3D } from 'three';
import type { BuildResult, RenderPart } from '../../pm/geometry';
import { MM, loadMeshFitted } from '../../pm/glb';
import type { ShadeMode, ViewMode } from './viewMeta';

const AUX_COLOR: Record<string, string> = { frame: '#8a8f98', inner: '#2e9d6b', intersect: '#d0453d', door: '#e08a1e', molding: '#8a54c8', adsorb: '#1aa57a', point: '#1d6fd6', custom: '#1d6fd6' };

/** 쿠지알러 좌표(mm, Z 위) → three(m, Y 위) */
const toThree = (v: Vector3) => new Vector3(v.x * MM, v.z * MM, -v.y * MM);

function MeshPart({ part, selected, shade }: { part: RenderPart; selected: boolean; shade: ShadeMode }) {
  const [obj, setObj] = useState<Object3D | null>(null);
  const size = part.mesh!.size;
  const key = `${part.mesh!.asset}|${size.join('x')}`;
  useEffect(() => {
    let on = true;
    if (part.mesh!.asset) loadMeshFitted(part.mesh!.asset, size).then((o) => { if (on) setObj(o); }).catch(() => undefined);
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const box = (
    <mesh position={[size[0] / 2, -size[1] / 2, size[2] / 2]}>
      <boxGeometry args={[Math.max(size[0], 1), Math.max(size[1], 1), Math.max(size[2], 1)]} />
      <meshStandardMaterial color={selected ? '#3d7bfd' : '#c8ccd2'} transparent opacity={obj ? (selected ? 0.18 : 0) : 0.55} depthWrite={!obj} />
      <Edges color={selected ? '#1b4fd1' : '#8a93a0'} />
    </mesh>
  );
  return <group>{obj && shade !== 'white' && <primitive object={obj} />}{box}</group>;
}

function SolidPart({ part, selected, ghost, shade }: { part: RenderPart; selected: boolean; ghost: boolean; shade: ShadeMode }) {
  const trans = shade === 'trans' || ghost;
  const color = selected ? '#3d7bfd' : shade === 'white' ? '#f4f4f4' : part.color;
  return (
    <mesh geometry={part.geometry}>
      <meshStandardMaterial color={color} side={DoubleSide} roughness={0.65} transparent={trans || selected} opacity={ghost ? 0.2 : trans ? 0.35 : selected ? 0.85 : 1} depthWrite={!trans} />
      {(shade === 'wire' || shade === 'white' || shade === 'trans' || selected || ghost) && <Edges threshold={20} color={selected ? '#1b4fd1' : ghost ? '#9aa3ad' : '#4d5560'} />}
    </mesh>
  );
}

function AuxPart({ part, selected }: { part: RenderPart; selected: boolean }) {
  const geo = useMemo(() => { const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(part.lines ?? [], 3)); return g; }, [part.lines]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <lineSegments geometry={geo} raycast={part.auxKind === 'frame' ? () => null : undefined}>
      <lineBasicMaterial color={selected ? '#3d7bfd' : AUX_COLOR[part.auxKind ?? 'custom'] ?? '#1d6fd6'} depthTest={part.auxKind !== 'frame'} transparent opacity={part.hidden ? 0.4 : 1} />
    </lineSegments>
  );
}

function setOrthoZoom(cam: unknown, zoom: number) {
  const o = cam as { zoom: number; isOrthographicCamera?: boolean };
  if (o.isOrthographicCamera) o.zoom = zoom;
}

/** 카메라는 시점 변경·‘화면 맞춤’ 때만 다시 잡는다(편집 중 화면이 튀지 않게) */
function CameraRig({ view, fit, box }: { view: ViewMode; fit: number; box: Box3 }) {
  const { camera, size } = useThree();
  const controls = useThree((st) => st.controls) as unknown as { target: Vector3; update: () => void } | null;
  useEffect(() => {
    const b = box.isEmpty() ? new Box3(new Vector3(0, -500, 0), new Vector3(600, 0, 720)) : box;
    const c = toThree(b.getCenter(new Vector3()));
    const s = b.getSize(new Vector3()).multiplyScalar(MM);
    const r = Math.max(s.x, s.y, s.z, 0.3);
    const d = r * 4;
    camera.up.set(0, 1, 0);
    switch (view) {
      case '3d': camera.position.set(c.x + r * 1.5, c.y + r * 1.05, c.z + r * 1.9); break;
      case 'T': camera.position.set(c.x, c.y + d, c.z); camera.up.set(0, 0, -1); break;
      case 'B': camera.position.set(c.x, c.y - d, c.z); camera.up.set(0, 0, 1); break;
      case 'F': camera.position.set(c.x, c.y, c.z + d); break;
      case 'K': camera.position.set(c.x, c.y, c.z - d); break;
      case 'L': camera.position.set(c.x - d, c.y, c.z); break;
      case 'R': camera.position.set(c.x + d, c.y, c.z); break;
    }
    if (view !== '3d') setOrthoZoom(camera, Math.min(size.width, size.height) / (r * 1.7));
    camera.lookAt(c);
    camera.updateProjectionMatrix();
    if (controls) { controls.target.copy(c); controls.update(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fit, controls]);
  return <OrbitControls makeDefault enableRotate={view === '3d'} />;
}

/** 캔버스 캡처 함수를 부모에 넘긴다 (미리보기 이미지 · 표기도) */
function Capturer({ onReady }: { onReady: (fn: () => string) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => { onReady(() => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png'); }); }, [gl, scene, camera, onReady]);
  return null;
}

export function PmViewport({ result, selected, onSelect, showHidden, showAux, explode, view, shade, fit, onCapture }: {
  result: BuildResult; selected: string | null; onSelect: (id: string | null) => void;
  showHidden: boolean; showAux: boolean; explode: number; view: ViewMode; shade: ShadeMode; fit: number;
  onCapture: (fn: () => string) => void;
}) {
  const center = useMemo(() => (result.bbox.isEmpty() ? new Vector3() : result.bbox.getCenter(new Vector3())), [result.bbox]);
  const offsets = useMemo(() => {
    const m = new Map<string, Matrix4>();
    for (const p of result.parts) {
      if (!explode || p.kind === 'aux') { m.set(p.key, p.matrix); continue; }
      let pc: Vector3;
      if (p.geometry) { p.geometry.computeBoundingBox(); pc = p.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(p.matrix); }
      else pc = new Vector3(...(p.mesh?.size ?? [0, 0, 0])).multiplyScalar(0.5).applyMatrix4(p.matrix);
      const off = pc.sub(center).multiplyScalar(explode);
      m.set(p.key, new Matrix4().makeTranslation(off.x, off.y, off.z).multiply(p.matrix));
    }
    return m;
  }, [result.parts, explode, center]);
  const frameSize = result.frame.isEmpty() ? 1 : Math.max(...result.frame.getSize(new Vector3()).toArray()) * MM;
  const gridSize = Math.max(4, Math.ceil(frameSize * 3));
  const cap = useRef(onCapture);
  useEffect(() => { cap.current = onCapture; }, [onCapture]);
  const visible = result.parts.filter((p) => !p.viewHidden && (!p.hidden || showHidden || p.kind === 'aux') && (p.kind !== 'aux' || showAux || p.auxKind === 'frame'));
  return (
    <Canvas onPointerMissed={() => onSelect(null)} style={{ background: '#f5f6f8' }} gl={{ preserveDrawingBuffer: true, antialias: true }}
      raycaster={{ params: { Line: { threshold: 0.01 }, Points: { threshold: 0.01 }, Mesh: {}, LOD: {}, Sprite: {} } }}>
      {view === '3d'
        ? <PerspectiveCamera makeDefault fov={40} near={0.01} far={500} position={[2, 1.5, 2.5]} />
        : <OrthographicCamera makeDefault near={-100} far={500} zoom={200} position={[0, 10, 0]} />}
      <CameraRig view={view} fit={fit} box={result.bbox} />
      <Capturer onReady={(fn) => cap.current(fn)} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} />
      {view === '3d' && <gridHelper args={[gridSize, gridSize * 10, '#c3c8d0', '#dde1e6']} />}
      <group rotation={[-Math.PI / 2, 0, 0]} scale={MM}>
        {/* 축 — X 빨강 · Y 초록 · Z 파랑 (쿠지알러 화면) */}
        <lineSegments>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, gridSize / 2 / MM, 0, 0, 0, 0, 0, 0, gridSize / 2 / MM, 0, 0, 0, 0, 0, 0, gridSize / 2 / MM]), 3]} />
            <bufferAttribute attach="attributes-color" args={[new Float32Array([1, .2, .2, 1, .2, .2, .2, .75, .3, .2, .75, .3, .2, .3, 1, .2, .3, 1]), 3]} /></bufferGeometry>
          <lineBasicMaterial vertexColors />
        </lineSegments>
        {visible.map((p) => (
          <group key={p.key} matrixAutoUpdate={false} matrix={offsets.get(p.key) ?? p.matrix}
            onClick={p.auxKind === 'frame' ? undefined : (e) => { e.stopPropagation(); onSelect(p.nodeId); }}>
            {p.kind === 'solid' && p.geometry && <SolidPart part={p} selected={p.nodeId === selected} ghost={p.hidden} shade={shade} />}
            {p.kind === 'mesh' && p.mesh && <MeshPart part={p} selected={p.nodeId === selected} shade={shade} />}
            {p.kind === 'aux' && <AuxPart part={p} selected={p.nodeId === selected || (p.auxKind === 'frame' && selected === '__frame')} />}
          </group>
        ))}
      </group>
    </Canvas>
  );
}
