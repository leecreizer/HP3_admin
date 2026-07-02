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
 * 깃허브(public/models)에 올린 GLB 모델링을 테스트 상품으로 자동 등록.
 * modelUrl은 현재 접속 주소 기준(로컬 dev·GitHub Pages 모두 동작)이며, 이미 등록돼 있으면 건너뜀.
 */
const SAMPLE_MODELS = [
  { code: 'GHMDL0001', name: '샘플 붙박이장 BBIL10132', file: 'BBIL10132.glb', group: '수납', quote: '붙박이장', kind: '스윙장', folder: 'f-storage', w: 1200, d: 620, h: 2350, modeling: '설계형' },
  { code: 'GHMDL0002', name: '샘플 가구 130', file: '130.glb', group: '가구', quote: '가구', kind: '', folder: 'f-furniture', w: 800, d: 800, h: 750, modeling: '배치형' },
  { code: 'GHMDL0003', name: '샘플 소품 게임보이', file: 'game_boy_classic.glb', group: '소품', quote: '소품', kind: '', folder: 'f-props', w: 90, d: 30, h: 150, modeling: '배치형' },
  { code: 'GHMDL0004', name: '샘플 소품 샐러드', file: 'salad_plate.glb', group: '소품', quote: '소품', kind: '', folder: 'f-props', w: 250, d: 250, h: 60, modeling: '배치형' },
];

function seedSampleModels() {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? 'null');
    if (!raw || !Array.isArray(raw.products)) return;
    if (raw.products.some((p: { contentCode?: string }) => p.contentCode === SAMPLE_MODELS[0].code)) return; // 이미 등록됨
    const modelBase = new URL(`${import.meta.env.BASE_URL}models/`, window.location.origin).href;
    const today = new Date().toISOString().slice(0, 10);
    const added = SAMPLE_MODELS.map((m) => ({
      contentCode: m.code, name: m.name, brand: '한샘', productGroup: m.group, quoteGroup: m.quote,
      productCode: m.code, modelCode: '', itemCode: '', visible: true, permission: '전체',
      w: m.w, d: m.d, h: m.h, placement: '바닥', placeHeight: 0,
      attrType: '모델링', modelingType: m.modeling, productKind: m.kind, modelKind: '',
      thumb: '', folderId: m.folder, filterValues: [], opValues: {},
      modelUrl: `${modelBase}${m.file}`,
      updatedAt: today, updatedBy: '이대우',
    }));
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
  seedSampleModels();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();