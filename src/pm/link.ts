import type { ToolType } from './modelTypes';

/** 에디터에서 만든 모델을 컨텐츠 라이브러리에 넘기는 결과 (저장 후 입고) */
export type ModelResult = {
  kind: 'param';
  /** 파라메트릭 모델 id(hp3-pm-models) — 다시 편집할 때 쓴다 */
  id: string;
  name: string;
  /** 모델 유형 선택에서 고른 도구 종류·소속 라이브러리 번호·실제 분류 */
  tooltype?: ToolType;
  lib?: number;
  categoryId?: number;
  category: string;
  /** 썸네일 data URL ('' 이면 렌더 실패) */
  thumb: string;
  /** GLB data URL */
  glb: string;
  /** 외곽 틀 크기 mm — w=X 폭, d=Y 깊이, h=Z 높이 */
  bbox: { w: number; d: number; h: number };
};

/** 에디터 열기 요청 — 새로 만들기(모델 유형 선택부터) 또는 기존 모델 편집 */
export type ModelOpenRequest =
  | { mode: 'new'; tooltype: ToolType }
  | { mode: 'edit'; id: string };
