import { AmbientLight, Box3, BoxGeometry, Color, DirectionalLight, DoubleSide, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer, type Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { getAsset } from '../data/assetStore';
import type { BuildResult } from './geometry';
import type { V3 } from './resolve';

/** 새 에디터 GLB — 메시 부품(컨텐츠 라이브러리 3D 모델) 불러오기와 입고용 GLB·썸네일 내보내기 */

export const MM = 0.001;
let draco: DRACOLoader | null = null;
const loader = () => {
  draco ??= new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  return new GLTFLoader().setDRACOLoader(draco);
};

/**
 * GLB(미터 · Y 위 · 앞 +Z) → 쿠지알러 좌표 W×D×H 상자 [0,W]×[-D,0]×[0,H] (앞면 -Y) 에 맞춘 그룹.
 * 메시 래퍼(furnitureWithMaterial)의 targetSize 처럼 상자에 늘려 맞춘다.
 */
export async function loadMeshFitted(assetId: string, size: V3): Promise<Object3D | null> {
  const url = await getAsset(assetId);
  if (!url) return null;
  const gltf = await loader().loadAsync(url);
  const holder = new Group();
  holder.rotation.x = Math.PI / 2;
  holder.add(gltf.scene);
  const wrap = new Group();
  wrap.add(holder);
  wrap.updateMatrixWorld(true);
  const b = new Box3().setFromObject(wrap);
  const s = b.getSize(new Vector3());
  wrap.scale.set(size[0] / (s.x || 1), size[1] / (s.y || 1), size[2] / (s.z || 1));
  wrap.position.set(-b.min.x * wrap.scale.x, -b.max.y * wrap.scale.y, -b.min.z * wrap.scale.z);
  return wrap;
}

/** 계산 결과 → three 그룹(쿠지알러 좌표를 Y 위 · 미터로). 숨김·보조 구조 제외 */
export async function buildGroup(r: BuildResult): Promise<Group> {
  const root = new Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(MM);
  for (const p of r.parts) {
    if (p.hidden || p.viewHidden || p.kind === 'aux') continue;
    let obj: Object3D | null = null;
    if (p.kind === 'solid' && p.geometry) obj = new Mesh(p.geometry.clone(), new MeshStandardMaterial({ color: p.color, side: DoubleSide, roughness: 0.6 }));
    else if (p.kind === 'mesh' && p.mesh) {
      obj = p.mesh.asset ? await loadMeshFitted(p.mesh.asset, p.mesh.size).catch(() => null) : null;
      if (!obj) {
        const g = new BoxGeometry(...p.mesh.size);
        g.translate(p.mesh.size[0] / 2, -p.mesh.size[1] / 2, p.mesh.size[2] / 2);
        obj = new Mesh(g, new MeshStandardMaterial({ color: '#c8ccd2' }));
      }
    }
    if (!obj) continue;
    const holder = new Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(p.matrix);
    holder.name = p.name;
    holder.add(obj);
    root.add(holder);
  }
  return root;
}

export function renderThumb(root: Group, size = 360): string {
  try {
    const scene = new Scene();
    scene.background = new Color('#f4f5f7');
    scene.add(root, new AmbientLight(0xffffff, 0.85));
    const dl = new DirectionalLight(0xffffff, 1.3); dl.position.set(2, 3, 2.5); scene.add(dl);
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(root);
    const c = box.getCenter(new Vector3());
    const rad = box.getBoundingSphere(new Sphere()).radius || 1;
    const cam = new PerspectiveCamera(35, 1, 0.001, 100);
    cam.position.set(c.x + rad * 1.7, c.y + rad * 1.25, c.z + rad * 2.3);
    cam.lookAt(c);
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/jpeg', 0.86);
    renderer.dispose();
    return url;
  } catch { return ''; }
}

function abToDataUrl(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:model/gltf-binary;base64,' + btoa(bin);
}

/** 입고용 — GLB(dataURL) + 썸네일 */
export async function exportGlb(r: BuildResult): Promise<{ glb: string; thumb: string }> {
  const root = await buildGroup(r);
  const wrap = new Group();
  wrap.add(root);
  const buf = await new Promise<ArrayBuffer>((res, rej) => new GLTFExporter().parse(wrap, (o) => res(o as ArrayBuffer), rej, { binary: true }));
  return { glb: abToDataUrl(buf), thumb: renderThumb(root) };
}

/** fbxConvert 의 더미 마커 메시 표시 (MARKER_FLAG) — 변환기를 끌어오지 않도록 값만 맞춘다 */
const MARKER_FLAG = 'hp3Marker';

/** 업로드한 GLB(미터·Y 위) → 썸네일 + 모델 크기 mm (W = X, D = Z, H = Y) — 컨텐츠 라이브러리 3D 모델 만들기 */
export async function glbInfo(dataUrl: string): Promise<{ thumb: string; size: { w: number; d: number; h: number } }> {
  const gltf = await loader().loadAsync(dataUrl);
  gltf.scene.traverse((o) => { if (o.userData?.[MARKER_FLAG]) o.visible = false; });
  const root = new Group();
  root.add(gltf.scene);
  root.updateMatrixWorld(true);
  const s = new Box3().setFromObject(root).getSize(new Vector3());
  return { thumb: renderThumb(root), size: { w: Math.round(s.x / MM), d: Math.round(s.z / MM), h: Math.round(s.y / MM) } };
}
