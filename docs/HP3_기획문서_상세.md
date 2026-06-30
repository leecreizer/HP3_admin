# HomePlanner3 Admin — 상세 기획·기능 명세서

> 기준일 2026-06-26 · 현재 구현 코드 기준 (정책 / 룰·로직 구현 / 실제 작동 / 페이지별 화면·기능·동작 전부 포함)
> 표기: ✅구현완료 · ⚠️부분/한계 · ⬜미구현(추후)

---

# A. 제품 개요 & 아키텍처

## A-1. 목적
인테리어 콘텐츠(상품·모델링)를 등록·분류·권한관리하고, **설계 미리보기**에서 three.js 웹플래너에 상품/모델을 배치·자동조립(도어 등)·견적 확인하는 운영 어드민. stg 홈플래너 상품 라이브러리 구조를 참고하며, 부위 자동조립은 쿠지알러식 **수식/조건 + DP/POS 매칭**으로 동작.

## A-2. 기술 구성
- 어드민: Vite + React 19 + TS (`HP3_admin`, dev 5180)
- 설계 캔버스: R3F/three.js 웹플래너 (`homeplanner3-web`, dev 5190), iframe 임베드
- 통신: `window.postMessage` (targetOrigin `*`)
- 저장: localStorage(메타/설정) + IndexedDB(`hp3-assets`, 에셋 바이너리)

## A-3. 영속화 키
| 키 | 내용 | 저장소 |
|---|---|---|
| hp3-products-state | products, folders, productGroups, quoteGroups, kindsByGroup, modelsByGroup, filterGroups, fields | LS |
| hp3-swap-groups | groups, folders, folderModes, items, styles, categories | LS |
| hp3-users | 사용자 목록 | LS |
| hp3-org-brands / hp3-org-groups | 브랜드 / 사용자 그룹 | LS |
| hp3-login-user | 로그인 사용자 id | LS |
| hp3-assets (store: assets) | id → dataURL(GLB/이미지 등) | IndexedDB |

## A-4. 전역 정책 (모든 페이지 공통)
1. **명시적 저장**: 화면 편집은 메모리 상태에 반영되고, 각 페이지 **저장** 버튼으로만 localStorage 영속화(일부 즉시 영속 동작 제외 — 폴더 생성, 상품 등록/수정/복사 등은 즉시 persist).
2. **dirty 표시**: 미저장 변경 시 `● 미저장 변경` 배지.
3. **로그인 사용자 = 사용자 관리 등록자**. 권한 등급에 따라 메뉴·열람 제어.

---

# B. 로그인 & 권한 정책

## B-1. 로그인 사용자 결정 로직 ✅
```
allUsers = loadUsers()
loginUserId = localStorage['hp3-login-user']  (없으면 config.userAccount 이메일 매칭, 없으면 첫 사용자)
currentUser = allUsers.find(id == loginUserId)
isAdminUser = currentUser.role ∈ {최고관리자, 운영자}  (미해결이면 true=관리자 가정)
```
- 상단바 드롭다운으로 사용자 전환 → `hp3-login-user` 저장 → 이름/등급/이메일·최종수정자·설계 기본 시점에 반영.

## B-2. 권한(등급) 정책
- 권한 관리(scope=admin)에 등록된 등급만 사용자 "권한"으로 인정. 미등록 값은 목록에서 `–`, 셀렉트엔 "미지정"+정의 등급.
- 등급별 접근 메뉴 토글 → 미접근 메뉴 진입 시 "접근 권한 없음".

## B-3. 콘텐츠 노출 정책 (설계 미리보기) ✅
```
노출여부(visible=false) → 권한 무관 항상 제외
보는 사용자 == '__all__'(관리자 전체) → 모두 노출
그 외 → permission == '전체'  OR  보는사용자.groupIds 가 permission 그룹 포함
```
- **사용자 그룹(멤버십) ∩ 콘텐츠 사용자 그룹(노출대상)** 교집합 또는 '전체' 공개일 때만 노출.

---

# C. 페이지별 상세 (화면 / 기능 / 정책 / 동작 / 로직)

