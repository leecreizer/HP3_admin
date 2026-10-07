/**
 * 컨텐츠 라이브러리(기업 상품 라이브러리) 데이터 — 쿠지알러 '企业商品库' 구조를 HP3 로 옮긴 것.
 *
 * 구조: 라이브러리(기업 라이브러리 / 추가 라이브러리) → 업무 탭(모델·재질, 타일 …) → 소재 라이브러리(모델 라이브러리 …)
 *       → 폴더 트리 → 상품(소재).
 * 시드: public/content-library-seed.json (scripts/build-content-seed.py 로 쿠지알러 조회 덤프에서 생성).
 * 저장: localStorage — 자동저장 없음, 화면의 '저장' 버튼으로만 영속화 (다른 관리 화면과 동일).
 */

import type { PvScheme } from './paving';

export type Folder = { id: string; name: string; hidden?: boolean; cover?: string; children?: Folder[] };

export type Item = {
  id: string;
  name: string;
  img: string;
  lib: number;
  folder: string;
  /** 추가로 연결된 폴더(‘폴더에 추가’) — 원 폴더(folder)는 유지 */
  extraFolders?: string[];
  code: string;
  model: string;
  brandId: string;
  brand: string;
  seriesId: string;
  series: string;
  renderCat: string;
  location: string;
  size: string;
  modelSize: string;
  sizeLock: boolean;
  material: string;
  price: number | null;
  unit?: string;
  buyLink: string;
  appletLink: string;
  description: string;
  tags: string[];
  creator: string;
  created: number;
  modified: number;
  /** 도구(설계 툴) 기업 라이브러리에 노출 */
  visible: boolean;
  /** 전경도(파노라마)에 표시 */
  panorama: boolean;
  public: boolean;
  /** 공개 신청 대기 */
  publicPending?: boolean;
  kupinshow: boolean;
  top: boolean;
  renderState: 'done' | 'running' | 'fail';
  synced: string[];
  /** 권한 부여된 파트너 계정 */
  authorizedTo?: string[];
  /** 사용자 정의 필드 값 (필드 id → 값) */
  custom?: Record<string, string>;
  /** 휴지통으로 보낸 시각 */
  deletedAt?: number;
  /** 패키지 / 스타일 소속 */
  packages?: string[];
  styles?: string[];
  /** 3D 모델 — 파라메트릭 에디터 모델 또는 업로드한 GLB (GLB 는 IndexedDB 에셋) */
  model3d?: ItemModel;
  /** 파라메트릭 모델의 실제 분류(真分类) id */
  prodCatId?: number;
  /** 재질·패턴 원본 이미지 (IndexedDB 에셋 id) */
  texture?: string;
  /** 몰딩 프로파일 단면 (DXF 에서 읽은 닫힌 윤곽, mm) */
  profile?: ProfileShape;
  /** 실물 이미지 (축소 JPEG dataURL) */
  photos?: string[];
  /** 상세 소개 문구 */
  detailText?: string;
  /** 혼합 재질(쿠지알러 混合材质 · MixMaterial) — 흑백 마스크(IndexedDB 에셋)의 검은 영역·흰 영역에 재질 하나씩 */
  mix?: { mask: string; black: MixPart; white: MixPart };
  /** 타일 상품(쿠지알러 铺贴产品) — 줄눈·붙임 방식·재질 분류·여러 면 이미지·맞춤 배열 */
  tile?: TileInfo;
  /** 보더 패턴(쿠지알러 波打线样式) — 보더 타일·코너 타일(타일 상품) */
  border?: { corner: boolean; flat: boolean; edge: MixPart; cornerTile?: MixPart };
  /** 타일 배열 패턴(쿠지알러 拼砖样式) — 붙임 방식 템플릿·크기 항목·칸별 타일 상품 */
  tilePattern?: { templateId: number; template: string; sizes: Record<string, number>; tiles: Record<string, MixPart> };
  /** 워터젯 패턴(쿠지알러 水刀拼花) — DXF 닫힌 영역(형상은 IndexedDB 에셋)과 영역별 채움 */
  medallion?: { asset: string; w: number; h: number; regions: number; fills: (MedallionFill | null)[] };
  /** 비정형 상품(쿠지알러 异型产品) — 형상·매개변수(mm)·형상대로 자른 면 이미지(IndexedDB 에셋)·줄눈·재질 분류 */
  shaped?: ShapedInfo;
  /** 파라메트릭 방안(쿠지알러 参数化编辑器) — 타일·포설 방식·매개변수·표기 미리보기 */
  paving?: PvScheme;
  /** 몰딩/벽판(쿠지알러 线条/墙板) — 제품 유형·단면 구간·크기·바탕 재질·덧붙임 재질 */
  lineWall?: LineWallInfo;
};

