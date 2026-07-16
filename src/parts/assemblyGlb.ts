import {
  Scene, Group, Mesh, ExtrudeGeometry, MeshStandardMaterial,
  PerspectiveCamera, WebGLRenderer, Box3, Vector3, Sphere, AmbientLight, DirectionalLight, Color,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildShape, planeEuler } from './partGeometry';
import { resolveProfile } from './formula';
import type { Part } from './types';

const MM = 0.001;
const DEG = Math.PI / 180;

/** 해석 완료된 배치 1개 — 파츠 + 위치(mm)·회전(도)·스케일. */
export interface ResolvedItem {
  part: Part;
  pos: [number, number, number];
  rotDeg: [number, number, number];
  scale: [number, number, number];
}

/** 배치들을 실제 3D 씬(그룹)으로 조립. GLB·썸네일 공용. */
function buildScene(items: ResolvedItem[]): { scene: Scene; root: Group } {
  const scene = new Scene();
  const root = new Group();
  for (const it of items) {
    const geom = new ExtrudeGeometry(buildShape(resolveProfile(it.part)), { depth: it.part.extrude.depth, bevelEnabled: false });
    const mesh = new Mesh(geom, new MeshStandardMaterial({ color: it.part.material?.color ?? '#d8c5a8' }));
    mesh.scale.setScalar(MM);
    const planeG = new Group(); planeG.rotation.set(...planeEuler(it.part.plane)); planeG.add(mesh);
    const scaleG = new Group(); scaleG.scale.set(it.scale[0] || 1, it.scale[1] || 1, it.scale[2] || 1); scaleG.add(planeG);
    const posG = new Group();
    posG.position.set(it.pos[0] * MM, it.pos[1] * MM, it.pos[2] * MM);
    posG.rotation.set(it.rotDeg[0] * DEG, it.rotDeg[1] * DEG, it.rotDeg[2] * DEG);
    posG.add(scaleG);
    root.add(posG);
  }
  scene.add(root);
  return { scene, root };
}

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** 씬을 오프스크린 렌더해 PNG 썸네일 data URL 생성. WebGL 불가 환경이면 '' 반환. */
function renderThumb(scene: Scene, root: Group, size = 256): string {
  try {
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    const sph = box.getBoundingSphere(new Sphere());
    const r = (Number.isFinite(sph.radius) && sph.radius > 0) ? sph.radius : 1;
    scene.background = new Color('#1a1c20');
    scene.add(new AmbientLight(0xffffff, 0.7));
    const dl = new DirectionalLight(0xffffff, 1); dl.position.set(2, 3, 2); scene.add(dl);
    const cam = new PerspectiveCamera(45, 1, 0.01, 1000);
    const d = r * 2.4;
    cam.position.set(center.x + d, center.y + d * 0.8, center.z + d);
    cam.lookAt(center);
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.dispose();
    return url;
  } catch { return ''; }
}

/** 조립을 GLB(data URL)로 익스포트하고 썸네일 PNG(data URL)도 생성. */
export async function exportAssemblyGlb(items: ResolvedItem[]): Promise<{ glb: string; thumb: string }> {
  const { scene, root } = buildScene(items);
  // GLB 먼저(WebGL 불필요) — 실패해도 예외 전파
  const exporter = new GLTFExporter();
  const buf = await new Promise<ArrayBuffer>((res, rej) => {
    exporter.parse(root, (out) => res(out as ArrayBuffer), (err) => rej(err), { binary: true });
  });
  const glb = 'data:model/gltf-binary;base64,' + abToB64(buf);
  // 썸네일은 WebGL 필요 — 실패해도 GLB는 반환
  const thumb = renderThumb(scene, root);
  return { glb, thumb };
}