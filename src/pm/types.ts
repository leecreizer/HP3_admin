import type { ToolType } from './modelTypes';

/**
 * 새 파라메트릭 모델 형식 — 쿠지알러 editorData 구조를 그대로 따른다.
 *  - 요소·보조 구조 인스턴스의 값은 쿠지알러 저장 문자열 그대로(float3 = '{"x":"0","y":"0","z":"0"}', plankPath JSON …)
 *  - 좌표(mm): X = 폭(오른쪽 +), Y = 깊이(뒤 +, 앞면 -D), Z = 높이(위 +)
 */

/** 변수 형식(参数类型) — 문서 1.1.6 · 3.1.28 */
export type ParamType = 'float' | 'int' | 'string' | 'boolean' | 'multiBoolean' | 'material' | 'style' | 'profile';
/** 값 유형(值类型) — 구간 · 선택 · 무제한 · 수식 · 복합 수식 · 고정값 */
export type ValueType = 'range' | 'options' | 'free' | 'formula' | 'composite' | 'fixed';
/** 변수 구역 — 시스템 · 기본(W D H CZ) · 사용자 정의 · 중간 · 보고 */
export type VarScope = 'system' | 'basic' | 'custom' | 'middle' | 'report';

export interface VarOption {
  name: string;
  value: string;
  /** 이 선택지 숨김 조건(editorOptions[].ignore) */
  hidden?: string;
}

export interface PmVar {
  id: string;
  scope: VarScope;
  /** 참조명(引用名) — 수식에서 #name. 영문자로 시작, 영문·숫자 */
  name: string;
  /** 이름(名称) — 설계 툴에 보이는 이름 */
  label: string;
  type: ParamType;
  valueType: ValueType;
  /** 현재값(当前值) — 구간·선택·무제한·고정값·복합 수식(값 상태)의 값 */
  value: string;
  /** 구간 최소·최대(수식 가능) · 증분 */
  min?: string;
  max?: string;
  step?: string;
  /** 선택(可选) 값 목록 */
  options?: VarOption[];
  /** 추천값(推荐值) — 설계 툴 드롭다운 */
  recommends?: string[];
  /** 수식 · 복합 수식 표현식 · 중간/보고 변수 표현식 */
  formula?: string;
  /** 복합 수식 이름(公式名称) */
  formulaName?: string;
  /** 복합 수식 기본 상태 — 값 / 수식 */
  state?: 'value' | 'formula';
  /** 숨김 조건(隐藏条件) */
  hidden?: string;
  /** 수정 가능(可修改) — false 면 설계 툴에서 회색 */
  editable?: boolean;
  /** 확장 속성 값 (diy-immutable 잠금 조건 수식, diy-ratingLabel 등급 라벨 …) */
  ext?: Record<string, string>;
  /** 사용자 그룹(customParamGroups) */
  group?: string;
  desc?: string;
  /** 시스템 변수 — 설계 툴 기능 이름(offGround · location …) */
  scriptName?: string;
  /** 설계 툴 노출 */
  visible?: boolean;
  /** 전역 변수 연결 id */
  globalId?: string;
  /** 환경 조건 수식(#selfPosition.z 등) — 실수 · 수식/복합 수식이 아닌 변수만 */
  env?: string;
  /** 전역 변수의 숨김 방식 — 통일 제어(숨김 여부를 전역에서) / 로컬 설정(모델마다) */
  hideMode?: 'unified' | 'local';
}

/** 변수 템플릿 폴더 (자기 정의 변수 템플릿 — 문서 3.1.3) */
export interface VarTemplateFolder { id: string; name: string; vars: PmVar[] }

/** 배열(阵列) — 단축키 A, 해제 Ctrl+Shift+A. 방향 · 길이 · 방식(간격/개수) */
export interface PmArray {
  dir: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
  length: string;
  mode: 'step' | 'count';
  value: string;
}