/**
 * 몰딩/벽판 정보 (쿠지알러 molding/create · wallboard/create 의 입력과 같은 항목).
 * 단면은 선분·원호 ‘구간’ 그대로(덧붙임 재질을 구간 번호 범위로 붙임), 좌하단 (0,0) mm 반시계.
 */
export type LineWallInfo = {
  /** 제품 유형 — 260 걸레받이 · 401 코너 몰딩 · 615 장식 몰딩 · 613 일체형 벽판 · 3196 외부 모서리 몰딩 */
  type: number;
  shape: { points: [number, number][]; segs: { a: number; b: number; bulge?: number }[]; w: number; h: number };
  file?: string;
  /** 몰딩 — 고정 길이 또는 맞춤(조형 변 길이대로) */
  molding?: { customized: boolean; length?: number };
  /** 벽판 — 고정 규격 길이(최대 10개)·맞춤 최대 길이 */
  wallboard?: { specifications: number[]; customized: boolean; customizedSize?: number };
  base: MixPart;
  /** 덧붙임 재질 — 구간 번호 범위 [start, end]·재질·붙임 방식(맞춤 fit / 평붙임 tile) */
  attach: { start: number; end: number; mat: MixPart; mode: 'fit' | 'tile' }[];
};

/** 비정형 상품 정보 (쿠지알러 shape_create 의 입력과 같은 항목) */
export type ShapedInfo = {
  kind: 'hexagon' | 'star' | 'radius' | 'custom';
  /** 별·둥근 사각 — 직선 변·호 높이·짝 맞는 작은 타일 변 길이 (mm) */
  params?: { straight: number; arc: number; side: number };
  /** 사용자 정의 — CAD 윤곽(0–1, 위 원점)·원래 크기(mm)·원래 크기 유지 */
  cad?: { name: string; w: number; h: number; points: [number, number][]; keep: boolean };
  faces: string[];
  gapColor: string;
  gapWidth: number;
  mat: [string, string] | null;
  /** 실시간 재질 세부 조정 */
  pbr?: PbrConfig;
};

/**
 * 실시간 재질 세부 조정 (쿠지알러 实时材质制作工具 ⚙) — 재질 템플릿 id(= 실시간 재질 분류 재질 id)·템플릿 기본값과 다른 값·표시 모델.
 * 맵 값은 주소 또는 'asset:<IndexedDB id>', __normal = 바꾼 노멀 맵
 */
export type PbrConfig = { template: string; values: Record<string, number | boolean | string | [number, number, number]>; model?: number };

/** 워터젯 영역 채움 — 타일 상품(실제 크기·회전) 또는 구멍 */
export type MedallionFill = { id: string; name: string; img: string; L: number; W: number; rot: number } | 'hollow';

/** 타일 상품 정보 (쿠지알러 tile/create 의 입력과 같은 항목) */
export type TileInfo = {
  gapColor: string;
  gapWidth: number;
  /** 붙임 방식 id (pavingData PAVING) — 보더 타일은 0 */
  paving: number;
  angle?: 45 | 60;
  /** 렌더 분류 경로 id */
  cat: number[];
  /** 실시간 재질 분류 [대분류 원문, 재질 id] — 재질 인용이면 null */
  mat: [string, string] | null;
  /** 가변 범위 (카펫) mm */
  range?: { minL: number; maxL: number; minW: number; maxW: number };
  /** 여러 면 이미지 (IndexedDB 에셋 id) — 다면 타일 상품 */
  faces?: string[];
  /** 맞춤 배열 — 행×열 칸마다 면 번호 */
  order?: { rows: number; cols: number; L: number; W: number; cells: (number | null)[] };
  /** 인용한 재질 상품 id */
  refId?: string;
  /** 실시간 재질 세부 조정 */
  pbr?: PbrConfig;
};

