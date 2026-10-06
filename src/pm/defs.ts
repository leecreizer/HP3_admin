import data from './defs.json';
import type { ToolType } from './modelTypes';

/**
 * 쿠지알러 에디터 정의 데이터(요소·보조 구조·모델·외곽 틀·부품 인스턴스·수식 함수·업무 속성·확장 속성).
 * defs.json ← scripts/build-pm-defs.py (editor/api/site 조회 덤프, 한글 라벨 포함)
 */

export interface DefOption { name: string; zh: string; value: string }
export interface DefTree { name: string; value: string; children?: DefTree[] }
export interface ParamDef {
  name: string;
  /** 원문 표시 이름 */
  zh: string;
  label: string;
  /** 값 형식 — float · int · string · boolean · material · float2 · float3 · plankpath · loftpath · shape … */
  type: string;
  value: string | null;
  /** 패널 묶음 — 0 크기 · 2 부품(기본) · 3 물리 · 4 프론트 사용 */
  group: number | null;
  visible: boolean;
  def?: string;
  editable?: false;
  /** 5 = 각도(°) */
  format?: number;
  options?: DefOption[];
  recommends?: unknown[];
  btOptions?: DefTree[];
}
export interface ElementDef {
  id: string;
  fn: string;
  section: string;
  zh: string;
  name: string;
  params: ParamDef[];
  businessType?: string;
  localeId?: string;
  /** 도구 종류별로 다른 기본값 */
  toolValues?: Partial<Record<ToolType, Record<string, string>>>;
}
export interface FnDef { name: string; type: number; desc: string; example: string }
export interface BizDef { id: number; key: string; zh: string; name: string; type: string; def: string | null; formula: boolean; formulaName?: string; tools: string[]; options: DefOption[] }
export interface ExtAttrDef { key: string; zh: string; name: string; tip: string; type: string; def: string; supportTypes?: unknown; inputBoxType?: unknown }
export interface ShapeRef { id: string; name: string; height: string | null; preview: string | null }

type Defs = {
  elements: ElementDef[];
  model: ElementDef;
  frame: ElementDef;
  instance: ElementDef;
  tools: Record<ToolType, Record<string, string[]> & { shapes: ShapeRef[] }>;
  functions: FnDef[];
  bizProps: BizDef[];
  bizByCat: Record<string, number[]>;
  bizByFn: Record<string, number[]>;
  bizByParam: Record<string, Record<string, number[]>>;
  extAttrs: ExtAttrDef[];
};

export const DEFS = data as unknown as Defs;

const BY_ID = new Map(DEFS.elements.map((e) => [e.id, e]));
export const elementDef = (id: string): ElementDef | undefined =>
  id === 'instance' ? DEFS.instance : id === DEFS.frame.id ? DEFS.frame : BY_ID.get(id);

/** 구조 탐색·요소 라이브러리의 묶음 — 쿠지알러 정의 덤프의 배열 이름 */
export const SECTION_LABEL: Record<string, string> = {
  paramModels: '부품', modelInstances: '부품', frameModels: '모델 외곽 틀', moldingPaths: '윤곽 제한', adsorbs: '흡착선', innerFrameModels: '내부 공간',
  customDoorHoles: '문 개구부', intersectBoxes: '간섭 영역', connectors: '연결', connectorModels: '연결 부품', wireLayouts: '배선', customAuxiliaries: '사용자 정의 구조',
};
/** 구조 탐색 묶음 순서(쿠지알러 화면): 부품 · 모델 외곽 틀 · 윤곽 제한 · 흡착선 · 내부 공간 · 문 개구부 · 간섭 영역 · 연결 부품 · 사용자 정의 구조 */
export const NAV_GROUPS: { key: string; label: string; sections: string[] }[] = [
  { key: 'parts', label: '부품', sections: ['paramModels', 'modelInstances'] },
  { key: 'frame', label: '모델 외곽 틀', sections: ['frameModels'] },
  { key: 'molding', label: '윤곽 제한', sections: ['moldingPaths'] },
  { key: 'adsorb', label: '흡착선', sections: ['adsorbs'] },
  { key: 'inner', label: '내부 공간', sections: ['innerFrameModels'] },
  { key: 'door', label: '문 개구부', sections: ['customDoorHoles'] },
  { key: 'intersect', label: '간섭 영역', sections: ['intersectBoxes'] },
  { key: 'connect', label: '연결 부품', sections: ['connectors', 'connectorModels', 'wireLayouts'] },
  { key: 'custom', label: '사용자 정의 구조', sections: ['customAuxiliaries'] },
];

