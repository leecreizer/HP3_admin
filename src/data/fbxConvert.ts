/**
 * FBX → GLB 변환 (브라우저, 서버 불필요).
 *
 * 3ds Max glTF 내보내기는 더미(메시 없는 노드: DP/HD/X, hotspot/DL1... 등)를 제거하지만,
 * FBX는 더미 계층/이름/위치를 그대로 보존한다. 따라서 업로드 시 FBX를 직접 로드해서
 * **이름 있는 더미를 작은 박스 "마커 메시"로 변환**한 뒤 GLB로 내보내면, 더미 정보가
 * GLB에 살아남는다. 웹은 이 마커 메시를 이름으로 읽고 렌더에서는 숨긴다.
 *
 * (helper L/R/T/F/K 처럼 이미 메시인 노드는 그대로 둔다. 점 마커는 위치만 필요하므로
 *  작은 박스로 충분하다.)
 */
import {
  Box3,
  BoxGeometry,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Texture,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** 마커 박스 한 변 크기(모델 로컬 단위). 위치 식별용이라 작게. */
const MARKER_SIZE = 10;
/**
 * export 시 텍스처 최대 해상도(px). 원본에 2671×2048 같은 대형 텍스처가 있으면 GLB가 15MB+로
 * 커져 설계 미리보기(useGLTF)에서 GPU 메모리 초과로 렌더가 죽는다. 1024로 제한하면 5MB대로
 * 떨어지면서 미리보기 품질은 충분.
 */
const MAX_TEXTURE_SIZE = 1024;
/** 마커 메시임을 표시하는 userData 플래그(웹에서 숨김 판정 보조). */
export const MARKER_FLAG = 'hp3Marker';
/**
 * FBX는 mm 단위(예: 장 폭 ~905)지만, 웹 설계화면은 GLB를 **미터** 단위로 가정한다
 * (placement: target = p.w(mm) × 1/1000 = m, HelperScaler.applyResize도 미터 목표를 받음).
 * 정규화하지 않으면 origSize(905mm)와 목표(0.6m)의 delta가 ~-904로 폭주해 영역 변형이
 * 모델을 산산조각낸다. 따라서 export 전 루트를 1/1000로 스케일해 미터로 맞춘다.
 */
const MM_TO_M = 1 / 1000;

/** 비어있지 않은(자식 또는 기하 포함) 객체인지 — 완전 빈 그룹도 마커로 살릴지 결정용. */
function isMeshNode(o: Object3D): boolean {
  return (o as Partial<Mesh>).isMesh === true;
}

/**
 * **리프 더미**(메시·자식이 없는 이름 노드: HD/X, DL1/DR1/...)를 같은 이름·같은 변환의 작은
 * 박스 메시로 **교체**한다. (자식으로 추가가 아니라 교체하므로 이름 충돌 `_1`이 생기지 않는다.)
 *
 * 그룹 더미(DP/helper/hotspot/replaceableW)는 자식(메시 또는 마커)을 가지므로 GLTFExporter가
 * 조상 노드로 자동 보존한다 → 별도 메시화 불필요.
 */
function injectDummyMarkers(root: Object3D): number {
  const leaves: Object3D[] = [];
  root.traverse((o) => {
    if (o === root) return;
    if (isMeshNode(o)) return;
    if (o.children.length > 0) return; // 그룹 더미는 자식으로 생존
    if (!o.name || !o.name.trim()) return;
    leaves.push(o);
  });

  const mat = new MeshStandardMaterial({ color: 0x888888 });
  let count = 0;
  for (const d of leaves) {
    const parent = d.parent;
    if (!parent) continue;
    const marker = new Mesh(new BoxGeometry(MARKER_SIZE, MARKER_SIZE, MARKER_SIZE), mat);
    marker.name = d.name; // 더미 이름 그대로 — 웹이 이름으로 인식
    marker.userData[MARKER_FLAG] = true;
    // 리프 더미의 로컬 변환을 그대로 복사 → 같은 부모에 붙여 월드 위치 보존
    marker.position.copy(d.position);
    marker.quaternion.copy(d.quaternion);
    marker.scale.copy(d.scale);
    parent.add(marker);
    parent.remove(d);
    count++;
  }
  return count;
}

/** 머티리얼에서 검사할 텍스처 슬롯들. */
const TEX_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap',
  'aoMap', 'bumpMap', 'specularMap', 'alphaMap',
] as const;

/** 이미지가 디코드 완료되어 그릴 수 있는 상태인지. */
function imageReady(img: unknown): boolean {
  if (!img) return false;
  const i = img as { naturalWidth?: number; width?: number };
  return (i.naturalWidth ?? 0) > 0 || (i.width ?? 0) > 0;
}