/** 혼합 재질에 쓴 재질 — 재질 라이브러리 상품 */
export type MixPart = { id: string; name: string; img: string };

export type ItemModel =
  /** 파라메트릭 모델 에디터에서 만든 모델 — id = hp3-param-models 의 모델, asset = 내보낸 GLB */
  | { kind: 'param'; id: string; asset?: string }
  /** 3D 모델 업로드(FBX→GLB 변환 또는 GLB) — file = 원본 파일명 */
  | { kind: 'glb'; asset: string; file: string };

/** 몰딩 프로파일 단면 — 좌하단 (0,0) 기준 mm 좌표 */
export type ProfileShape = {
  w: number; h: number; points: [number, number][];
  /** 단면 그리기로 만든 단면의 원래 경로(윤곽 편집기 형식) — 다시 열어 고칠 때 */
  path?: string;
};

/** 모델 크기(w=폭, d=깊이, h=높이) → 쿠지알러식 ‘W X D X H mm’ */
export const modelSizeText = (b: { w: number; h: number; d: number }) => `${b.w} X ${b.d} X ${b.h} mm`;

export type TagGroup = { id: string; name: string; single: boolean; tags: string[] };
export type BrandSeries = { id: string; name: string; series: { id: string; name: string }[]; logo?: string };
export type Partner = { account: string; brands: string[] };
export type CustomField = { id: string; name: string; description: string };

export type Member = { id: string; name: string; email: string; dept: string; perm: '관리' | '편집' | '조회'; external?: boolean };
export type Library = { id: string; name: string; main?: boolean; members: Member[]; externalDefaultVisible: boolean };

export type LogEntry = {
  id: string;
  kind: '가져오기' | '내보내기' | '폴더 가져오기';
  at: number;
  by: string;
  library: string;
  count: number;
  status: '성공' | '실패';
  detail?: string;
};
export type ItemHistory = { at: number; by: string; action: string };

export type LibrarySettings = {
  showFoldersInContent: boolean;
  autoCover: 'on' | 'off' | 'clear';
  /** 목록 작업 항목 순서·표시 */
  toolbar: { key: ToolbarKey; visible: boolean }[];
  customSortWeight: boolean;
  currency: 'system' | 'same';
  priceSortCurrency: string;
  syncHiddenToCombo: boolean;
  syncDeleteToCombo: boolean;
  comboCheck: boolean;
  mixedComboCheck: boolean;
};

export type ContentState = {
  version: 1;
  libraries: Library[];
  activeLibrary: string;
  /** 라이브러리 id → 소재 라이브러리 번호 → 폴더 트리 (기업 라이브러리 외에는 빈 트리로 시작) */
  trees: Record<string, Record<number, Folder[]>>;
  items: Item[];
  /** 추가 라이브러리 상품 (라이브러리 id 별) */
  extraItems: Record<string, Item[]>;
  tagGroups: TagGroup[];
  brands: BrandSeries[];
  partners: Partner[];
  customFields: CustomField[];
  settings: LibrarySettings;
  logs: LogEntry[];
  history: Record<string, ItemHistory[]>;
  packages: string[];
  styles: string[];
};

/* ───────────────────────── 업무 탭 · 소재 라이브러리 ───────────────────────── */

export type LibNode = { lib: number; name: string; group?: '프론트 모델' | '백엔드 모델' };
export type BizTab = {
  key: string;
  label: string;
  /** 쿠지알러 원문 (분석 문서 대조용) */
  origin: string;
  libs: LibNode[];
  /** 탭 고유 일괄 작업 */
  extraActions?: ('render' | 'stock' | 'partUpdate')[];
};

