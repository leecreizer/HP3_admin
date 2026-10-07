import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 실시간 재질 제작 도구의 표시 모델·바닥 — 쿠지알러 모델(.pop)은 쓰지 않고 같은 모양을 만들어 쓴다.
 * 1 단위 = 1 m. 모든 모델의 UV 는 ‘미터’로 맞춰 두어, 맵 반복 = 1000 / 상품 크기(mm) 하나로 실제 크기가 된다.
 */

export type ModelPart = { geo: THREE.BufferGeometry; position: [number, number, number]; rotation?: [number, number, number] };
export type ModelMesh = { parts: ModelPart[]; doubleSide?: boolean };

function scaleUv(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

function rectShape(w: number, h: number, hole?: [number, number]) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2, h / 2); s.lineTo(-w / 2, h / 2); s.closePath();
  if (hole) {
    const p = new THREE.Path();
    p.moveTo(-hole[0] / 2, -hole[1] / 2); p.lineTo(-hole[0] / 2, hole[1] / 2); p.lineTo(hole[0] / 2, hole[1] / 2); p.lineTo(hole[0] / 2, -hole[1] / 2); p.closePath();
    s.holes.push(p);
  }
  return s;
}

/** 앞면(XY)에서 투영한 UV — 몰딩 옆면·경사면도 앞면 무늬와 이어진다 */
const planarUv = {
  generateTopUV: (_g: unknown, v: number[], a: number, b: number, c: number) => [a, b, c].map((i) => new THREE.Vector2(v[i * 3], v[i * 3 + 1])),
  generateSideWallUV: (_g: unknown, v: number[], a: number, b: number, c: number, d: number) => [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3], v[i * 3 + 1])),
};

/** 판재 모델 — 바탕 판 + 바깥 테 + 몰딩 테 + 가운데가 도드라진 판(문짝) */
function board(): THREE.BufferGeometry {
  const ex = (shape: THREE.Shape, depth: number, bevel: number, seg: number, z: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: 2, UVGenerator: planarUv as unknown as THREE.UVGenerator });
    g.translate(0, 0, z);
    return g.toNonIndexed();
  };
  const parts = [
    ex(rectShape(0.9, 1.2), 0.02, 0.003, 2, 0),
    ex(rectShape(0.9, 1.2, [0.72, 1.02]), 0.012, 0.008, 3, 0.024),
    ex(rectShape(0.68, 0.98, [0.6, 0.9]), 0.008, 0.014, 4, 0.024),
    ex(rectShape(0.46, 0.76), 0.006, 0.04, 5, 0.024),
  ];
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }));
}

/** 천 모델 — 공(반지름 0.42 m, 중심 높이 0.6 m) 위에 덮은 천: 윗부분은 공을 따르고, 아래로 퍼지며 주름 7개, 밑단은 바닥에 닿아 모서리가 퍼진다 */
function cloth(): THREE.BufferGeometry {
  const SIZE = 2.6, R = 0.42, HC = 0.6, N = 220;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const s0 = (R * Math.PI) / 2;
  const fold = (th: number, k: number) => Math.sin(th * 7 + 0.6) * 0.06 * Math.pow(k, 1.4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z), th = Math.atan2(z, x);
    let rad: number, y: number;
    if (r < s0) { const phi = r / R; rad = R * Math.sin(phi); y = HC + R * Math.cos(phi); }
    else if (r < s0 + HC) { const k = (r - s0) / HC; rad = R + 0.16 * k * k + fold(th, k); y = HC * (1 - k); }
    else { rad = R + 0.16 + fold(th, 1) + (r - s0 - HC); y = 0.004; }
    pos.setXYZ(i, Math.cos(th) * rad, y, Math.sin(th) * rad);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return scaleUv(g, SIZE, SIZE);
}

/** 셰이더볼 바닥 받침 (회전체) */
function pedestal(): THREE.BufferGeometry {
  const prof = [[0.001, 0], [0.46, 0], [0.475, 0.015], [0.47, 0.05], [0.44, 0.075], [0.36, 0.1], [0.2, 0.11], [0.001, 0.11]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 96);
  return scaleUv(g, 2 * Math.PI * 0.46, 0.7);
}

export function modelMesh(id: number): ModelMesh {
  switch (id) {
    case 1: return { parts: [{ geo: board(), position: [0, 0.62, -0.03] }] };
    case 2: return { parts: [{ geo: cloth(), position: [0, 0, 0] }], doubleSide: true };
    case 3: return { parts: [{ geo: new RoundedBoxGeometry(1, 1, 1, 6, 0.045), position: [0, 0.5, 0] }] };
    case 4: return {
      parts: [
        { geo: scaleUv(new THREE.SphereGeometry(0.43, 128, 96), 2 * Math.PI * 0.43, Math.PI * 0.43), position: [0, 0.53, 0] },
        { geo: pedestal(), position: [0, 0, 0] },
      ],
    };
    case -1: return { parts: [{ geo: scaleUv(new THREE.PlaneGeometry(1.2, 1.2, 320, 320), 1.2, 1.2), position: [0, 0.68, 0] }], doubleSide: false };
    default: return { parts: [{ geo: scaleUv(new THREE.SphereGeometry(0.5, 160, 120), Math.PI, Math.PI / 2), position: [0, 0.5, 0] }] };
  }
}

/** 바닥 — 1 m 격자와 ‘1000 * 1000mm’ 글자 (쿠지알러 바닥처럼 옅게) */
export function floorTexture(dark: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = dark ? '#34383e' : '#f2f3f5';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = dark ? '#454a51' : '#e3e5e9';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  g.fillStyle = dark ? '#4c5158' : '#e0e2e6';
  g.font = 'italic 600 44px sans-serif';
  g.textAlign = 'center';
  g.fillText('1000 * 1000mm', 256, 300);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
