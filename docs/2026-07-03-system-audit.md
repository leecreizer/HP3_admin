# HP3_admin 시스템 감사 보고서

- **감사일**: 2026-07-03
- **대상**: HP3_admin (React 19 + Vite, GitHub Pages 배포, Webplaner iframe 임베드)
- **범위**: 소스 139개 파일 전수, 핵심 로직 라인 단위 검토

## 1. 데이터 관리

| # | 발견 | 위치 | 심각도 |
|---|---|---|---|
| 1-1 | **localStorage quota 초과 시 완전 무응답 실패** — `saveProductsState`가 `catch { /* 무시 */ }`로 조용히 삼킴. 사용자는 저장된 것처럼 보이지만 실제 반영 안 될 수 있음(alert/toast 전무) | `src/pages/Products.tsx:782, 798-799` | **상** |
| 1-2 | **GLB를 IndexedDB에 base64 data URL로 저장** — Blob이 아닌 문자열 저장이라 33% 용량 인플레이션 + 변환 비용. quota 초과 시 처리 로직 전무 | `src/data/fbxConvert.ts:277-284`, `src/data/assetStore.ts:22-32` | **상** |
| 1-3 | **스키마 버전 불일치 시 데이터 폐기** — `PRODUCTS_STORE_VERSION` 다르면 마이그레이션 없이 `{}` 리턴 → 전체 상품 데이터 소실과 동일 효과 | `src/pages/Products.tsx:749-753` | **상** |
| 1-4 | `SWAP_VERSION` 체크도 동일 패턴(버전 다르면 폐기) | `src/data/groups.ts:172-190` | 중 |
| 1-5 | **백업/복원 불완전** — `BACKUP_KEYS`에 `hp3-renders`, `hp3-webplaner-url`, AptPlans 키 누락. IDB의 GLB 바이너리는 백업 대상 아님(복원해도 모델 미복구) | `src/pages/Settings.tsx:37-54` | 중 |
| 1-6 | 백업이 수동 버튼뿐, 자동/주기 백업 없음. 캐시 삭제·기기 변경 시 전체 데이터 영구 소실 | `src/pages/Settings.tsx` | 상 |

## 2. 오류 위험

| # | 발견 | 위치 | 심각도 |
|---|---|---|---|
| 2-1 | Draco 압축 실패 폴백은 정상 구현(비압축 GLB 사용, 등록 항상 성공) | `src/data/fbxConvert.ts:246-251` | 정보(양호) |
| 2-2 | 텍스처 대기 타임아웃(15초) 초과 시 무효 텍스처 조용히 제거 — "일부 텍스처 누락" 안내 없음 | `src/data/fbxConvert.ts:117-166` | 중 |
| 2-3 | **postMessage 발신 origin `'*'`, 수신 `e.origin` 검증 전무** + `?planer=` 쿼리로 iframe URL 임의 주입 가능(검증 없이 localStorage 저장·재사용) → 악성 링크로 관리자 상태 조작 가능 | `src/pages/Design.tsx:18-26, 226-251, 271-292, 341-342, 441-484` | **상** |
| 2-4 | postMessage 수신 필드 미검증(`d.code`, `d.doorSlots` 등 런타임 타입 체크 없음) — 2-3과 결합 시 도어 부착 로직 오염 가능 | `src/pages/Design.tsx:226-251` | 중 |
| 2-5 | Pages SPA 라우팅 이슈는 실질 없음(react-router 미사용, 상태 기반 렌더) | `src/App.tsx` | 정보 |
| 2-6 | 시드 병합 실패 전부 무음 처리(catch ignore) | `src/main.tsx:24-58` | 하 |

## 3. 성능

| # | 발견 | 위치 | 심각도 |
|---|---|---|---|
| 3-1 | **Products.tsx 3,765줄 단일 파일** — 6개 관리 패널+리스트+등록모달+변환이 응집. 분리 후보: ProductList / ProductRegisterModal / CatalogPanel / ModelKindPanel / FieldsPanel / FiltersPanel / QuoteGroupsPanel / evalFormula(→data/formula.ts) | `src/pages/Products.tsx` | 중 |
| 3-2 | **FBX→GLB 변환이 메인 스레드 동기 실행**(Web Worker 미사용) — 대형 FBX에서 UI 먹통 체감 | `src/data/fbxConvert.ts` 전체 | 중 |
| 3-3 | 상품 리스트 가상 스크롤 없음, useMemo 사용 적음(규모 대비) | `src/pages/Products.tsx` | 하~중 |
| 3-4 | `glbToDataUrl` 32KB 청크 btoa — stack overflow는 회피했으나 UI 블로킹 존재 | `src/data/fbxConvert.ts:277-284` | 하 |