export const BIZ_TABS: BizTab[] = [
  {
    key: 'general', label: '모델/재질', origin: '模型/材质',
    libs: [{ lib: 1, name: '모델 라이브러리' }, { lib: 39, name: '재질 라이브러리' }, { lib: 3, name: '조합 라이브러리' }, { lib: 112, name: '혼합 조합 라이브러리' }],
  },
  {
    key: 'paving', label: '타일·바닥', origin: '铺贴商品', extraActions: ['stock'],
    libs: [{ lib: 4, name: '타일 상품' }, { lib: 5, name: '파라메트릭 방안' }],
  },
  {
    key: 'linewallboard', label: '몰딩/벽판', origin: '线条/墙板',
    libs: [{ lib: 7, name: '몰딩·벽판' }],
  },
  {
    key: 'diatommud', label: '도료', origin: '涂料商品',
    libs: [{ lib: 9, name: '컬러칩' }, { lib: 10, name: '벽면 패턴' }, { lib: 11, name: '도료' }],
  },
  {
    key: 'customcabinet', label: '주방·욕실 맞춤', origin: '厨卫定制', extraActions: ['render', 'stock', 'partUpdate'],
    libs: [
      { lib: 12, name: '미분류' }, { lib: 13, name: '재질 라이브러리' }, { lib: 14, name: '몰딩 라이브러리' }, { lib: 43, name: '패턴 라이브러리' },
      { lib: 15, name: '제품 라이브러리', group: '프론트 모델' }, { lib: 16, name: '조합 라이브러리', group: '프론트 모델' }, { lib: 17, name: '부품 모드 라이브러리', group: '프론트 모델' },
      { lib: 18, name: '내부 부품', group: '백엔드 모델' }, { lib: 19, name: '액세서리', group: '백엔드 모델' }, { lib: 20, name: '반제품', group: '백엔드 모델' }, { lib: 21, name: '가상 부품', group: '백엔드 모델' },
    ],
  },
  {
    key: 'customwardrobe', label: '전체 가구 맞춤', origin: '全屋家具定制', extraActions: ['render', 'stock', 'partUpdate'],
    libs: [
      { lib: 22, name: '미분류' }, { lib: 23, name: '재질 라이브러리' }, { lib: 24, name: '몰딩 라이브러리' }, { lib: 44, name: '패턴 라이브러리' },
      { lib: 25, name: '제품 라이브러리', group: '프론트 모델' }, { lib: 26, name: '조합 라이브러리', group: '프론트 모델' }, { lib: 27, name: '부품 모드 라이브러리', group: '프론트 모델' },
      { lib: 28, name: '내부 부품', group: '백엔드 모델' }, { lib: 29, name: '액세서리', group: '백엔드 모델' }, { lib: 30, name: '반제품', group: '백엔드 모델' }, { lib: 31, name: '가상 부품', group: '백엔드 모델' },
    ],
  },
  {
    key: 'customdoorwindow', label: '창호 맞춤', origin: '门窗定制', extraActions: ['render', 'stock', 'partUpdate'],
    libs: [
      { lib: 32, name: '미분류' }, { lib: 33, name: '재질 라이브러리' }, { lib: 34, name: '몰딩 라이브러리' }, { lib: 79, name: '패턴 라이브러리' },
      { lib: 35, name: '일반 창호', group: '프론트 모델' }, { lib: 41, name: '알루미늄 창호', group: '프론트 모델' },
      { lib: 36, name: '일반 부품', group: '백엔드 모델' }, { lib: 42, name: '알루미늄 창호 부품', group: '백엔드 모델' }, { lib: 37, name: '반제품', group: '백엔드 모델' }, { lib: 38, name: '액세서리', group: '백엔드 모델' }, { lib: 45, name: '가상 부품', group: '백엔드 모델' },
    ],
  },
  {
    key: 'zhuduowei', label: '몰드 클라우드', origin: '模袋云设计',
    libs: [
      { lib: 81, name: '모델 라이브러리' }, { lib: 82, name: '재질 라이브러리' }, { lib: 83, name: '몰딩 라이브러리' },
      { lib: 97, name: '파라메트릭 모델', group: '프론트 모델' }, { lib: 98, name: '파라메트릭 부품', group: '백엔드 모델' },
    ],
  },
  {
    key: 'planedesign', label: '평면 배치', origin: '平面布置',
    libs: [{ lib: 99, name: '배치 소재' }, { lib: 110, name: '배치 조합' }],
  },
  {
    key: 'kudashi', label: '쿠다스 모델링', origin: '酷大师',
    libs: [{ lib: 78, name: '모델 라이브러리' }, { lib: 92, name: '재질 라이브러리' }],
  },
];

export const libName = (lib: number) => {
  for (const t of BIZ_TABS) { const n = t.libs.find((l) => l.lib === lib); if (n) return n.name; }
  return `라이브러리 ${lib}`;
};
export const tabOfLib = (lib: number) => BIZ_TABS.find((t) => t.libs.some((l) => l.lib === lib)) ?? BIZ_TABS[0];

