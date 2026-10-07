/**
 * 파라메트릭 방안(쿠지알러 参数化编辑器 · 铺法编辑器) — 데이터 형식.
 * 2026-10-07 쿠지알러에서 새 방안을 만들어 보며 확인(저장 안 함) + 화면 번들 규칙.
 * 값은 모두 수식 문자열 — 숫자, 사용자 매개변수 참조명, 시스템 BBW·BBH(캔버스), 함수 sin·cos·tan(도)·sqrt.
 */

/** 방안 유형 — 쿠지알러 类型 (번들 enum: BACKGROUND/BOUNDARY/NORMAL, 화면 선택지는 이 셋) */
export type PvScriptType = 'BACKGROUND' | 'BOUNDARY' | 'NORMAL';
export const PV_TYPES: { v: PvScriptType; name: string; zh: string }[] = [
  { v: 'BACKGROUND', name: '배경', zh: '背景' },
  { v: 'BOUNDARY', name: '보더', zh: '波打线' },
  { v: 'NORMAL', name: '방안', zh: '方案' },
];
/** 유형 성질 (getScriptTypeConfig) — 마우스 따라 배치 · 같은 유형 하나만·맨 아래 · 위치 이동 */
export const PV_TYPE_CONFIG: Record<PvScriptType, { moveWithMouse: boolean; background: boolean; positionChangeable: boolean }> = {
  BACKGROUND: { moveWithMouse: false, background: true, positionChangeable: true },
  BOUNDARY: { moveWithMouse: false, background: false, positionChangeable: false },
  NORMAL: { moveWithMouse: true, background: false, positionChangeable: true },
};
/** 분류(真分类) — 쿠지알러 prodCatId */
export const PV_CATS: { code: number; name: string; zh: string }[] = [
  { code: 3082, name: '일반 방안', zh: '通用方案' },
  { code: 4383, name: '외벽 도료 방안', zh: '外墙漆方案' },
];

/** 소재 가공 모양 (ClipType) — 화면 순서 그대로 */
export type PvClipType = 'RECTANGLE' | 'HEXAGON' | 'TRIANGLE' | 'PARALLELOGRAM' | 'TRAPEZOID' | 'STAR' | 'ROUNDED_CORNER' | 'ORIGIN' | 'POLYGON';
export type PvClipParam = 'width' | 'height' | 'angle' | 'topWidth' | 'bottomWidth' | 'size' | 'straightEdge' | 'arcHigh' | 'smallSize' | 'expansion' | 'thickness';
export const PV_CLIPS: { v: PvClipType; name: string; zh: string }[] = [
  { v: 'RECTANGLE', name: '사각형', zh: '矩形' },
  { v: 'HEXAGON', name: '육각형', zh: '六边形' },
  { v: 'TRIANGLE', name: '삼각형', zh: '三角形' },
  { v: 'PARALLELOGRAM', name: '평행사변형', zh: '平行四边形' },
  { v: 'TRAPEZOID', name: '사다리꼴', zh: '梯形' },
  { v: 'STAR', name: '별', zh: '星形' },
  { v: 'ROUNDED_CORNER', name: '둥근 모서리', zh: '星形圆角' },
  { v: 'ORIGIN', name: '원래 모양', zh: '原始形状' },
  { v: 'POLYGON', name: '사용자 정의', zh: '自定义' },
];
/** 모양별 기본 매개변수 (createDefaultClipParam 그대로) */
export const PV_CLIP_DEFAULTS: Record<PvClipType, Partial<Record<PvClipParam, string>>> = {
  RECTANGLE: { width: '800', height: '400', expansion: '0', thickness: '0' },
  HEXAGON: { width: '200', expansion: '0', thickness: '0' },
  TRIANGLE: { width: '800', height: '400', angle: '45', expansion: '0', thickness: '0' },
  PARALLELOGRAM: { width: '600', height: '400', angle: '63', expansion: '0', thickness: '0' },
  TRAPEZOID: { topWidth: '150', bottomWidth: '450', height: '150', angle: '45', expansion: '0', thickness: '0' },
  STAR: { size: '120', straightEdge: '0', arcHigh: '20', expansion: '0', thickness: '0' },
  ROUNDED_CORNER: { size: '800', straightEdge: '0', arcHigh: '20', smallSize: '120', expansion: '0', thickness: '0' },
  ORIGIN: { expansion: '0' },
  POLYGON: { expansion: '0', thickness: '0' },
};
/** 입력 칸 이름 — 화면 순서(위→아래) */
export const PV_CLIP_FIELDS: { k: PvClipParam; label: (t: PvClipType) => string }[] = [
  { k: 'topWidth', label: () => '폭(w1)' },
  { k: 'bottomWidth', label: () => '폭(w2)' },
  { k: 'width', label: (t) => (t === 'HEXAGON' ? '변 길이(a)' : '폭(w)') },
  { k: 'height', label: () => '높이(h)' },
  { k: 'angle', label: () => '각도(θ)' },
  { k: 'size', label: () => '변 길이(a)' },
  { k: 'arcHigh', label: () => '호 높이(h)' },
  { k: 'smallSize', label: () => '작은 타일 변(c)' },
  { k: 'straightEdge', label: () => '직선 변(b)' },
  { k: 'expansion', label: () => '줄눈 오프셋' },
];