## C-1. 사용자 관리
**화면**: 좌 사용자 그룹 트리(브랜드>그룹, 너비 드래그) · 우 사용자 표 + 툴바.
**기능**
- 검색/정렬/상태필터(active/dormant/blocked), 사용자 추가·수정·삭제.
- 사용자별 권한(등급), 소속 **사용자 그룹(복수)**.
- 툴바: 전체선택 / 선택취소 / **사용자 그룹 설정**(팝오버) / 삭제 / 저장.
**정책·룰**
- 권한 셀렉트 = 권한 관리 등록 등급만. 등급에 없는 기존 값은 `–`.
- 최상위 그룹(브랜드) 추가는 **브랜드 관리에서만**.
- 사용자 그룹 설정 = 체크 상태가 곧 최종 소속(체크=추가, 해제=제거). 팝오버 열면 선택 사용자들의 기존 소속이 미리 체크.
**동작/로직**
- `saveCheckedGroups(ids)`: 체크 사용자 `groupIds = ids`로 덮어쓰기 → setChecked 초기화.
- 그룹 트리는 브랜드/그룹 공유 상태(브랜드 관리와 동일 데이터).

## C-2. 브랜드 관리
**기능**: 브랜드(최상위) 추가·이름변경·삭제, 브랜드 하위 그룹 추가·이름변경·삭제.
**정책**: 그룹 삭제 시 사용자 유지·소속만 해제. 브랜드 삭제 시 하위 그룹 함께 삭제(confirm).

## C-3. 권한 관리
**기능**: 운영자 등급 추가/이름변경/삭제(builtin 제외), 등급별 접근 메뉴 토글.
**동작**: 상단바 등급 전환 → allowedMenus 재계산 → 미접근 페이지면 첫 허용 메뉴로 이동.

## C-4. 상품 관리 — 폴더 패널
**화면**: 카테고리 설정 바(sticky 고정·불투명) + 노출/비노출 2섹션 트리.
**기능**: 폴더 추가(선택 폴더 하위 형제 생성)/이름변경/삭제, 대표 썸네일.
**정책·로직**
- 폴더 id `f-new-${Date.now()}-${seq}` (충돌 방지).
- ROOT(f-root 노출 / f-root-int 비노출)는 삭제·이동·이름변경 불가.
- 폴더 삭제 시 내부 상품은 상위로 이동, 하위 폴더 있으면 차단.
- 대표 썸네일 `folderRepThumb`: 사용자지정 > (초기화면 없음) > 직접 담긴 콘텐츠 첫 썸네일 > folder.png.
- 카테고리 바: `position:sticky; top:0` + `--card-solid` 불투명 + 패널 top padding 0(가림). 스크롤 자동닫힘 제거됨.

## C-5. 상품 관리 — 목록
**기능**: 검색/정렬/타입필터, 행 수정·삭제, 헤더 + 상품 등록 / 복사 / 저장.
**복사 로직** `copySelected` ✅: 체크 N개 전체 복제. `{...p}`로 기본정보+운영정보 전체 복사, `contentCode=원본-COPY(중복 시 -COPY2..)`, name `(복사)`, updatedAt/By 갱신, 목록 맨 위 + 즉시 persist + 체크 해제.

## C-6. 상품 관리 — 기본 정보 (폼)
**필드/배치**
- 상품명·브랜드·견적그룹·상품군·상품구분(상품군별)·모델구분(상품군별).
- 코드 2×2: [컨텐츠코드 | 상품코드] / [모델코드 | 품목코드]. 컨텐츠/상품코드 수정가능 여부는 **노출필드 editable** 적용.
- 사용자 그룹(=노출 대상, 전체/특정 그룹), 가격.
- **규격유무(라디오 규격/비규격, 기본 규격)** + **노출여부(토글)** 동일 줄.
- 속성구분(모델링 배치형/설계형, 텍스쳐, 머터리얼).
- 컨텐츠 크기 W/D/H, 배치 위치, 배치 높이.
- 스펙 URL·mall URL(복수), 필터.
- 썸네일 이미지 + 업로드 에셋.
**정책·로직**
- `fieldEditable(key)` = 노출필드 정의(default 허용). 코드 입력 disabled 제어, 변경분 저장.
- 모델구분/상품구분 옵션 = 상품군 선택 시 modelsByGroup/kindsByGroup.

## C-7. 상품 관리 — 업로드 에셋
**기능**: 에셋 업로드 → **등록/취소**, 미리보기(항상 표시), 제거.
**로직** ✅
- `onAssetUpload`: FileReader.readAsDataURL → **data URL** pendingAsset(즉시 미리보기). 확장자로 type 자동(`detectAssetType`: glb/gltf/obj/fbx/bundle=모델링, mat/mtl/json=재질, png/jpg…=텍스쳐).
- `commitAsset`(등록): pending → form.assets 확정 + previewAssetId 설정. `cancelAsset`(취소): 폐기.
- 미리보기 `AssetViewer`: 텍스쳐=이미지, 모델링(glb/gltf/obj/fbx)=3D(OrbitControls+RoomEnvironment 환경맵+AmbientLight, ResizeObserver로 검은화면 방지), AssetBundle 등=안내, 재질/기타=정보. url 없으면 IndexedDB(`getAsset(id)`)에서 하이드레이트.
- 편집 진입 시 첫 에셋 자동 미리보기.