/* ───────────────────────── 목록 컬럼 ───────────────────────── */

export type ColumnKey =
  | 'name' | 'id' | 'visible' | 'panorama' | 'model' | 'code' | 'brand' | 'tags' | 'renderCat' | 'location'
  | 'size' | 'material' | 'price' | 'buyLink' | 'public' | 'creator' | 'created' | 'modelSize' | 'sizeLock'
  | 'kupinshow' | 'description' | 'synced' | `cf:${string}`;

export const BASE_COLUMNS: { key: ColumnKey; label: string; fixed?: boolean }[] = [
  { key: 'name', label: '폴더/소재', fixed: true },
  { key: 'id', label: '상품 ID' },
  { key: 'visible', label: '도구 노출' },
  { key: 'panorama', label: '전경도 표시' },
  { key: 'model', label: '모델번호' },
  { key: 'code', label: '상품코드' },
  { key: 'brand', label: '브랜드·시리즈' },
  { key: 'tags', label: '태그' },
  { key: 'renderCat', label: '렌더 분류' },
  { key: 'location', label: '배치 위치' },
  { key: 'size', label: '상품 크기' },
  { key: 'material', label: '재질' },
  { key: 'price', label: '판매가' },
  { key: 'buyLink', label: '구매 링크' },
  { key: 'public', label: '공용 라이브러리 공개' },
  { key: 'creator', label: '생성자' },
  { key: 'created', label: '생성일' },
  { key: 'modelSize', label: '모델 크기' },
  { key: 'sizeLock', label: '모델 크기 잠금' },
  { key: 'kupinshow', label: '3D 쇼룸' },
  { key: 'description', label: '설명' },
  { key: 'synced', label: '추가 라이브러리 동기화' },
];

/** 기본 노출 컬럼 (나머지는 컬럼 설정에서 켬) */
export const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['name', 'id', 'visible', 'panorama', 'model', 'code', 'brand', 'tags', 'renderCat', 'modelSize', 'created'];

/* ───────────────────────── 툴바 · 일괄 편집 ───────────────────────── */

export type ToolbarKey = 'authorize' | 'saveAs' | 'folder' | 'sort' | 'addTo' | 'batchEdit' | 'applyPublic' | 'delete';
export const TOOLBAR_LABEL: Record<ToolbarKey, string> = {
  authorize: '권한 부여', saveAs: '다른 이름으로 저장', folder: '폴더 설정', sort: '정렬',
  addTo: '추가', batchEdit: '일괄 편집', applyPublic: '공개 신청', delete: '삭제',
};

export type BatchField =
  | 'split' | 'equipment' | 'location' | 'visible' | 'panorama' | 'name' | 'model' | 'code' | 'brand'
  | 'size' | 'material' | 'price' | 'buyLink' | 'description' | 'tags' | 'unit' | 'modelSetting' | 'sizeLock';
export const BATCH_FIELDS: { key: BatchField; label: string; needsEditor?: boolean }[] = [
  { key: 'split', label: '분할 전처리', needsEditor: true },
  { key: 'equipment', label: '설비 분류', needsEditor: true },
  { key: 'location', label: '배치 위치' },
  { key: 'visible', label: '도구 노출 설정' },
  { key: 'panorama', label: '전경도 상품 설정' },
  { key: 'name', label: '상품명' },
  { key: 'model', label: '모델번호' },
  { key: 'code', label: '상품코드' },
  { key: 'brand', label: '브랜드·시리즈' },
  { key: 'size', label: '상품 크기' },
  { key: 'material', label: '재질' },
  { key: 'price', label: '판매가' },
  { key: 'buyLink', label: '구매 링크' },
  { key: 'description', label: '설명' },
  { key: 'tags', label: '태그' },
  { key: 'unit', label: '단위' },
  { key: 'modelSetting', label: '모델 설정', needsEditor: true },
  { key: 'sizeLock', label: '크기 잠금 설정' },
];

export const LOCATIONS = ['바닥 가구', '벽면 부착', '천장 부착', '테이블 위', '자유 배치'];
export const UNITS = ['개', '세트', '㎡', 'm', '장', '박스'];

