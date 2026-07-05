# 작업 현황 인수인계 (2026-07-03)

상세 인수인계 문서는 **Webplaner 저장소의 `docs/WORK_STATUS.md`** 참조
(https://github.com/leecreizer/Webplaner — 두 시스템 공통 현황·환경 셋업·다음 작업 정리).

## HP3_admin 요점
- 로컬 개발: `npm i && npm run dev` (포트 5180 고정)
- 설계 메뉴가 웹플래너를 iframe 로드 — 기본 host:5190(로컬) / github.io에서는 leecreizer.github.io/Webplaner
  (localStorage `hp3-webplaner-url` 우선 — 다른 주소가 뜨면 `?planer=` 쿼리로 갱신)
- 배포: main 푸시 → GitHub Pages 자동 (deploy.yml, tsc 포함)
- FBX→GLB 변환 파이프라인: `src/data/fbxConvert.ts` — 정점용접+WebP+Draco (21.93MB→1.50MB 실측),
  미리보기 `AssetViewer.tsx`에 DRACOLoader(`public/draco/`) 연결
- 감사 리포트: `docs/2026-07-03-system-audit.md` (데이터 폐기·postMessage origin·백엔드 부재 등 Top10)
