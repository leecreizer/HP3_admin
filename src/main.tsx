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
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();