/** 내보내기 속성 (쿠지알러 내보내기 2단계 '选择导出属性') */
export const EXPORT_GROUPS: { group: string; attrs: { key: string; label: string; get: (i: Item) => string }[] }[] = [
  {
    group: '기본 정보', attrs: [
      { key: 'tab', label: '소속 탭', get: (i) => tabOfLib(i.lib).label },
      { key: 'lib', label: '소속 라이브러리', get: (i) => libName(i.lib) },
      { key: 'name', label: '상품명', get: (i) => i.name },
      { key: 'id', label: '상품 ID', get: (i) => i.id },
      { key: 'created', label: '생성 시간', get: (i) => fmtDate(i.created, true) },
      { key: 'modified', label: '최종 수정 시간', get: (i) => fmtDate(i.modified, true) },
      { key: 'creator', label: '생성자', get: (i) => i.creator },
      { key: 'img', label: '표지 이미지 링크', get: (i) => i.img },
    ],
  },
  {
    group: '상품 정보', attrs: [
      { key: 'model', label: '모델번호', get: (i) => i.model },
      { key: 'code', label: '상품코드', get: (i) => i.code },
      { key: 'brand', label: '브랜드', get: (i) => i.brand },
      { key: 'series', label: '시리즈', get: (i) => i.series },
      { key: 'size', label: '상품 크기', get: (i) => i.size },
      { key: 'material', label: '재질', get: (i) => i.material },
      { key: 'price', label: '판매가', get: (i) => (i.price == null ? '' : String(i.price)) },
      { key: 'unit', label: '단위', get: (i) => i.unit ?? '' },
      { key: 'buyLink', label: '구매 링크', get: (i) => i.buyLink },
      { key: 'description', label: '설명', get: (i) => i.description },
      { key: 'tags', label: '태그', get: (i) => i.tags.join('|') },
      { key: 'authorizedTo', label: '권한 부여 대상', get: (i) => (i.authorizedTo ?? []).join('|') },
    ],
  },
  {
    group: '소재 정보', attrs: [
      { key: 'renderCat', label: '렌더 분류', get: (i) => i.renderCat },
      { key: 'modelSize', label: '모델 크기', get: (i) => i.modelSize },
      { key: 'location', label: '배치 위치', get: (i) => i.location },
      { key: 'sizeLock', label: '크기 잠금', get: (i) => (i.sizeLock ? '예' : '아니오') },
    ],
  },
  {
    group: '유통 정보', attrs: [
      { key: 'public', label: '공개 여부', get: (i) => (i.public ? '공개' : '비공개') },
      { key: 'visible', label: '도구 노출', get: (i) => (i.visible ? '노출' : '비노출') },
      { key: 'panorama', label: '전경도 표시', get: (i) => (i.panorama ? '예' : '아니오') },
      { key: 'kupinshow', label: '3D 쇼룸', get: (i) => (i.kupinshow ? '예' : '아니오') },
    ],
  },
];

/* ───────────────────────── 유틸 ───────────────────────── */

export function fmtDate(ms: number | undefined, withTime = false) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

let seq = 0;
export const newId = (prefix = 'HP') => `${prefix}${Date.now().toString(36).toUpperCase()}${(seq++).toString(36).toUpperCase()}`;

export function walkFolders(tree: Folder[], fn: (f: Folder, path: Folder[]) => void, path: Folder[] = []) {
  for (const f of tree) { fn(f, path); if (f.children) walkFolders(f.children, fn, [...path, f]); }
}
export function findFolderPath(tree: Folder[], id: string): Folder[] | null {
  let found: Folder[] | null = null;
  walkFolders(tree, (f, path) => { if (f.id === id) found = [...path, f]; });
  return found;
}
/** 폴더와 모든 하위 폴더 id */
export function folderIdsWithChildren(f: Folder): string[] {
  const out = [f.id];
  for (const c of f.children ?? []) out.push(...folderIdsWithChildren(c));
  return out;
}
/** 트리 불변 갱신: id 가 일치하는 폴더를 fn 결과로 교체 (null 이면 삭제) */
export function mapFolders(tree: Folder[], id: string, fn: (f: Folder) => Folder | null): Folder[] {
  const out: Folder[] = [];
  for (const f of tree) {
    if (f.id === id) { const r = fn(f); if (r) out.push(r); continue; }
    out.push(f.children ? { ...f, children: mapFolders(f.children, id, fn) } : f);
  }
  return out;
}

