import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { bulgePts, flatten, segLength, type LwMode, type LwPt, type LwShape } from './lineWall';

/**
 * 몰딩/벽판 3D 미리보기 — 단면을 길이 방향으로 밀어낸 막대. 쿠지알러는 서버 렌더 이미지(molding/preview)지만 HP3 는 화면에서 그린다.
 * 면 = 단면 구간마다 하나. 바탕 재질은 평붙임(실제 크기), 덧붙임 재질은 ‘맞춤’이면 면 폭에 맞춰 늘리고 ‘평붙임’이면 실제 크기로 반복.
 */

export type LwMat = { key: string; img: string; size: [number, number] };
type Built = { geo: THREE.BufferGeometry; mats: LwMat[]; len: number; w: number; h: number };

function build(shape: LwShape, base: LwMat, per: Map<number, { mat: LwMat; mode: LwMode }>, len: number): Built {
  const mats: LwMat[] = [base];
  const idxOf = (m: LwMat) => { let k = mats.findIndex((x) => x.key === m.key); if (k < 0) { mats.push(m); k = mats.length - 1; } return k; };
  const buckets = new Map<number, { pos: number[]; nor: number[]; uv: number[] }>();
  const bucket = (k: number) => { let b = buckets.get(k); if (!b) { b = { pos: [], nor: [], uv: [] }; buckets.set(k, b); } return b; };
  const tri = (b: ReturnType<typeof bucket>, P: number[][], N: number[], U: number[][]) => { for (let i = 0; i < 3; i++) { b.pos.push(...P[i]); b.nor.push(...N); b.uv.push(...U[i]); } };
  // 옆면 — 구간마다
  shape.segs.forEach((g, si) => {
    const p0 = shape.points[g.a], p1 = shape.points[g.b];
    const pts: LwPt[] = [p0, ...bulgePts(p0, p1, g.bulge, Math.PI / 36)];
    const att = per.get(si);
    const m = att ? att.mat : base, k = att ? idxOf(att.mat) : 0;
    const segLen = segLength(p0, p1, g.bulge) || 1;
    const [tw, th] = m.size;
    const fit = att?.mode === 'fit';
    const b = bucket(k);
    let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const q0 = pts[i], q1 = pts[i + 1];
      const d = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
      if (d < 1e-9) continue;
      const nx = (q1[1] - q0[1]) / d, ny = -(q1[0] - q0[0]) / d; // 반시계 윤곽의 바깥 법선
      const u0 = fit ? s / segLen : s / tw, u1 = fit ? (s + d) / segLen : (s + d) / tw;
      const vk = fit ? th * (segLen / tw) : th; // 맞춤: 면 폭에 맞춘 비율 유지
      const A = [q0[0], q0[1], 0], B = [q1[0], q1[1], 0], C = [q1[0], q1[1], len], D = [q0[0], q0[1], len];
      const N = [nx, ny, 0];
      tri(b, [A, B, C], N, [[u0, 0], [u1, 0], [u1, len / vk]]);
      tri(b, [A, C, D], N, [[u0, 0], [u1, len / vk], [u0, len / vk]]);
      s += d;
    }
  });
  // 양 끝 단면 — 바탕 재질
  const ring = flatten(shape);
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const cap = bucket(0);
  const [bw, bh] = base.size;
  for (const [i, j, k] of tris) {
    const P = [ring[i], ring[j], ring[k]];
    tri(cap, [[P[0][0], P[0][1], len], [P[1][0], P[1][1], len], [P[2][0], P[2][1], len]], [0, 0, 1], P.map(([x, y]) => [x / bw, y / bh]));
    tri(cap, [[P[0][0], P[0][1], 0], [P[2][0], P[2][1], 0], [P[1][0], P[1][1], 0]], [0, 0, -1], [P[0], P[2], P[1]].map(([x, y]) => [x / bw, y / bh]));
  }
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  let start = 0;
  for (const [k, b] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
    pos.push(...b.pos); nor.push(...b.nor); uv.push(...b.uv);
    const n = b.pos.length / 3;
    geo.addGroup(start, n, k);
    start += n;
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return { geo, mats, len, w: shape.w, h: shape.h };
}

function Bar({ shape, base, per, len }: { shape: LwShape; base: LwMat; per: Map<number, { mat: LwMat; mode: LwMode }>; len: number }) {
  const built = useMemo(() => build(shape, base, per, len), [shape, base, per, len]);
  const materials = useMemo(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    return built.mats.map((m) => {
      const mat = new THREE.MeshStandardMaterial({ color: '#d9d4cc', roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
      if (m.img) {
        loader.load(m.img, (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          mat.map = t; mat.color.set('#ffffff'); mat.needsUpdate = true;
        });
      }
      return mat;
    });
  }, [built]);
  useEffect(() => () => { built.geo.dispose(); materials.forEach((m) => { m.map?.dispose(); m.dispose(); }); }, [built, materials]);
  // 길이 방향(z)을 가로(x)로 눕히고 가운데로
  return (
    <group rotation={[0, -Math.PI / 2, 0]}>
      <mesh geometry={built.geo} material={materials} position={[-built.w / 2, -built.h / 2, -built.len / 2]} />
    </group>
  );
}

/** 처음 시점 — 단면 끝이 보이게 비스듬히 */
function Fit({ size }: { size: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => { camera.position.set(size * 0.7, size * 0.45, size * 1.05); camera.lookAt(0, 0, 0); }, [camera, size]);
  return null;
}

/** 3D 미리보기 — onCanvas 로 그림 캔버스를 넘겨 상품 이미지로 저장한다 */
export function LineWallPreview({ shape, base, per, len, onCanvas }: {
  shape: LwShape; base: LwMat; per: Map<number, { mat: LwMat; mode: LwMode }>; len: number;
  onCanvas?: (c: HTMLCanvasElement) => void;
}) {
  const size = Math.max(shape.w, shape.h, len * 0.75, 10) * 1.4;
  return (
    <Canvas className="cl-lw-3d" dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 35, near: size / 100, far: size * 40 }}
      onCreated={({ gl }) => onCanvas?.(gl.domElement)}>
      <color attach="background" args={['#f2f3f5']} />
      <hemisphereLight args={['#ffffff', '#9aa0a6', 0.9]} />
      <directionalLight position={[size, size * 1.5, size * 0.8]} intensity={1.6} />
      <directionalLight position={[-size, size * 0.4, -size]} intensity={0.5} />
      <Bar shape={shape} base={base} per={per} len={len} />
      <Fit size={size} />
      <OrbitControls makeDefault enableDamping={false} minDistance={size * 0.2} maxDistance={size * 6} />
    </Canvas>
  );
}
