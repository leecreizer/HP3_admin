# 파츠 모델러 (PartEditor) 설계

작성일: 2026-07-13
대상: HP3_admin (React 19 + Vite + TypeScript)

## 목표

어드민에서 판재(파츠)를 **수치로 직접 정의**하고, 향후 그 파츠들을 조합해 수납장 같은 완제품을 만든다. 모델 파일(GLB) 의존 없이 어드민만으로 형상을 생성한다.

**MVP 범위**: 2D 단면 스케치 + 익스트루드(두께) → 파츠 저장(재사용 라이브러리). 어드민 내 3D 미리보기까지.

**MVP 제외(후속 단계)**: 조립 모드, 리볼브, 로프트, 메쉬 편집, 웹플래너 3D 렌더 연동.

## 전체 흐름

스케치(2D 단면) → 두께 부여 → 3D 익스트루드 미리보기 → 파츠 저장(라이브러리)

## 아키텍처

- **새 페이지 `PartEditor`** (`src/pages/PartEditor.tsx`). 사이드바에 "파츠 모델러" 메뉴 추가.
- **`Products.tsx`는 수정하지 않는다.** 자체 상태·로직을 가진 독립 페이지.
- **3D 미리보기**: 이 페이지에만 `@react-three/fiber` + `three` + `@react-three/drei`(OrbitControls) 국소 도입. `THREE.ExtrudeGeometry`로 형상 생성.
- **2D 스케처**: 외부 라이브러리 없이 SVG 기반 자체 구현. mm 단위, 그리드 스냅. 세그먼트는 직선(line) + 원호(arc).
- **저장**: 기존 어드민 패턴대로 localStorage(+필요 시 IndexedDB). 파츠는 `parts` 컬렉션으로 별도 저장(상품과 분리).

## 컴포넌트 경계

| 유닛 | 역할 | 의존 |
|---|---|---|
| `PartEditor.tsx` | 페이지 셸: 툴바 + 좌(스케처)/우(3D) 레이아웃, 파츠 CRUD | store, 스케처, 3D뷰 |
| `SketchCanvas` | 2D 단면 편집(점 추가/이동/삭제, 세그먼트 타입, 구멍, 치수 입력, 그리드 스냅) | profile 상태 |
| `ExtrudePreview` | R3F 캔버스, profile+두께 → ExtrudeGeometry 실시간 렌더, Orbit/줌, 재질색 | three |
| `partStore` | 파츠 라이브러리 상태 + localStorage 영속 | - |
| `partGeometry.ts` | profile(Contour[]) → THREE.Shape 변환, bbox 계산 | three |

각 유닛은 내부를 몰라도 사용 가능해야 한다(SketchCanvas는 profile만, ExtrudePreview는 profile+extrude만 받는다).

## 데이터 모델

```ts
interface Part {
  id: string;
  name: string;              // 예: 좌측판
  profile: Profile;          // 2D 단면
  method: 'extrude';         // 확장 대비(향후 'revolve' | 'loft')
  extrude: {
    depth: number;           // 두께(mm)
    bevel?: { size: number; thickness: number };
  };
  material?: { color: string; name?: string };
  bbox: { w: number; h: number; d: number };  // 자동 계산
  thumb?: string;            // 자동 생성 썸네일(SVG data URL)
  createdAt: number;
  updatedAt: number;
}

interface Profile {
  units: 'mm';
  contours: Contour[];       // [0]=외곽, 이후=구멍(holes)
}

interface Contour {
  closed: boolean;
  segments: Segment[];
}

type Segment =
  | { type: 'line'; to: [number, number] }
  | { type: 'arc'; to: [number, number]; radius: number; ccw?: boolean };
```

- `bbox`는 스케치 외곽 + 두께로 자동 산출 → 향후 조립 스냅·견적에 재사용.
- `method` 필드로 리볼브/로프트 확장 시 데이터 구조를 유지한다.

## 화면 구성

좌우 분할 레이아웃:

- **상단 툴바**: 새 파츠 / 저장 / 파츠 라이브러리(목록·불러오기·복제·삭제).
- **좌측 SketchCanvas**: 그리드 캔버스, 점 추가/이동/삭제, 세그먼트 타입(직선/원호) 전환, 치수 입력 필드, 구멍 추가.
- **우측 ExtrudePreview**: 두께 입력/슬라이더, 실시간 익스트루드, 회전/줌(OrbitControls), 재질 색.

## 데이터 흐름

1. 사용자가 SketchCanvas에서 점을 찍어 `profile.contours` 갱신.
2. `partGeometry.ts`가 profile → THREE.Shape 변환, ExtrudePreview가 depth로 ExtrudeGeometry 생성해 렌더.
3. bbox 자동 재계산 → 툴바/치수 표시.
4. 저장 시 partStore가 Part를 localStorage에 영속, 썸네일 생성.

## 에러 처리

- **열린 컨투어/자기교차/점 2개 미만**: 익스트루드 불가 → 미리보기에 경고 표시, 저장 차단.
- **원호 반경이 두 점 거리보다 작음**: 반경 자동 보정 또는 경고.
- **구멍이 외곽 밖**: 경고, 무시.
- 잘못된 수치 입력(음수/NaN): 입력 필드에서 검증.

## 테스트

- `partGeometry.ts` 단위 테스트: profile → Shape 정점 수, bbox 계산 정확도, 구멍 처리.
- 검증 정책(웹플래너 경험): Playwright 브라우저가 불안정하므로, 형상 로직은 node 단위 테스트로 우선 검증하고 UI는 수동 확인.

## 확장 훅(자리만 확보)

- `method: 'extrude' | 'revolve' | 'loft'` — 리볼브/로프트 대비.
- 파츠 `export` 인터페이스 정의 → 다음 단계 "조립 모드"가 파츠를 소비.
- 웹플래너 렌더 연동은 2차(현재는 어드민 내 미리보기만).

## 버전

커밋 시 package.json/package-lock.json 버전 0.0.1 증가(기존 규칙).