/* ───────────────────────── 로드 · 저장 ───────────────────────── */

const KEY = 'hp3-content-library';

export const DEFAULT_SETTINGS: LibrarySettings = {
  showFoldersInContent: false,
  autoCover: 'on',
  toolbar: (Object.keys(TOOLBAR_LABEL) as ToolbarKey[]).map((key) => ({ key, visible: true })),
  customSortWeight: false,
  currency: 'system',
  priceSortCurrency: 'KRW',
  syncHiddenToCombo: true,
  syncDeleteToCombo: true,
  comboCheck: true,
  mixedComboCheck: false,
};

type Seed = {
  trees: Record<string, Folder[]>;
  items: Item[];
  tagGroups: TagGroup[];
  brands: BrandSeries[];
  partners: Partner[];
  customFields: CustomField[];
};

const uncategorized = (lib: number): Folder[] => [{ id: `UNC-${lib}`, name: '미분류' }];

function fromSeed(seed: Seed): ContentState {
  const main: Record<number, Folder[]> = {};
  for (const t of BIZ_TABS) for (const l of t.libs) {
    const tree = seed.trees[String(l.lib)];
    main[l.lib] = tree && tree.length ? tree : uncategorized(l.lib);
  }
  const testLib: Record<number, Folder[]> = {};
  for (const t of BIZ_TABS) for (const l of t.libs) testLib[l.lib] = uncategorized(l.lib);
  return {
    version: 1,
    libraries: [
      { id: 'main', name: '기업 라이브러리', main: true, members: [], externalDefaultVisible: false },
      { id: 'L-TEST', name: '새제품라이브러리_테스트', members: [], externalDefaultVisible: false },
    ],
    activeLibrary: 'main',
    trees: { main, 'L-TEST': testLib },
    items: seed.items.map((i) => ({ ...i, unit: '개' })),
    extraItems: { 'L-TEST': [] },
    tagGroups: seed.tagGroups,
    brands: seed.brands,
    partners: seed.partners,
    customFields: seed.customFields,
    settings: DEFAULT_SETTINGS,
    logs: [],
    history: {},
    packages: ['기본 패키지', '신혼 패키지', '리모델링 패키지'],
    styles: ['모던', '내추럴', '클래식', '미니멀'],
  };
}

export async function loadContentState(): Promise<ContentState> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as ContentState;
      if (s.version === 1) return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
    }
  } catch { /* 손상된 저장본은 시드로 복구 */ }
  const res = await fetch(`${import.meta.env.BASE_URL}content-library-seed.json`);
  if (!res.ok) throw new Error(`시드 로드 실패 (${res.status})`);
  return fromSeed(await res.json());
}

export function saveContentState(s: ContentState) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function resetContentState() {
  localStorage.removeItem(KEY);
}

/* ───────────────────────── 컨텐츠 제작 · 저장 후 입고 ───────────────────────── */

/** 지금 보고 있는 라이브러리(기업 / 추가)의 상품 목록 */
export const itemsOf = (s: ContentState) => (s.activeLibrary === 'main' ? s.items : s.extraItems[s.activeLibrary] ?? []);
export const withItems = (s: ContentState, list: Item[]): ContentState =>
  s.activeLibrary === 'main' ? { ...s, items: list } : { ...s, extraItems: { ...s.extraItems, [s.activeLibrary]: list } };

/** 새로 만든 소재가 들어갈 폴더 — 소재 라이브러리의 ‘미분류’ 폴더 (없으면 첫 폴더, 트리가 비었으면 만든다) */
export function uncategorizedFolder(s: ContentState, lib: number): { state: ContentState; folder: string } {
  const tree = s.trees[s.activeLibrary]?.[lib] ?? [];
  const f = tree.find((x) => x.name === '미분류') ?? tree[0];
  if (f) return { state: s, folder: f.id };
  const nf: Folder = { id: s.activeLibrary === 'main' ? `UNC-${lib}` : `UNC-${s.activeLibrary}-${lib}`, name: '미분류' };
  return { state: { ...s, trees: { ...s.trees, [s.activeLibrary]: { ...s.trees[s.activeLibrary], [lib]: [nf] } } }, folder: nf.id };
}