/** 속성 패널 묶음 — 화면 순서: 크기 → 물리 → 부품(기본) → 프론트 사용 */
export const PANEL_GROUPS: { id: number; label: string }[] = [
  { id: 0, label: '크기 속성' }, { id: 3, label: '물리 속성' }, { id: 2, label: '부품 속성' }, { id: 4, label: '프론트 사용 속성' },
];

/** 요소 라이브러리 단축키(쿠지알러 단축키 창) — 요소 id → 키 */
export const INSERT_KEYS: Record<string, string> = {
  'PrimitiveModel.plank': 'Shift+P', 'PrimitiveModel.brepSweepExtend': 'Shift+O', 'PrimitiveModel.sideStylePlank': 'Shift+U',
  'PrimitiveModel.lofting': 'Shift+F', 'PrimitiveModel.brepSweep': 'Shift+S', 'PrimitiveModel.grid': 'Shift+W',
  'LinellaeInstance.exLinellaeInstance': 'Shift+L', 'AdsorbLine.adsorbLine': 'Shift+X', 'AdsorbLine.rightAdsorbLine': 'Shift+Z',
  'AdsorbLine.adsorbPlane': 'Shift+K', 'FrameInstance.positionCenterBoxInnerFrameInstance': 'Shift+N',
  'LinellaeInstance.cabinetWardrobeDoorHole': 'Shift+M', 'Intersect.intersectBox': 'Shift+C', 'ConnectorModel.pipeConnector': 'Shift+G',
};

/** 도구 종류에서 쓸 수 있는 요소(파라메트릭 모델 요소)와 보조 구조 */
export function toolElements(tool: ToolType): { elements: ElementDef[]; aux: ElementDef[] } {
  const t = DEFS.tools[tool];
  const pick = (ids: string[] | undefined) => (ids ?? []).map((id) => BY_ID.get(id)).filter((e): e is ElementDef => !!e);
  const auxSections = ['moldingPaths', 'innerFrameModels', 'customDoorHoles', 'intersectBoxes', 'adsorbs', 'connectors', 'connectorModels', 'wireLayouts', 'customAuxiliaries'];
  return { elements: pick(t.paramModels), aux: auxSections.flatMap((s) => pick(t[s])) };
}

/** 요소의 기본 변수 값 (도구 종류별 기본값 반영) */
export function defaultParams(def: ElementDef, tool?: ToolType): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.params) {
    const v = p.value ?? p.def ?? '';
    out[p.name] = v === 'None' ? '' : String(v);
  }
  const tv = tool && def.toolValues?.[tool];
  if (tv) Object.assign(out, tv);
  return out;
}

export const FUNCTIONS = DEFS.functions;
export const BIZ_PROPS = DEFS.bizProps;
export const EXT_ATTRS = DEFS.extAttrs;
export const bizById = (id: number) => BIZ_PROPS.find((b) => b.id === id);

/** 모델 업무 속성 — 실제 분류(真分类) id 별로 쓸 수 있는 속성 */
export const modelBizProps = (catId: number | undefined) => (catId != null ? DEFS.bizByCat[String(catId)] ?? [] : []).map(bizById).filter((b): b is BizDef => !!b);
/** 요소 업무 속성 — 함수 이름(+업무 유형) 별 */
export const elementBizProps = (def: ElementDef) =>
  (DEFS.bizByFn[def.businessType ? `${def.fn}#${def.businessType}` : def.fn] ?? []).map(bizById).filter((b): b is BizDef => !!b);