/** 요소 · 보조 구조 · 하위 모델 인스턴스 (modelInstances · moldingPaths · adsorbLines …) */
export interface PmNode {
  id: string;
  /** 정의 id — defs elements[].id, 하위 모델이면 'instance' */
  def: string;
  name: string;
  /** 참조명(引用名) — 수식에서 @refName.변수 */
  refName?: string;
  /** 정의 변수 값 (쿠지알러 저장 문자열 그대로) */
  params: Record<string, string>;
  /** 업무 속성 값 (키 → 값 또는 수식) */
  biz?: Record<string, string>;
  /** 하위 모델(부품 라이브러리) — param: 다른 파라메트릭 모델, mesh: 컨텐츠 라이브러리 3D 모델(furnitureWithMaterial) */
  sub?: { kind: 'param' | 'mesh'; id: string; name: string };
  /** 구조 탐색 눈 — 에디터 표시만 */
  viewHidden?: boolean;
  array?: PmArray;
}

/** 데이터 인터페이스 출력 설정(Alt+S) 행 — 체크하면 출력 참조명·출력 조건(비우면 true)·출력 값을 이 모델에서 정함, 아니면 백엔드 설정 */
export interface PmOutputRow { name: string; on: boolean; outName: string; cond: string; value: string }
/** 부품 노드 보고 설정 행 */
export interface PmNodeReport { nodeId: string; report: boolean; toTop: boolean; prefix: string }
/** 모델 버전 — 입고 때 기록 */
export interface PmVersion { version: number; at: number; by: string; desc: string; snapshot: string }

export interface PmModel {
  id: string;
  name: string;
  tooltype: ToolType;
  /** 소속 라이브러리 번호 · 이름 */
  lib?: number;
  library: string;
  /** 실제 분류(真分类) */
  categoryId?: number;
  category: string;
  vars: PmVar[];
  /** 사용자 변수 그룹 순서 */
  groups: string[];
  /** 모델 외곽 틀 변수(size · invokedPosType · center) */
  frame: Record<string, string>;
  nodes: PmNode[];
  /** 모델 속성(ParamModel.paramModel 변수 — 상판 생성 …) */
  props: Record<string, string>;
  /** 모델 업무 속성 */
  biz: Record<string, string>;
  /** 견적 설정(Alt+B) — 견적 크기 */
  quote: { x: string; y: string; z: string };
  output: PmOutputRow[];
  nodeReports: PmNodeReport[];
  /** 미리보기 이미지 · 표기도 (PNG dataURL) */
  preview?: string;
  markImage?: string;
  version: number;
  versions: PmVersion[];
  createdAt: number;
  updatedAt: number;
}

/* ───────────── 판재 윤곽 경로 (plankPath · loftPath · profile) ───────────── */

/**
 * 꼭짓점 종류: 0 직각 · 1 둥근 모서리(radius) — 쿠지알러 저장값 관찰.
 * 2 모따기(a · b) — 교육 문서(切角 a·b)에 있으나 저장 형식은 미확인 → HP3 확장 필드 chamferA/chamferB.
 */
export interface PathPoint {
  x: string;
  y: string;
  type: 0 | 1 | 2;
  radius?: string;
  chamferA?: string;
  chamferB?: string;
  /** 쿠지알러 저장값 그대로 보관 (nameId · edgeBanding · bizProperties · offset …) */
  extra?: Record<string, unknown>;
}
/**
 * 선 종류: 0 직선 — 관찰. 1 원호 — 교육 문서(线段类型 圆弧, 반지름 수식)에 있으나 저장 형식 미확인 → HP3 확장.
 * 원호: 반지름 + 시계 방향 + 짧은 호(劣弧)
 */
export interface PathLine {
  type: 0 | 1;
  radius?: string;
  clockwise?: boolean;
  minor?: boolean;
  extra?: Record<string, unknown>;
}
export interface PmPath {
  points: PathPoint[];
  /** lines[i] = 점 i → 점 i+1 (닫힌 경로면 마지막 → 첫 점) */
  lines: PathLine[];
  closed: boolean;
  name?: string;
  /** 오프셋(偏移) — 하단 체크 + 오프셋 값 */
  offset?: string;
}
/** 홈(槽) — 판 면에 파는 홈. 깊이 · 면 */
export interface PmSlot { path: PmPath; depth: string; face: 'top' | 'bottom' }
export interface PlankShape {
  outline: PmPath;
  holes: PmPath[];
  slots: PmSlot[];
  /** 쿠지알러 arrays 등 해석하지 않은 값 */
  rest?: Record<string, unknown>;
}