## C-8. 상품 관리 — 컨텐츠 운영정보 (설계형 모델링에서만) ✅⚠️
**노출 게이트**: `attrType=='모델링' && modelingType=='설계형'`. 배치형은 기본정보만.
**섹션**
1. **운영/비규격 사이즈**(비규격 체크 시 명칭 변경): 축별 MIN/MAX/GAP.
   - `opSizeOptions(op, axis)`: max>min & gap>0 → 단계배열, min만/min==max → [min] 고정, min없음 → null(자유).
2. **변수 정의**: `vars[{name,value}]`. 수식에서 `#name`. 기본변수 #W/#D/#H(자기), #bodyW/#bodyD/#bodyH(몸통).
3. **내보내기 수식**(W/D/H) + **조건식**.
4. **운영 항목**: OPERATION_SPEC[`상품군|상품구분`] (일부 정의, 나머지 "정의 예정").
5. **구성/교체(모델링 그룹)**: modelingSlots — 부위 슬롯에 모델 그룹 연결.
**사이즈 입력 정책(설계 미리보기와 공유)**: GAP>1 드롭다운, GAP=1/미설정+범위 입력(클램프), 고정, 자유.

## C-9. 상품 관리 — DP·POS (모델링 도어/EP, 배치형·설계형 무관) ✅⚠️
**노출 룰**: 상품구분 이름에 `'도어' 포함 → DP+POS`, `'EP' 포함 → POS만`, 그 외 숨김. 상품구분 변경 즉시 반응(검증 완료).
- DP = 도어 형태 + 붙는 위치(몸통↔도어 매칭 키), POS = 열림 방향(L/R).
- ⚠️ 한계: 이름 매칭이라 도어 역할 구분명에 "도어"가 없으면(예: 수납의 "스윙장") 안 뜸 → §F-1 추후.

## C-10. 상품 관리 — 마스터/설정
- 상품군·구분 관리, 견적그룹 관리(상품군별 + 공통영역 + 설명), 모델 구분 관리(상품군별), 필터 관리, 노출 필드 관리(필드별 editable/필수/예시).

## C-11. 그룹 관리 (모델 그룹) ✅
**화면**: 카테고리 탭(몸통/도어/손잡이 …) + 스타일 탭, 각 탭에 모델 그룹 리스트.
**기능/정책**
- 탭 추가/이름변경(더블클릭·✏️)/삭제(confirm, 그룹 포함).
- 모델 그룹 생성/이름변경/삭제.
- 그룹 멤버 = **폴더 연결 + 개별 상품**:
  - `+ 폴더 추가`(검색 picker) → folders[groupId]에 연결. 연결 폴더마다 **상품화 체크박스**(folderModes[groupId][folderId]: 체크=상품화 단일조립단위, 해제=일반).
  - `+ 상품 추가`(검색) → items[groupId]에 contentCode 직접 추가(📦 태그).
- 스타일: 폴더 묶음 + 대표 썸네일(업로드/초기화).
**로직**: `expandMembers(state, folders, products)` = 폴더 하위 상품 ∪ 직접추가 상품(중복제거). load/save 시 folderModes/items 보존(기존 저장본 무손실).

## C-12. 설계 미리보기 — 레이아웃
좌(상품 라이브러리) · 중(웹플래너 iframe) · 우(상품/공간 정보) · 상단(보는 사용자, 견적보기).

### C-12-1. 상품 라이브러리
- 영역(설계형/배치형/재질형) 타이틀 → 하위 폴더 → 상품(드릴인, 브레드크럼, 페이지네이션).
- 폴더 타일(대표 썸네일/ folder.png). 상품 타일(썸네일/코드).
- 노출 필터(§B-3) 적용. 데이터 신선도: 포커스/탭 활성 시 products·folders 재로딩.

### C-12-2. 우측 — 공간 정보(미선택)
- 바닥 폭/깊이(10000mm), 면적(100㎡), 배치 상품 수, 배경(흰색). 타이틀 "공간 정보".

