import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Draco 압축 GLB(KHR_draco_mesh_compression) 디코더 — fbxConvert 가 Draco 로 내보내므로 필수.
// 미연결 시 "파일을 불러올 수 없습니다" 로 보임(형식 오류가 아니라 디코더 부재).
const dracoLoader = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getAsset } from '../data/assetStore';

export type Asset = {
  id: string;
  name: string;
  type: '모델링' | '재질' | '텍스쳐' | '기타';
  url?: string;
};

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const WEB_3D = ['glb', 'gltf', 'obj', 'fbx'];

/** 모델 파일을 three.js로 렌더 (glb/gltf/obj/fbx). 그 외는 불가 안내 */
function ModelCanvas({ asset }: { asset: Asset }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !asset.url) return;
    const e = ext(asset.name);

    let width = mount.clientWidth || 400;
    let height = mount.clientHeight || 400;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f6f7);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1000);
    camera.position.set(2.5, 2, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d99a6, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(5, 8, 6);
    scene.add(dir);
    // 환경맵(IBL) — 머터리얼이 PBR/금속성이라 검게 나오는 것 방지
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // 레이아웃 전 크기가 0이거나 변할 때 캔버스/카메라 갱신 (검은 화면 방지)
    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      width = w; height = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let raf = 0;
    let disposed = false;

    const frameObject = (obj: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      obj.position.sub(center);
      const dist = maxDim * 2.2;
      camera.position.set(dist * 0.7, dist * 0.55, dist);
      camera.near = maxDim / 100;
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const onLoad = (obj: THREE.Object3D) => {
      if (disposed) return;
      scene.add(obj);
      frameObject(obj);
      setLoading(false);
    };
    const onError = () => {
      if (disposed) return;
      setError('파일을 불러올 수 없습니다 (형식 오류 또는 손상)');
      setLoading(false);
    };

    try {
      if (e === 'glb' || e === 'gltf') {
        new GLTFLoader().setDRACOLoader(dracoLoader).load(asset.url, (g) => onLoad(g.scene), undefined, onError);
      } else if (e === 'obj') {
        new OBJLoader().load(asset.url, onLoad, undefined, onError);
      } else if (e === 'fbx') {
        new FBXLoader().load(asset.url, onLoad, undefined, onError);
      } else {
        setError('지원하지 않는 형식');
        setLoading(false);
      }
    } catch {
      onError();
    }

    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [asset]);

  return (
    <div className="asset-viewer-3d" ref={mountRef}>
      {loading && !error && <span className="asset-viewer-msg">불러오는 중…</span>}
      {error && <span className="asset-viewer-msg">{error}</span>}
    </div>
  );
}

/** 선택된 에셋 1개를 종류에 맞게 미리보기 — url 없으면 IDB에서 하이드레이트 */
export function AssetViewer({ asset }: { asset: Asset | null }) {
  const [idbUrl, setIdbUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let on = true;
    setIdbUrl(undefined);
    if (asset && !asset.url) getAsset(asset.id).then((u) => { if (on) setIdbUrl(u); });
    return () => { on = false; };
  }, [asset]);
  const resolved: Asset | null = asset ? { ...asset, url: asset.url ?? idbUrl } : null;
  return <AssetViewerInner asset={resolved} />;
}

function AssetViewerInner({ asset }: { asset: Asset | null }) {
  if (!asset) {
    return (
      <div className="asset-viewer empty">
        <span className="edit-thumb-empty">에셋을 선택하면 미리보기가 표시됩니다</span>
      </div>
    );
  }

  // 텍스쳐/이미지
  if (asset.type === '텍스쳐' && asset.url) {
    return (
      <div className="asset-viewer">
        <img src={asset.url} alt={asset.name} className="asset-viewer-img" />
      </div>
    );
  }

  // 모델링: 웹에서 렌더 가능한 포맷
  if (asset.type === '모델링' && asset.url && WEB_3D.includes(ext(asset.name))) {
    return (
      <div className="asset-viewer">
        <ModelCanvas asset={asset} />
        <span className="asset-viewer-hint">드래그로 회전 · 휠로 확대</span>
      </div>
    );
  }

  // AssetBundle 등 브라우저에서 직접 못 여는 모델
  if (asset.type === '모델링') {
    return (
      <div className="asset-viewer info">
        <span className="edit-thumb-empty">
          <b>{ext(asset.name).toUpperCase()}</b>
          유니티 AssetBundle 등은 브라우저에서 직접 미리보기할 수 없습니다.
          서버에서 glTF로 변환하면 3D 미리보기가 가능합니다.
        </span>
      </div>
    );
  }

  // 재질/기타
  return (
    <div className="asset-viewer info">
      <span className="edit-thumb-empty">
        <b>{asset.type}</b>
        {asset.name}
      </span>
    </div>
  );
}