/** 텍스처 최대 대기 시간(ms). 임베드 텍스처가 비동기로 디코드될 시간을 충분히 확보. */
const TEX_WAIT_MS = 15000;
/** 폴링 간격(ms). */
const TEX_POLL_MS = 100;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * FBX 임베드 텍스처는 `parse()` 직후 `texture.image`가 아직 **null**이고, FBXLoader가
 * blob URL → ImageLoader로 **비동기 할당**한다. 따라서 한 번의 await로는 기다릴 수 없어,
 * 모든 텍스처의 image가 디코드될 때까지 **폴링**한다. 끝내 무효한 텍스처만 머티리얼에서 제거해
 * export 실패("No valid image data")를 막는다.
 */
async function prepareTextures(root: Object3D): Promise<number> {
  const collect = (): { mat: Material & Record<string, unknown>; key: string; tex: Texture }[] => {
    const found: { mat: Material & Record<string, unknown>; key: string; tex: Texture }[] = [];
    root.traverse((o) => {
      const m = (o as Mesh).material;
      const mats = Array.isArray(m) ? m : m ? [m] : [];
      for (const mat of mats) {
        const rec = mat as Material & Record<string, unknown>;
        for (const key of TEX_SLOTS) {
          const tex = rec[key];
          if (tex && (tex as Texture).isTexture) found.push({ mat: rec, key, tex: tex as Texture });
        }
      }
    });
    return found;
  };

  const start = Date.now();
  // 모든 텍스처 image가 준비될 때까지(또는 타임아웃까지) 폴링.
  // 할당은 됐으나 디코드 전인 이미지는 decode()로 가속.
  for (;;) {
    const pending = collect().filter((f) => !imageReady(f.tex.image));
    if (pending.length === 0) break;
    if (Date.now() - start > TEX_WAIT_MS) break;
    for (const f of pending) {
      const el = f.tex.image as (HTMLImageElement & { decode?: () => Promise<void> }) | undefined;
      if (el && typeof el.decode === 'function') el.decode().catch(() => {});
    }
    await sleep(TEX_POLL_MS);
  }

  let textureCount = 0;
  for (const f of collect()) {
    if (imageReady(f.tex.image)) {
      textureCount++;
      // ⭐ WebP 압축 export — GLTFExporter 가 texture.userData.mimeType 을 존중해
      // EXT_texture_webp 로 내보낸다(품질 0.8). PNG 대비 GLB 크기 1/4~1/10 →
      // 웹 설계화면 로드/파싱/업로드 시간 대폭 단축. 알파 채널도 WebP 가 지원.
      // (웹 GLTFLoader 는 EXT_texture_webp 기본 지원 확인됨)
      f.tex.userData.mimeType = 'image/webp';
      f.tex.needsUpdate = true;
    } else {
      f.mat[f.key] = null; // 유효하지 않은 텍스처 제거 → export 안전
      (f.mat as Material).needsUpdate = true;
    }
  }
  return textureCount;
}

/** GLTFExporter를 Promise로 감싸 GLB(ArrayBuffer)를 반환. */
function exportGlb(root: Object3D): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('GLTFExporter가 binary가 아닌 결과를 반환'));
      },
      (err) => reject(err),
      { binary: true, maxTextureSize: MAX_TEXTURE_SIZE },
    );
  });
}

export interface FbxConvertResult {
  glb: ArrayBuffer;
  markerCount: number;
  meshCount: number;
  /** WebP 로 임베드된 유효 텍스처 수. */
  textureCount: number;
  /** 변환 소요 시간(ms). */
  elapsedMs: number;
}

/**
 * FBX(ArrayBuffer) → GLB(ArrayBuffer). 더미는 이름 마커 메시로 보존.
 * @throws 파싱/내보내기 실패 시
 */
export async function convertFbxToGlb(fbx: ArrayBuffer): Promise<FbxConvertResult> {
  const t0 = performance.now();
  const loader = new FBXLoader();
  const root = loader.parse(fbx, '');

  const markerCount = injectDummyMarkers(root);

  // mm → m 정규화: 웹 설계화면이 GLB를 미터로 가정하므로 맞춘다(미적용 시 영역 변형 폭주).
  root.scale.multiplyScalar(MM_TO_M);
  root.updateMatrixWorld(true);

  const textureCount = await prepareTextures(root); // 임베드 텍스처 디코드 대기 + 무효 텍스처 정리 + WebP 마킹

  let meshCount = 0;
  root.traverse((o) => { if (isMeshNode(o)) meshCount++; });

  const glb = await exportGlb(root);
  return { glb, markerCount, meshCount, textureCount, elapsedMs: performance.now() - t0 };
}

/** ArrayBuffer(GLB) → data URL (model/gltf-binary). IDB 저장/iframe 로드용. */
export function glbToDataUrl(glb: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(glb);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:model/gltf-binary;base64,${btoa(binary)}`;
}

/** 디버그용 — 객체 트리의 메시 이름 목록과 전체 bbox 요약. */
export function summarizeObject(root: Object3D): { meshes: string[]; bbox: { min: number[]; max: number[] } } {
  const meshes: string[] = [];
  root.traverse((o) => { if (isMeshNode(o)) meshes.push(o.name || '(unnamed)'); });
  const box = new Box3().setFromObject(root);
  return { meshes, bbox: { min: box.min.toArray(), max: box.max.toArray() } };
}
