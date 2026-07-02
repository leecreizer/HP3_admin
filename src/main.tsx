import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * 첫 실행(빈 브라우저) 시 기본 데이터 시드.
 * public/default-seed.json = { localStorageKey: stringValue } 덤프.
 * 누락된 키만 채우므로 기존 데이터가 있는 브라우저는 건드리지 않는다.
 * (시드 파일은 정적 자산 — 시드가 필요할 때만 fetch하여 번들 부담 없음)
 */
const SEED_KEYS = ['hp3-products-state', 'hp3-swap-groups', 'hp3-users', 'hp3-org-brands', 'hp3-org-groups', 'hp3-login-user', 'hp3-admin-config'] as const;

/**
 * 깃허브(public/models)의 GLB 모델링을 테스트 상품으로 자동 등록.
 * - 목록·연결 정보는 public/models/manifest.json 에서 관리 (파일 추가 = GLB + manifest 한 줄)
 * - 컨텐츠 코드는 자동 생성(GHMDL + 순번, manifest 순서 기준 결정적) — 수정 불가 정책
 * - modelUrl은 현재 접속 주소 기준(로컬 dev·GitHub Pages 모두 동작), 파일명 기준으로 중복 등록 방지
 */
type ModelManifestItem = {
  file: string; name: string; group: string; quote: string; kind: string;
  folder: string; w: number; d: number; h: number; modeling: string;
};

async function seedSampleModels() {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? 'null');
    if (!raw || !Array.isArray(raw.products)) return;
    const res = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`);
    if (!res.ok) return;
    const manifest = await res.json() as ModelManifestItem[];
    const modelBase = new URL(`${import.meta.env.BASE_URL}models/`, window.location.origin).href;
    const registered = new Set(
      (raw.products as { modelUrl?: string }[])
        .map((p) => p.modelUrl?.split('/').pop())
        .filter(Boolean),
    );
    const today = new Date().toISOString().slice(0, 10);
    const added = manifest
      .filter((m) => !registered.has(m.file))
      .map((m, i) => {
        const code = `GHMDL${String(manifest.indexOf(m) + 1).padStart(4, '0')}`; // 자동 생성 — manifest 순서 기준
        void i;
        return {
          contentCode: code, name: m.name, brand: '한샘', productGroup: m.group, quoteGroup: m.quote,
          productCode: code, modelCode: '', itemCode: '', visible: true, permission: '전체',
          w: m.w, d: m.d, h: m.h, placement: '바닥', placeHeight: 0,
          attrType: '모델링', modelingType: m.modeling, productKind: m.kind, modelKind: '',
          thumb: '', folderId: m.folder, filterValues: [], opValues: {},
          modelUrl: `${modelBase}${m.file}`,
          updatedAt: today, updatedBy: '이대우',
        };
      });
    if (added.length === 0) return;
    raw.products = [...added, ...raw.products];
    localStorage.setItem('hp3-products-state', JSON.stringify(raw));
  } catch { /* ignore */ }
}

async function bootstrap() {
  const needSeed = SEED_KEYS.some((k) => localStorage.getItem(k) === null);
  if (needSeed) {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}default-seed.json`);
      if (res.ok) {
        const dump = await res.json() as Record<string, string | null>;
        for (const k of SEED_KEYS) {
          if (localStorage.getItem(k) === null && typeof dump[k] === 'string') localStorage.setItem(k, dump[k]);
        }
      }
    } catch { /* 시드 실패해도 앱은 기존 시드 상수로 동작 */ }
  }
  await seedSampleModels();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();