/** 새 상품 기본값 — 브랜드는 기업 첫 브랜드 */
export function newItem(s: ContentState, p: Pick<Item, 'name' | 'lib' | 'folder'> & Partial<Item>, userName: string): Item {
  const now = Date.now();
  const b = s.brands[0];
  return {
    id: newId(), img: '', code: '', model: '', brandId: b?.id ?? '', brand: b?.name ?? '', seriesId: '', series: '',
    renderCat: '', location: '', size: '', modelSize: '', sizeLock: false, material: '', price: null, unit: '개', buyLink: '', appletLink: '',
    description: '', tags: [], creator: userName, created: now, modified: now, visible: true, panorama: true, public: false,
    kupinshow: false, top: false, renderState: 'done', synced: [], ...p,
  };
}

/** 파라메트릭 모델을 저장 후 입고해 만든 상품 */
export const findModelItem = (s: ContentState, modelId: string) =>
  itemsOf(s).find((i) => !i.deletedAt && i.model3d?.kind === 'param' && i.model3d.id === modelId);

export type ModelRegister = { id: string; name: string; lib: number; categoryId?: number; category: string; thumb: string; bbox: { w: number; d: number; h: number }; asset?: string };

/**
 * 저장 후 입고 — 모델 유형 선택에서 고른 소재 라이브러리의 ‘미분류’ 폴더에 상품을 만든다.
 * 이미 입고한 모델이면 그 상품의 이미지·모델 크기·렌더 분류(실제 분류)·3D 만 갱신하고(상품명 등은 유지),
 * 유형 변경으로 라이브러리가 바뀌었으면 새 라이브러리의 ‘미분류’로 옮긴다.
 */
export function upsertModelItem(s: ContentState, r: ModelRegister, userName: string): { state: ContentState; item: Item; created: boolean } {
  const ex = findModelItem(s, r.id);
  const fields: Partial<Item> = {
    img: r.thumb || ex?.img || '', modelSize: modelSizeText(r.bbox), renderCat: r.category, prodCatId: r.categoryId,
    model3d: { kind: 'param', id: r.id, asset: r.asset },
  };
  const now = Date.now();
  let state = s;
  let item: Item;
  if (ex) {
    let { lib, folder } = ex;
    if (r.lib !== ex.lib) { const u = uncategorizedFolder(state, r.lib); state = u.state; lib = r.lib; folder = u.folder; }
    item = { ...ex, ...fields, lib, folder, extraFolders: lib === ex.lib ? ex.extraFolders : [], modified: now };
    const id = ex.id;
    state = withItems(state, itemsOf(state).map((i) => (i.id === id ? item : i)));
  } else {
    const u = uncategorizedFolder(state, r.lib);
    state = u.state;
    item = newItem(state, { name: r.name, lib: r.lib, folder: u.folder, ...fields }, userName);
    state = withItems(state, [item, ...itemsOf(state)]);
  }
  const action = ex ? `저장 후 입고(모델 갱신): ${r.name}` : `저장 후 입고: ${r.name}`;
  state = { ...state, history: { ...state.history, [item.id]: [...(state.history[item.id] ?? []), { at: now, by: userName, action }].slice(-30) } };
  return { state, item, created: !ex };
}

/** 상품 배열을 CSV 로 (BOM 포함 — 엑셀 한글 깨짐 방지) */
export function toCsv(items: Item[], attrKeys: string[]) {
  const attrs = EXPORT_GROUPS.flatMap((g) => g.attrs).filter((a) => attrKeys.includes(a.key));
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [attrs.map((a) => esc(a.label)).join(',')];
  for (const i of items) lines.push(attrs.map((a) => esc(a.get(i))).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

export const exportFileName = (tabLabel: string) => `컨텐츠라이브러리_${tabLabel.replace(/\//g, '_')}_${fmtDate(Date.now())}.csv`;

/** 이미지 파일을 긴 변 maxPx 이하 JPEG dataURL 로 (localStorage 용량 보호) */
export function fileToThumb(file: File, maxPx = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다')); };
    img.src = url;
  });
}

/** 간단 CSV 파서 (따옴표·쉼표·줄바꿈 처리) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}