## 4. 운영

| # | 발견 | 위치 | 심각도 |
|---|---|---|---|
| 4-1 | **모든 운영 데이터가 브라우저 로컬에만 존재** — 서버 백엔드 없음. 협업 불가, 기기 변경/캐시 삭제 시 영구 소실. **가장 큰 구조적 리스크** | 아키텍처 전반 | **상** |
| 4-2 | Pages 배포 파이프라인 정상(tsc 포함이라 타입 에러 시 배포 차단됨). 별도 테스트/린트 게이트는 없음 | `.github/workflows/deploy.yml` | 하 |
| 4-3 | Webplaner 주소 하드코딩 — 두 리포 배포 동기화(postMessage 스키마 정합) 보장 CI 없음 | `src/pages/Design.tsx:27` | 중 |
| 4-4 | 시드 데이터 "누락 키만 채움" 정책 — 시드 갱신 전략 명문화 안 됨 | `src/main.tsx:8-58` | 하 |
| 4-5 | 백업 파일에 개인정보(`hp3-users`) 평문 export — 유출 시 노출 리스크 | `src/pages/Settings.tsx:37-46` | 중 |

## 5. 보안

| # | 발견 | 위치 | 심각도 |
|---|---|---|---|
| 5-1 | **로그인이 순수 클라이언트 전용** — 자격 증명 검증 없음. DevTools로 임의 계정 전환·권한 상승 즉시 가능 | `src/App.tsx:47-58`, `config.ts` | **상** |
| 5-2 | 메뉴 숨김은 UX 수준 접근 제어일 뿐 — 정적 서빙 구조상 서버측 인가 불가(4-1의 귀결) | 아키텍처 전반 | 상 |
| 5-3 | XSS: `dangerouslySetInnerHTML` 0건, `evalFormula`는 자체 파서(eval 미사용) — 주입 경로 미확인(양호) | 전역 | 정보(양호) |
| 5-4 | 2-3의 origin 미검증은 CWE-346 해당 | `src/pages/Design.tsx` | 상 |

## 종합 순위 Top 10 (운영 영향도 기준)

| 순위 | 항목 | 심각도 | 조치 방향 |
|---|---|---|---|
| 1 | 서버 백엔드 부재로 인한 데이터 고립/소실 (4-1) | 상 | 백엔드(DB+API) 도입. 단기: 클라우드 동기화 또는 자동 백업 알림 |
| 2 | 버전 불일치 시 데이터 폐기 (1-3) | 상 | 실제 마이그레이션 함수 작성, 폐기 전 export 유도 |
| 3 | postMessage origin 미검증 + `?planer=` 주입 (2-3) | 상 | targetOrigin 고정, 수신 origin 화이트리스트, planer 값 allowlist 검증 |
| 4 | 클라이언트 전용 로그인 권한 우회 (5-1) | 상 | 서버 인증(OIDC/JWT) 도입 전까지 신뢰 사용자 전용임을 문서화 |
| 5 | localStorage 저장 실패 무음 처리 (1-1) | 상 | 실패 시 명시적 경고 + export 유도 |
| 6 | GLB base64 저장 방식 (1-2) | 상 | IDB에 Blob 직접 저장(33% 절감), quota 안내 추가 |
| 7 | 백업 불완전 (1-5) | 중 | BACKUP_KEYS 전수 반영 + IDB 자산 포함 zip 백업 |
| 8 | Products.tsx 3,765줄 (3-1) | 중 | 패널 단위 분리, evalFormula 유틸 분리 |
| 9 | FBX 변환 메인스레드 블로킹 (3-2) | 중 | Web Worker 이관 또는 진행률+취소 지원 |
| 10 | 백업 개인정보 평문 (4-5) | 중 | 마스킹 옵션, 취급주의 명시 |

## 결론

코드 품질 자체(FBX 변환, Draco 폴백, evalFormula 파서)는 방어적으로 잘 작성되어 있으나, **최대 리스크는 아키텍처 수준**입니다 — 서버 백엔드 없이 브라우저 로컬 저장소만으로 운영되는 구조가 협업 불가/데이터 소실/보안 경계 부재의 근본 원인. 단기적으로 1~6번(데이터 소실·보안) 처리가 시급하고, 중장기 로드맵에 최소 API 서버 + DB 도입 필수.