/** 타일에 쓰는 소재(상품) — 크기 mm, 비율(다중 타일 혼합 1~100) */
export type PvSprite = { id: string; name: string; img: string; w: number; h: number; weight: number };
/** 소재 가공 — 모양·매개변수·재질 위치(오프셋·각도)·사용자 정의 점(mm, 왼쪽 아래 원점) */
export type PvMachine = { type: PvClipType; params: Partial<Record<PvClipParam, string>>; texX: string; texY: string; texRot: string; polygon?: [number, number][] };
/** 타일(商品) — 위치(왼쪽 아래 기준점)·각도(반시계 +) */
export type PvTile = {
  kind: 'tile'; id: string;
  sprites: PvSprite[];
  /** 다중 타일 혼합(多砖混铺) */
  multi: boolean;
  /** 매개변수 연결(参数绑定) — 소재 매개변수 참조명 */
  spriteRef?: string;
  machine: PvMachine | null;
  x: string; y: string; angle: string;
};
/** 반복 방향 — 이동 벡터(X·Y 오프셋)·정/역방향 개수(숫자 수식 또는 INF=무한) */
export type PvDir = { x: string; y: string; pos: string; neg: string };
export const PV_INF = 'INF';
/** 포설 방식(铺法) — 단위(타일 묶음)를 U·V 로 반복, 시작점·각도·줄눈·모서리 따기 */
export type PvPaving = {
  kind: 'paving'; id: string; name: string;
  tiles: PvTile[];
  u: PvDir; v: PvDir;
  sx: string; sy: string; angle: string;
  gap: string;
  /** 줄눈 색 '#rrggbb' 또는 색 매개변수 참조명 (비우면 미정의 = 검정) */
  gapColor: string;
  /** 모서리 따기 타일(去角砖) — 잘린 타일 빼기. '1'/'0' 또는 불리언 매개변수 참조명 */
  cornerCut: string;
};
export type PvNode = PvTile | PvPaving;

export type PvParamType = 'NUMERIC' | 'MULTI_SPRITE' | 'GAP_MATERIAL' | 'BOOL';
export const PV_PARAM_TYPES: { v: PvParamType; name: string }[] = [
  { v: 'NUMERIC', name: '숫자 매개변수' },
  { v: 'MULTI_SPRITE', name: '소재 매개변수' },
  { v: 'GAP_MATERIAL', name: '색 매개변수' },
  { v: 'BOOL', name: '불리언 매개변수' },
];
/** 사용자 정의 매개변수 — 값: 숫자 수식 · 색 '#rrggbb' · 'true'/'false' · 소재는 sprites */
export type PvParam = { name: string; ref: string; type: PvParamType; value: string; sprites?: PvSprite[] };

/** 파라메트릭 방안 */
export type PvScheme = {
  v: 1;
  type: PvScriptType;
  cat: number;
  /** 캔버스 폭·높이 (시스템 매개변수 BBW·BBH, 1000~100000) */
  bbw: string; bbh: string;
  color: string;
  guideW: number; guideH: number;
  params: PvParam[];
  /** 수식 편집기 ‘수식 저장’ 목록 */
  formulas: { name: string; expr: string }[];
  nodes: PvNode[];
  /** 표기 미리보기 이미지 (JPEG dataURL) */
  label?: string;
};

export const newScheme = (): PvScheme => ({
  v: 1, type: 'BACKGROUND', cat: 3082, bbw: '10000', bbh: '10000', color: '#fafafa', guideW: 800, guideH: 800,
  params: [], formulas: [], nodes: [],
});

/** 타일 개수 제한 — 쿠지알러 ‘铺砖数目超出限制(2W块)’ */
export const PV_TILE_LIMIT = 20000;