### C-12-3. 우측 — 상품 정보(선택)
- 타이틀 "상품 정보" 고정. 탭 속성설정/스타일 설정.
- **속성설정**: W/D/H + 배치높이(기본=placeHeight, 0도 표기) + 스펙파일(specUrls)·URL(mallUrls) + 가격.
  - 사이즈 우선순위 ① 모델+품목 형제 ② opSize ③ 자유.
  - **형제 변형**(modelCode==∧itemCode==): 축별 값 여럿=드롭다운/하나=고정. 다른 값 선택 → `hp3:update-product`로 같은 컨텐츠 형상 변형 + 코드 교체.
  - opSize: 드롭다운/범위입력/고정 + ⓘ 가능값 안내.
- **스타일 설정**:
  - 조립형(modelingSlots): 구성 그룹 클릭 → **DP 매칭 자동 배치**(§D).
  - 단일형: 상품교체 플라이아웃(그룹 연결 폴더 목록 → 폴더 진입 → 상품 교체), 검색·필터(드래그 팝업, iframe 위 드래그 대응).

### C-12-4. 견적보기 ✅
- 96vw 모달. 표: 명칭/상품코드/모델코드/품목코드/컨텐츠코드/사이즈(W×D×H). 닫기 우상단.
- 배치 내역: 웹플래너 `hp3:scene{items}` → 상품코드로 원본 매핑.

---

# D. 핵심 룰·로직 — DP 매칭 자동조립 ✅(시뮬레이션)

## D-1. 정의
- **모델 그룹/상품화 폴더** = 도어 형상들의 묶음(각 도어는 DP·POS·수식·조건 보유).
- 설계에서 몸통 선택 → 구성 그룹/상품화 폴더 선택 → 그룹 멤버 중 **몸통 DP와 같은 DP** 도어를 골라 **POS(좌/우)** 에 자동 배치.

## D-2. 알고리즘 `attachDoorsFromCodes(codes, label)`
```
sel = 선택 몸통; bodyDp = sel.dp
codes(그룹 멤버 or 폴더 하위 상품) → 도어 후보
matched = 후보.filter(도어.dp == bodyDp)
for 도어 in matched:
   vmap = {W,D,H=도어, w,d,h=도어, bodyW,bodyD,bodyH=몸통 유효치수} + 사용자변수(evalFormula)
   if 도어.condition && !TRUE(evalFormula) → skip
   W = 수식.w ? eval : 도어.w  (D,H 동일)
   pos = 도어.pos(L/R)
postMessage hp3:attach-doors { bodyW/D/H, doors[{code,name,modelUrl,w,d,h,pos}] }
배너: 성공/미선택/DP없음/매칭없음/조건미충족
```
- 웹플래너: 선택 몸통 기준 좌/우(폭 1/4 지점, 앞면)에서 박스/모델로 placeAt.

---

# E. 핵심 룰·로직 — 수식 엔진 (쿠지알러 스타일) ✅

`evalFormula(expr, vars): number | boolean | null` (eval 미사용 재귀하강 파서)
- 변수 `#이름`/`이름`, 산술 `+ - * / ( )`, 비교 `>= <= > < == !=`, 논리 `AND OR NOT`/`&& || !`.
- 함수 sin/cos/tan/asin/acos/atan/toRadians/toDegrees/sqrt/abs/round/floor/ceil/min/max/pow, `if(c,a,b)`, 상수 PI.
- 사용처: 도어 내보내기 W/D/H, 조건식(배치 노출 조건), 사용자 변수 값.
- 예: `#H + 24 - #LDH`(수치), `#bodyW >= 200 AND #bodyH > 1200`(조건 TRUE/FALSE).

---

# F. 웹플래너 동작 & 연동

## F-1. postMessage 계약
| 메시지 | 방향 | 페이로드/동작 |
|---|---|---|
| hp3:place-product | →웹 | name,code,modelUrl,w,d,h,lift → 고스트 배치모드(클릭 시 placeAt) |
| hp3:update-product | →웹 | 선택(없으면 마지막) 박스 치수/코드/모델 그 자리 수정 |
| hp3:swap-product | →웹 | 선택 박스 교체 |
| hp3:attach-doors | →웹 | bodyW/D/H + doors[] → 몸통 좌/우 POS 자동 배치 |
| hp3:selected | →어드민 | code(+count) 선택 동기화 |
| hp3:deselected | →어드민 | 해제 → 공간 정보 |
| hp3:scene | →어드민 | placed 목록/개수(견적·공간정보) |

## F-2. 캔버스 동작 ✅
- 흰 배경 + 바닥 플랜(10), AO off.
- 배치 아이템: modelUrl 있으면 GLB 렌더(FittedModel, W/D/H 피팅·바닥정렬·선택 외곽선), 없으면/실패 시 박스(ErrorBoundary+Suspense).
- 선택: 클릭=단일, **Shift+클릭=다중**. 다중 시 **중심 피벗 기즈모**(이동 X/Z, 회전 Y, G/R 단축키). 빈 곳 클릭 해제(onPointerMissed, 기즈모 클릭 제외).
- 고스트(배치 대기)에도 등록 모델 미리 표시.

## F-3. 에셋 저장 — IndexedDB ✅⚠️
- 업로드=data URL → 큰 GLB는 LS 초과 → **IndexedDB(hp3-assets)** 에 바이너리, LS엔 메타만.
- 로드 시 IDB에서 url 하이드레이트(편집 미리보기·설계 modelUrl 맵).
- ⚠️ 수정 전 등록 모델은 url 누락 → 재등록 필요.

---

# G. 데이터 모델 (정의)

```
Product { contentCode, name, brand, productGroup, quoteGroup, productCode,
  modelCode?, itemCode?, nonStandard?, visible, price?, permission,
  w, d, h, opSize?, dp?, pos?, formula?{w,d,h}, vars?[{name,value}], condition?,
  placement, placeHeight, attrType, modelingType, productKind, modelKind,
  filterValues?, opValues?, modelingSlots?[{slot,groupId,defaultModelingId?}],
  specUrls?[{name,url}], mallUrls?[{name,url}], assets?[{id,name,type,url?}],
  thumbUrl?, folderId, updatedAt, updatedBy }

OpSize { min/max/gap × W/D/H }   // opSizeOptions()로 선택값 산출
Folder { id, name, parentId, kind:external|internal, thumb?, thumbReset? }
SwapState { groups[{id,name,kind}], folders{gid:fid[]},
  folderModes{gid:{fid:boolean}}, items{gid:code[]},
  styles[{id,name,folders[],thumb?}], categories[] }
AppUser { id,name,email,empNo,org,role,joined,endDate,lastSeen,renders,status,groupIds[] }
Brand{id,name}  Group{id,name,brandId}
```

---

# H. 실제 작동 시나리오 (E2E)

1. **권한별 노출**: 상단바에서 사용자 전환 → 설계 미리보기가 그 사용자 그룹 콘텐츠만 노출(전체 공개 포함). 비노출 상품은 항상 숨김.
2. **사이즈 변형 교체**: 모델+품목코드 동일 라인 상품 배치 → 속성설정 W 드롭다운 변경 → 같은 컨텐츠 형상만 변형 + 코드/가격이 해당 사이즈 상품으로 교체.
3. **도어 자동조립**: 몸통(DP=DP01) 배치·선택 → 스타일설정 구성 그룹(또는 상품화 폴더) 클릭 → DP01 도어를 POS(L/R)에 수식·조건 적용해 자동 배치.
4. **모델 배치**: 모델 등록(에셋 업로드→등록→상품 저장, IDB) → 설계 배치 시 GLB 로드(없으면 박스).
5. **견적 확인**: 배치 후 견적보기 → 코드·사이즈 내역 표 확인.

---

# I. 미구현 / 추후 (우선순위)

1. **상품구분별 DP/POS 지정** (이름 매칭 한계 해소) — 상품군·구분 관리에서 구분마다 DP/POS 사용 토글. ⬜ (권장 1순위)
2. **그룹 폴더모드(상품화)의 설계 표현** — 📦 단일 자동조립 타일 / 📁 내부 상품 개별. ⬜
3. **POS 정밀 좌표** — 몸통 모델 부착 지점 메타 연동(현재 폭 기준 자동). ⬜
4. **실 서버 업로드 API** — IDB 시뮬레이션 → 스토리지/CDN URL. ⬜
5. **견적 산출 로직** — 견적그룹 기반 가격 계산(현재는 내역 표시). ⬜
6. **로그인 인증/세션** — 현재 사용자 전환 방식. ⬜

---

# J. 정책 한 줄 요약
- 노출 = 노출여부(항상) ∩ 사용자그룹(권한, 관리자 예외).
- 운영정보=설계형 모델링 한정 / DP·POS=도어·EP 모델링(형태 무관).
- 그룹=폴더(상품화/일반 모드)+개별상품 묶음.
- 자동조립=몸통DP↔도어DP, POS 좌/우, 수식·조건 적용.
- 모델=등록 GLB면 모델 아니면 박스, 바이너리는 IndexedDB.