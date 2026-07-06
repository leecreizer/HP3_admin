import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderIcon, PencilIcon, SearchIcon, TrashIcon } from '../components/icons';
import { ThSort, useSort } from '../components/sortable';
import { Pagination, usePagination } from '../components/Pagination';
import { AssetViewer } from '../components/AssetViewer';
import { useConfirm } from '../components/confirm';
import type { Group } from '../data/org';
import { loadSwapState, expandMembers } from '../data/groups';
import { putAsset, getAsset, getAssets } from '../data/assetStore';
import { convertFbxToGlb, glbToDataUrl } from '../data/fbxConvert';

/** kind: 'external'=설계 메뉴 노출 폴더 / 'internal'=숨김(부위 상품 보관, 그룹으로만 노출) */
type Folder = { id: string; name: string; parentId: string | null; kind?: 'external' | 'internal'; thumb?: string; thumbReset?: boolean; asProduct?: boolean; hidden?: boolean };

/** 속성 구분: 등록 시 필수 선택 */
type AttrType = '모델링' | '텍스쳐' | '머터리얼';

/** 운영 사이즈 — 축별 최소/최대/간격(mm). max>min & gap>0이면 단계 선택, min만 또는 min==max면 고정 */
export type OpSize = {
  minW?: number; maxW?: number; gapW?: number;
  minD?: number; maxD?: number; gapD?: number;
  minH?: number; maxH?: number; gapH?: number;
};

/** 운영 사이즈에서 한 축의 선택 가능한 값 목록. 미설정 축이면 null(자유 입력) */
export function opSizeOptions(op: OpSize | undefined, axis: 'W' | 'D' | 'H'): number[] | null {
  if (!op) return null;
  const min = op[`min${axis}`], max = op[`max${axis}`], gap = op[`gap${axis}`];
  if (min == null) return null;
  if (max != null && max > min && gap && gap > 0) {
    const arr: number[] = [];
    for (let v = min; v <= max + 1e-6; v += gap) arr.push(Math.round(v));
    if (arr[arr.length - 1] !== max) arr.push(max); // 끝값 보정
    return arr;
  }
  return [min]; // 고정
}

type OpSizeForm = { minW: string; maxW: string; gapW: string; minD: string; maxD: string; gapD: string; minH: string; maxH: string; gapH: string };
const OPSIZE_KEYS = ['minW', 'maxW', 'gapW', 'minD', 'maxD', 'gapD', 'minH', 'maxH', 'gapH'] as const;
/** 폼(문자열) → OpSize. 모든 값이 비면 undefined */
function formToOpSize(fs: OpSizeForm): OpSize | undefined {
  const out: OpSize = {};
  let any = false;
  for (const k of OPSIZE_KEYS) { const n = Number(fs[k]); if (fs[k].trim() !== '' && !Number.isNaN(n)) { out[k] = n; any = true; } }
  return any ? out : undefined;
}
/** 폼 수식 → 저장형 (모두 비면 undefined) */
function formToFormula(f: { w: string; d: string; h: string }): { w?: string; d?: string; h?: string } | undefined {
  const out: { w?: string; d?: string; h?: string } = {};
  if (f.w.trim()) out.w = f.w.trim();
  if (f.d.trim()) out.d = f.d.trim();
  if (f.h.trim()) out.h = f.h.trim();
  return out.w || out.d || out.h ? out : undefined;
}

/** OpSize → 폼(문자열) */
function opSizeToForm(op: OpSize | undefined): OpSizeForm {
  const out = { minW: '', maxW: '', gapW: '', minD: '', maxD: '', gapD: '', minH: '', maxH: '', gapH: '' };
  if (op) for (const k of OPSIZE_KEYS) if (op[k] != null) out[k] = String(op[k]);
  return out;
}

/**
 * 안전한 수식 계산기 (eval 미사용) — 쿠지알러 스타일.
 * 지원: 숫자/소수, #변수 또는 변수, + - * / ( ), 비교(>= <= > < == !=),
 *       AND/OR/NOT(또는 && || !), 함수(sin/cos/tan/asin/acos/toRadians/toDegrees/sqrt/abs/min/max/round/floor/ceil/if).
 * 변수명은 # 유무 모두 허용. 결과는 number 또는 boolean. 실패 시 null.
 */
const FORMULA_FNS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  toradians: (d) => (d * Math.PI) / 180, todegrees: (r) => (r * 180) / Math.PI,
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a), pow: (a, b) => Math.pow(a, b),
};
/** 수식 값 — 숫자·불리언·문자(필드값 비교용) */
type FormulaVal = number | boolean | string;
export function evalFormula(expr: string, vars: Record<string, number | string>): number | boolean | string | null {
  if (!expr || !expr.trim()) return null;
  // 변수명: 영문/한글 시작, 점(.) 경로 허용 — 예) #body.LDH. 문자 리터럴: '값' 또는 "값"
  const tokens = expr.match(/'[^']*'|"[^"]*"|>=|<=|==|!=|&&|\|\||[<>+\-*/(),!]|#?[A-Za-z_가-힣][\w가-힣]*(?:\.[A-Za-z_가-힣][\w가-힣]*)*|\d*\.?\d+/g);
  if (!tokens) return null;
  let i = 0; let bad = false;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];
  const kw = (t: string | undefined, w: string) => !!t && t.toLowerCase() === w;
  const num = (v: FormulaVal): number => {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') { const n = Number(v); if (Number.isNaN(n)) { bad = true; return 0; } return n; }
    return v;
  };

  const parseOr = (): FormulaVal => {
    let v = parseAnd();
    while (kw(peek(), 'or') || peek() === '||') { eat(); const r = parseAnd(); v = (!!num(v) || !!num(r)); }
    return v;
  };
  const parseAnd = (): FormulaVal => {
    let v = parseCmp();
    while (kw(peek(), 'and') || peek() === '&&') { eat(); const r = parseCmp(); v = (!!num(v) && !!num(r)); }
    return v;
  };
  const parseCmp = (): FormulaVal => {
    let v: FormulaVal = parseAdd();
    while (['>=', '<=', '>', '<', '==', '!='].includes(peek() ?? '')) {
      const op = eat(); const rv = parseAdd();
      // ==/!= 는 한쪽이라도 문자면 문자 비교(필드값 매칭: #productKind == '여닫이도어')
      if ((op === '==' || op === '!=') && (typeof v === 'string' || typeof rv === 'string')) {
        const eq = String(v) === String(rv);
        v = op === '==' ? eq : !eq;
        continue;
      }
      const r = num(rv); const l = num(v);
      v = op === '>=' ? l >= r : op === '<=' ? l <= r : op === '>' ? l > r : op === '<' ? l < r : op === '==' ? l === r : l !== r;
    }
    return v;
  };
  const parseAdd = (): FormulaVal => {
    let v = parseMul();
    while (peek() === '+' || peek() === '-') { const op = eat(); const r = num(parseMul()); v = op === '+' ? num(v) + r : num(v) - r; }
    return v;
  };
  const parseMul = (): FormulaVal => {
    let v = parseUnary();
    while (peek() === '*' || peek() === '/') { const op = eat(); const r = num(parseUnary()); v = op === '*' ? num(v) * r : num(v) / r; }
    return v;
  };
  const parseUnary = (): FormulaVal => {
    const t = peek();
    if (t === '-') { eat(); return -num(parseUnary()); }
    if (t === '+') { eat(); return num(parseUnary()); }
    if (t === '!' || kw(t, 'not')) { eat(); return num(parseUnary()) ? 0 : 1; }
    return parsePrimary();
  };
  const parsePrimary = (): FormulaVal => {
    const t = peek();
    if (t === undefined) { bad = true; return 0; }
    if (t === '(') { eat(); const v = parseOr(); if (peek() === ')') eat(); else bad = true; return v; }
    eat();
    // 문자 리터럴 — '여닫이도어', "SMP10001"
    if (/^['"]/.test(t)) return t.slice(1, -1);
    if (/^#?[A-Za-z_가-힣]/.test(t)) {
      const name = t.replace(/^#/, '');
      const low = name.toLowerCase();
      if (low === 'true') return true; if (low === 'false') return false;
      if (low === 'pi') return Math.PI;
      if (peek() === '(') { // 함수 호출
        eat(); const args: number[] = [];
        if (peek() !== ')') { args.push(num(parseOr())); while (peek() === ',') { eat(); args.push(num(parseOr())); } }
        if (peek() === ')') eat(); else bad = true;
        if (low === 'if') return args[0] ? args[1] : args[2];
        const fn = FORMULA_FNS[low]; if (!fn) { bad = true; return 0; }
        return fn(...args);
      }
      if (name in vars) return vars[name];
      bad = true; return 0;
    }
    return Number(t);
  };
  const result = parseOr();
  if (bad || i !== tokens.length) return null;
  if (typeof result === 'boolean' || typeof result === 'string') return result;
  return Number.isFinite(result) ? result : null;
}

type Product = {
  /** 컨텐츠 코드 — 배치된 상품을 찾기 위한 키코드 */
  contentCode: string;
  /** 컨텐츠명 — 기준정보와 다르게 표기되는 상품명 */
  name: string;
  brand: string;
  /** 상품군 — 부엌, 바스, 수납, 도어, 창호, 침실, 거실 등 */
  productGroup: string;
  /** 견적그룹 — 상품마다 구분된 견적 로직 */
  quoteGroup: string;
  /** 상품코드 — 견적 가격을 갖고 있는 코드 (수정 불가) */
  productCode: string;
  /** 모델코드 — 모델 식별 코드 */
  modelCode?: string;
  /** 품목코드 — 품목 식별 코드 */
  itemCode?: string;
  /** 비규격 여부 — 체크 시 비규격(맞춤). 기본 false(규격) */
  nonStandard?: boolean;
  /** 노출여부 — 설계페이지 상품 리스트 노출 */
  visible: boolean;
  /** 가격(원) */
  price?: number;
  /** 컨텐츠 권한 — '전체' 또는 사용자 관리의 그룹 id */
  permission: string;
  w: number;
  d: number;
  h: number;
  /** 운영 사이즈 — 축별 MIN/MAX/GAP. 있으면 기본정보 사이즈를 범위·간격으로 선택 */
  opSize?: OpSize;
  /** 표시 컬러(hex) — 모델(마감) 라인 구분용. 웹플래너 박스 배치 시 이 색으로 렌더 */
  color?: string;
  /** DP 정보 — 몸통↔도어 매칭 키. 같은 DP끼리 자동 배치 */
  dp?: string;
  /** POS 정보 — 도어가 몸통에 붙는 위치(예: L/R, 좌우 오프셋) */
  pos?: string;
  /** (구버전) 내보내기 수식 — 이름 W/D/H '수식' 변수로 대체. 기존 데이터 호환용으로만 유지 */
  formula?: { w?: string; d?: string; h?: string };
  /** 사용자 정의 변수 — 수식에서 #name 으로 참조.
   *  type: 고정값(숫자) / 수식(계산식 — 이름이 W·D·H면 내보내기 치수로 사용) / 조건식(모두 TRUE일 때만 자동배치).
   *  type 미지정(구버전)은 값이 숫자면 고정값, 아니면 수식으로 취급. */
  vars?: { name: string; value: string; type?: VarType; expose?: boolean }[];
  /** (구버전) 조건식 — '조건식' 유형 변수로 대체. 기존 데이터 호환용으로만 유지 */
  condition?: string;
  placement: '바닥' | '벽' | '천장';
  /** 배치 높이 — 바닥배치 기본 0, 벽장 등은 벽장배치 높이 */
  placeHeight: number;
  attrType: AttrType;
  /** 모델링 구분 — 배치형(가구 배치) / 설계형(치수 맞춤 시공). 모델링이 아닌 경우 null */
  modelingType: '배치형' | '설계형' | null;
  /** 상품 구분 — 스윙장, 슬라이딩장, 침대 등 형태 (교체 시 사용) */
  productKind: string;
  /** 모델 구분 — 시그니처, KB, EO, 유로503 등 (선택) */
  modelKind: string;
  /** 필터 분류 — 선택된 옵션 id 목록 */
  filterValues?: string[];
  /** 운영정보 조합별 입력값 */
  opValues?: Record<string, string>;
  /** 구성/교체 슬롯 — 모델링 교체 그룹 연결 (도어→도어그룹 등)
   *  rules: 조건식(evalFormula)→교체 묶음(groupId) 분기. 위에서부터 참인 첫 규칙의 그룹 사용, 없으면 기본 groupId */
  modelingSlots?: { slot: string; groupId: string; defaultModelingId?: string; rules?: { condition: string; groupId: string }[] }[];
  /** 적용 가능 스타일 — 스타일 그룹 관리의 스타일 id 연결 (스타일 선택 시 부위 일괄 교체 대상) */
  styleIds?: string[];
  /** 스펙/몰 URL — 이름+주소 쌍 목록 */
  specUrls?: { name: string; url: string }[];
  mallUrls?: { name: string; url: string }[];
  thumb: '' | 'k2' | 'k3';
  /** 업로드된 썸네일 이미지(data URL). 있으면 thumb 대신 표시 */
  thumbUrl?: string;
  /** 업로드된 에셋 — 파일 확장자로 종류 자동 인식 */
  assets?: { id: string; name: string; type: '모델링' | '재질' | '텍스쳐' | '기타'; url?: string }[];
  /** 실제 3D 모델(GLB/GLTF) URL — 설계 배치 시 박스 대신 이 모델을 로드 */
  modelUrl?: string;
  /** 소속 모델 그룹 id (그룹 관리의 교체 그룹) */
  modelGroupId?: string;
  folderId: string;
  updatedAt: string;
  updatedBy: string;
  /** 수정 이력 — 저장 시 '수정 내용' 입력값을 누적 기록 (일시/수정자/내용). */
  editLogs?: { at: string; by: string; note: string }[];
};


/** 상품군 마스터 — 용도나 공간에 맞게 정리 */
export const INITIAL_PRODUCT_GROUPS = ['부엌', '바스', '수납', '도어', '창호', '가구', '조명', '소품', '마감재'];

/** 견적그룹 항목 — 견적 로직 키(name)와 설명(desc) */
export type QuoteGroup = { name: string; desc: string };
/** 견적그룹 공통영역 키 — 모든 상품군에서 함께 선택 가능 */
export const QUOTE_COMMON_KEY = '공통';
/** 상품군별 견적그룹 — 상품군마다 다른 견적 로직 키. '공통'은 전 상품군 공용 */
const INITIAL_QUOTE_GROUPS: Record<string, QuoteGroup[]> = {
  [QUOTE_COMMON_KEY]: [
    { name: '배송 설치', desc: '제품 배송 및 설치 인건비' },
    { name: '철거', desc: '기존 제품 철거 비용' },
    { name: '폐기물 처리', desc: '철거 폐기물 수거/처리' },
  ],
  부엌: [
    { name: '키친 시공', desc: 'SSD 서라운딩 등 부엌 시공 일체' },
    { name: '키친 자재', desc: '상판/도어/몸통 등 자재비' },
  ],
  바스: [
    { name: '욕실 시공', desc: '방수/타일/설비 시공' },
    { name: '욕실 자재', desc: '도기/수전/액세서리 자재' },
  ],
  수납: [
    { name: '붙박이장', desc: '맞춤 붙박이 수납 제작·설치' },
    { name: '시스템 수납', desc: '모듈형 시스템 수납' },
  ],
  도어: [{ name: '도어 시공', desc: '문틀/도어 설치 시공' }],
  창호: [{ name: '창호 시공', desc: '창호 교체/설치 시공' }],
  가구: [{ name: '가구', desc: '완제품 가구 단가' }],
  조명: [{ name: '조명', desc: '조명 제품 및 설치' }],
  소품: [{ name: '소품', desc: '데코 소품 단가' }],
  마감재: [{ name: '마감재', desc: '마루/벽지/타일 자재·시공' }],
};

/** 상품군별 상품 구분(품목) 목록 */
const INITIAL_KINDS: Record<string, string[]> = {
  부엌: ['키친', '아일랜드', '싱크볼'],
  바스: ['양변기', '세면대', '욕조', '샤워부스'],
  수납: ['스윙장', '슬라이딩장', '서랍장'],
  도어: ['여닫이도어', '슬라이딩도어', '중문'],
  창호: ['발코니창', '거실창', '방창'],
  가구: ['침대', '소파', '책상', '의자'],
  조명: ['펜던트', '스탠드', '레일'],
  소품: ['화병', '액자', '러그'],
  마감재: ['마루', '벽지', '타일'],
};

/** 상품군별 모델(시리즈) 목록 */
const INITIAL_MODELS: Record<string, string[]> = {
  가구: ['노뜨', '스위브', 'KB'],
  부엌: ['EO', '유로9000'],
  수납: ['시그니처', '유로503'],
  바스: ['샘'],
  마감재: ['유로503'],
};

/**
 * 컨텐츠 운영정보 — 상품군+상품구분 조합별로 노출할 항목 정의.
 * 키: `${상품군}|${상품구분}` (구분 무관이면 `${상품군}`). 조합 매핑은 추후 사용자가 정리해 채운다.
 */
type OperationField = { key: string; label: string; placeholder?: string };
const OPERATION_SPEC: Record<string, OperationField[]> = {
  // 예) '부엌|싱크볼': [{ key: 'bowlCount', label: '볼 개수' }],
};

/** 필터: 제목 그룹 + 선택 항목(옵션) 2단 구조 */
export type FilterOption = { id: string; name: string };
export type FilterGroup = { id: string; name: string; options: FilterOption[] };

export const INITIAL_FILTER_GROUPS: FilterGroup[] = [
  { id: 'fg-style', name: '스타일', options: [
    { id: 'fo-modern', name: '모던' }, { id: 'fo-natural', name: '내추럴' },
    { id: 'fo-classic', name: '클래식' }, { id: 'fo-nordic', name: '북유럽' }, { id: 'fo-minimal', name: '미니멀' },
  ] },
  { id: 'fg-color', name: '색상', options: [
    { id: 'fo-white', name: '화이트' }, { id: 'fo-gray', name: '그레이' },
    { id: 'fo-wood', name: '우드' }, { id: 'fo-black', name: '블랙' },
  ] },
  { id: 'fg-space', name: '공간', options: [
    { id: 'fo-living', name: '거실' }, { id: 'fo-bed', name: '침실' }, { id: 'fo-kitchen', name: '주방' },
  ] },
];

/** DB 필드 정의 — 컨텐츠 등록(가구) 공통 스펙 */
type FieldDef = {
  key: string;
  label: string;
  /** 직접 입력 필요 여부 */
  manualInput: boolean;
  required: boolean;
  /** 수정 가능 여부 */
  editable: boolean;
  example: string;
  /** 시스템 기본 필드는 삭제 불가 */
  builtin: boolean;
};

const INITIAL_FIELDS: FieldDef[] = [
  { key: 'brand', label: '브랜드', manualInput: true, required: false, editable: true, example: '한샘, 리바트, 이케아 등 타사 상품 등록시 관리', builtin: true },
  { key: 'productGroup', label: '상품군', manualInput: true, required: true, editable: true, example: '부엌, 바스, 수납, 도어, 창호 등 용도나 공간에 맞게 정리', builtin: true },
  { key: 'name', label: '상품명', manualInput: true, required: true, editable: true, example: '기준정보와 다르게 표기되는 상품명', builtin: true },
  { key: 'quoteGroup', label: '견적그룹', manualInput: true, required: true, editable: true, example: '상품마다 구분된 견적 로직 적용', builtin: true },
  { key: 'contentCode', label: '컨텐츠 코드', manualInput: false, required: true, editable: false, example: '자동 생성되는 키코드 — 수정 불가', builtin: true },
  { key: 'productCode', label: '상품코드', manualInput: true, required: true, editable: false, example: '견적 가격을 갖고있는 코드', builtin: true },
  { key: 'visible', label: '노출여부', manualInput: true, required: true, editable: true, example: '설계페이지 상품 리스트 노출여부', builtin: true },
  { key: 'permission', label: '사용자 그룹', manualInput: true, required: true, editable: true, example: '이 사용자 그룹에 속한 사용자에게 컨텐츠 노출', builtin: true },
  { key: 'w', label: '컨텐츠 길이(W)', manualInput: true, required: true, editable: true, example: '컨텐츠 길이 사이즈', builtin: true },
  { key: 'd', label: '컨텐츠 깊이(D)', manualInput: true, required: true, editable: true, example: '컨텐츠 깊이 사이즈', builtin: true },
  { key: 'h', label: '컨텐츠 높이(H)', manualInput: true, required: true, editable: true, example: '컨텐츠 높이 사이즈', builtin: true },
  { key: 'placement', label: '배치 위치', manualInput: true, required: true, editable: true, example: '바닥, 벽 등 배치가능 위치 설정', builtin: true },
  { key: 'placeHeight', label: '배치 높이', manualInput: true, required: true, editable: true, example: '바닥배치는 기본 0, 벽장 등은 벽장배치 높이로 설정', builtin: true },
  { key: 'attrType', label: '속성 구분', manualInput: true, required: true, editable: true, example: '모델링, 텍스쳐, 머터리얼 컨텐츠 구분에 필요', builtin: true },
  { key: 'productKind', label: '상품 구분', manualInput: true, required: true, editable: true, example: '스윙장, 슬라이딩장, SRD, EP, 서랍장, 침대 → 상품형태끼리 교체시 사용', builtin: true },
  { key: 'modelKind', label: '모델 구분', manualInput: true, required: false, editable: true, example: '시그니처, KB, EO, 유로503 등', builtin: true },
  { key: 'filter', label: '필터', manualInput: true, required: false, editable: true, example: '컨텐츠별 필터 설정', builtin: true },
  { key: 'specUrl', label: '스펙 url', manualInput: true, required: false, editable: true, example: '기준정보에서 가져옴', builtin: true },
  { key: 'mallUrl', label: 'mall url', manualInput: true, required: false, editable: true, example: '상품별 한샘몰 상세페이지 정보 연결', builtin: true },
  { key: 'assetBundle', label: 'Asset Bundle', manualInput: true, required: true, editable: true, example: '유니티에서 표시되는 모델링 데이터', builtin: true },
  { key: 'binary', label: 'Binary', manualInput: true, required: true, editable: true, example: '모델링 데이터 버전관리시 사용 (확인필요)', builtin: true },
  { key: 'thumbnail', label: '썸네일 이미지', manualInput: true, required: true, editable: true, example: '상품 리스트에 표시되는 상품별 이미지', builtin: true },
];

/** 노출/비노출 각각의 최상위 미분류 루트 — 삭제·이동·이름변경 불가 */
const ROOT_FOLDER_ID = 'f-root';        // 노출(설계 메뉴 노출)
const INT_ROOT_ID = 'f-root-int';       // 비노출(부위 보관, 그룹으로만 노출)
const ROOT_IDS = [ROOT_FOLDER_ID, INT_ROOT_ID];

export const INITIAL_FOLDERS: Folder[] = [
  // ── 노출 폴더 (설계형 / 배치형 / 재질형) ──
  { id: ROOT_FOLDER_ID, name: '미분류', parentId: null, kind: 'external' },
  // 설계형
  { id: 'f-grp-design', name: '설계형', parentId: ROOT_FOLDER_ID, kind: 'external' },
  { id: 'f-kitchen', name: '부엌', parentId: 'f-grp-design', kind: 'external' },
  { id: 'f-storage', name: '수납', parentId: 'f-grp-design', kind: 'external' },
  // 수납 하위 — 종류별 최종 폴더(샘플 상품 분류). 상품은 최종 폴더 직속으로만 배치해 목록 혼동 방지.
  { id: 'f-storage-body', name: '몸통', parentId: 'f-storage', kind: 'external' },
  { id: 'f-storage-door', name: '도어', parentId: 'f-storage', kind: 'external' },
  { id: 'f-storage-ep', name: 'EP', parentId: 'f-storage', kind: 'external' },
  { id: 'f-storage-srd', name: '상부 서라운딩', parentId: 'f-storage', kind: 'external' },
  { id: 'f-storage-srs', name: '측면 서라운딩', parentId: 'f-storage', kind: 'external' },
  { id: 'f-bath', name: '바스', parentId: 'f-grp-design', kind: 'external' },
  { id: 'f-door', name: '도어', parentId: 'f-grp-design', kind: 'external' },
  { id: 'f-window', name: '창호', parentId: 'f-grp-design', kind: 'external' },
  // 배치형
  { id: 'f-grp-place', name: '배치형', parentId: ROOT_FOLDER_ID, kind: 'external' },
  { id: 'f-furniture', name: '가구', parentId: 'f-grp-place', kind: 'external' },
  { id: 'f-bed', name: '침실 가구', parentId: 'f-furniture', kind: 'external' },
  { id: 'f-sofa', name: '소파', parentId: 'f-furniture', kind: 'external' },
  { id: 'f-light', name: '조명', parentId: 'f-grp-place', kind: 'external' },
  { id: 'f-props', name: '소품', parentId: 'f-grp-place', kind: 'external' },
  // 재질형
  { id: 'f-grp-mat', name: '재질형', parentId: ROOT_FOLDER_ID, kind: 'external' },
  { id: 'f-floor', name: '마루', parentId: 'f-grp-mat', kind: 'external' },
  { id: 'f-wall', name: '벽지', parentId: 'f-grp-mat', kind: 'external' },
  { id: 'f-tile', name: '타일', parentId: 'f-grp-mat', kind: 'external' },
  { id: 'f-film', name: '필름', parentId: 'f-grp-mat', kind: 'external' },
  // ── 비노출 폴더 (부위 상품 보관) ──
  { id: INT_ROOT_ID, name: '미분류', parentId: null, kind: 'internal' },
  { id: 'fi-storage', name: '수납', parentId: INT_ROOT_ID, kind: 'internal' },
  { id: 'fi-door', name: '도어', parentId: 'fi-storage', kind: 'internal' },
  { id: 'fi-handle', name: '손잡이', parentId: 'fi-storage', kind: 'internal' },
];

/* ---------- 테스트용 가짜 상품 데이터 생성기 (상품군별 10~20개) ---------- */
type SeedDef = {
  group: string;
  folder: string;
  quote: string;
  placement: '바닥' | '벽' | '천장';
  attr: AttrType;
  modeling: '배치형' | '설계형' | null;
  prefix: string;
  size: [number, number, number];
};

const SEED_DEFS: SeedDef[] = [
  { group: '부엌', folder: 'f-kitchen', quote: '키친 시공', placement: '바닥', attr: '모델링', modeling: '설계형', prefix: 'KIT', size: [3600, 1500, 2100] },
  { group: '바스', folder: 'f-bath', quote: '욕실', placement: '바닥', attr: '모델링', modeling: '배치형', prefix: 'BTH', size: [700, 600, 800] },
  { group: '수납', folder: 'f-storage-body', quote: '붙박이장', placement: '벽', attr: '모델링', modeling: '설계형', prefix: 'STR', size: [2400, 650, 2350] },
  { group: '도어', folder: 'f-door', quote: '도어', placement: '벽', attr: '모델링', modeling: '배치형', prefix: 'DOR', size: [900, 50, 2100] },
  { group: '창호', folder: 'f-window', quote: '창호 시공', placement: '벽', attr: '모델링', modeling: '설계형', prefix: 'WIN', size: [2100, 200, 1400] },
  { group: '가구', folder: 'f-furniture', quote: '가구', placement: '바닥', attr: '모델링', modeling: '배치형', prefix: 'FUR', size: [1600, 800, 750] },
  { group: '조명', folder: 'f-light', quote: '조명', placement: '천장', attr: '모델링', modeling: '배치형', prefix: 'LGT', size: [400, 400, 350] },
  { group: '소품', folder: 'f-props', quote: '소품', placement: '바닥', attr: '모델링', modeling: '배치형', prefix: 'PRP', size: [300, 300, 400] },
  { group: '마감재', folder: 'f-floor', quote: '마감재', placement: '바닥', attr: '텍스쳐', modeling: null, prefix: 'FIN', size: [0, 0, 0] },
];

const SEED_STYLES: { name: string; fo: string }[] = [
  { name: '모던', fo: 'fo-modern' }, { name: '내추럴', fo: 'fo-natural' },
  { name: '클래식', fo: 'fo-classic' }, { name: '북유럽', fo: 'fo-nordic' }, { name: '미니멀', fo: 'fo-minimal' },
];
const SEED_COLORS: { name: string; fo: string; bg: string; fg: string }[] = [
  { name: '화이트', fo: 'fo-white', bg: '#eef0f2', fg: '#374151' },
  { name: '그레이', fo: 'fo-gray', bg: '#9aa1aa', fg: '#ffffff' },
  { name: '우드', fo: 'fo-wood', bg: '#b08856', fg: '#ffffff' },
  { name: '블랙', fo: 'fo-black', bg: '#3a3d42', fg: '#f3f4f6' },
];

/** 썸네일 없는 상품 기본 썸네일 — 라이트 그레이 배경 + 이미지 아이콘 */
export const DEFAULT_THUMB = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>` +
  `<rect width='200' height='200' fill='#eceef0'/>` +
  `<rect x='58' y='52' width='84' height='66' rx='8' fill='none' stroke='#b9bec4' stroke-width='6'/>` +
  `<circle cx='82' cy='76' r='8' fill='#b9bec4'/>` +
  `<path d='M64 112 L92 86 L112 106 L126 94 L136 112 Z' fill='#b9bec4'/>` +
  `<text x='100' y='150' font-family='Pretendard,sans-serif' font-size='16' font-weight='600' fill='#9aa1aa' text-anchor='middle'>썸네일 없음</text>` +
  `</svg>`,
)}`;

/** 변수 값 유형 — 고정값(숫자) / 수식(계산식) / 조건식(TRUE·FALSE 판정) */
export type VarType = '고정값' | '수식' | '조건식';
export const VAR_TYPES: VarType[] = ['고정값', '수식', '조건식'];
/** 구버전(type 미지정) 변수의 유형 판별 — 숫자면 고정값, 아니면 수식 */
export function varTypeOf(v: { value: string; type?: VarType }): VarType {
  if (v.type) return v.type;
  return v.value.trim() !== '' && !Number.isNaN(Number(v.value)) ? '고정값' : '수식';
}

/** 기본 정보·운영정보 필드 도움말 — ⍰ 클릭 시 자기 변수명(#참조명) 뱃지 + 활용법 안내.
 *  v: 이 필드의 수식 변수명 / d: 설명 */
type FieldHint = { v?: string; d: string };
const FIELD_HINTS: Record<string, FieldHint> = {
  name: { v: '#name', d: "설계 화면·견적서 표기 이름. 문자값 — 조건식 비교: #name == '샘플 몸통'" },
  brand: { v: '#brand', d: "브랜드 표기·필터 분류. 문자값 — 예: #brand == '한샘'" },
  quoteGroup: { v: '#quoteGroup', d: "견적 계산 로직 연결 키. 문자값 — 예: #quoteGroup == '붙박이장'" },
  productGroup: { v: '#productGroup', d: "대분류. 문자값 — 예: #productGroup == '수납'" },
  productKind: { v: '#productKind', d: "품목(형태) — 부위 교체·DP 매칭 기준. 문자값 — 예: #productKind == '여닫이도어'" },
  modelKind: { v: '#modelKind', d: "시리즈(마감 모델). 문자값 — 예: #modelKind == '매트화이트'" },
  contentCode: { v: '#contentCode', d: "배치 상품 식별 키코드. 문자값 — 예: #contentCode == 'SMP-BODY-001'" },
  productCode: { v: '#productCode', d: "견적 가격 조회 키. 문자값 — 예: #productCode == 'SMP10001'" },
  modelCode: { v: '#modelCode', d: '형제 변형 매칭 키 — 같은 모델코드+품목코드끼리 사이즈 단계 교체. 문자값' },
  itemCode: { v: '#itemCode', d: '형제 변형 매칭 키(품목). 문자값' },
  permission: { v: '#permission', d: "노출 권한(그룹 id 또는 '전체'). 문자값" },
  price: { v: '#price', d: '가격(원). 수식·조건식에서 사용 (예: #price > 100000)' },
  attrType: { v: '#attrType', d: "컨텐츠 성격. 문자값 — 예: #attrType == '모델링'" },
  nonStandard: { v: '#nonStandard', d: '규격유무 — 비규격=1, 규격=0 (예: #nonStandard == 1)' },
  size: { v: '#W #D #H', d: '자기 치수(mm) — 수식·조건식에서 참조' },
  w: { v: '#W', d: '자기 폭(mm) (예: #W/2 - 9)' },
  d: { v: '#D', d: '자기 깊이(mm)' },
  h: { v: '#H', d: '자기 높이(mm) (예: #H - #LDH)' },
  placement: { v: '#placement', d: "배치 기준면. 문자값 — 예: #placement == '벽'" },
  placeHeight: { v: '#lift', d: '배치 높이(mm, 바닥에서 띄움)' },
  opSize: { v: '#minW #maxW #gapW · #minD #maxD #gapD · #minH #maxH #gapH', d: '값을 설정한 축만 참조 가능 (예: #maxH - 50). 규격+GAP>1: 단계 선택 / 비규격: 자유 입력' },
  vars: { v: '#이름', d: "사용자 변수. 이름 W/D/H '수식' = 내보내기 치수, '조건식' = 모두 TRUE일 때만 배치, 노출☑ = 설계 화면 표시·조정. 내장 변수: #W #D #H #lift #price #minW~#gapH" },
};

/** ⍰ 도움말 아이콘 — 클릭 시 변수명 뱃지 + 활용법 팝오버 표시 (호버 인지 어려움 보완) */
export function HelpTip({ text }: { text: FieldHint | string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const hint: FieldHint = typeof text === 'string' ? { d: text } : text;
  return (
    <span className="help-tip-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="help-tip" aria-label="사용법 보기" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}>?</button>
      {open && (
        <span className="help-pop" role="tooltip">
          <span className="help-pop-var">
            {hint.v ? <code>{hint.v}</code> : <em>수식 변수 아님</em>}
          </span>
          {hint.d}
        </span>
      )}
    </span>
  );
}

/** 수납(f-storage) 직속 상품 → 종류별 최종 폴더 이관 대상 판정.
 *  수납은 분류(중간) 폴더로 바뀌었으므로 직속 상품은 품목 기준으로 최종 폴더에 배치한다. */
export function storageLeafFolder(p: { folderId?: string; productKind?: string }): string | null {
  if (p.folderId !== 'f-storage') return null;
  const k = p.productKind ?? '';
  if (k === 'EP') return 'f-storage-ep';
  if (k.includes('상부')) return 'f-storage-srd';
  if (k.includes('측면')) return 'f-storage-srs';
  if (k.includes('도어')) return 'f-storage-door';
  return 'f-storage-body';
}

/** 생성 데이터용 썸네일 — 상품 종류 실루엣 + 컬러 + 명칭 라벨 SVG.
 *  'hp3gen' 마커 포함 → 로더의 구형 SVG 썸네일 정리 로직이 기본 썸네일로 덮지 않는다. */
export function genThumb(kind: 'door' | 'ep' | 'srd' | 'srs' | 'body' | 'swatch', label: string, color = '#c9cdd2'): string {
  const edge = `stroke='rgba(30,36,44,.22)' stroke-width='2'`;
  const glyph =
    kind === 'door'
      ? `<rect x='72' y='24' width='56' height='114' rx='6' fill='${color}' ${edge}/>` +
        `<circle cx='118' cy='82' r='4.5' fill='rgba(255,255,255,.9)' stroke='rgba(30,36,44,.3)'/>`
      : kind === 'ep'
      ? `<rect x='86' y='24' width='20' height='114' rx='4' fill='${color}' ${edge}/>` +
        `<rect x='106' y='30' width='10' height='102' rx='3' fill='${color}' opacity='.55'/>`
      : kind === 'srd'
      ? `<rect x='36' y='66' width='128' height='26' rx='6' fill='${color}' ${edge}/>` +
        `<rect x='36' y='96' width='128' height='6' rx='3' fill='${color}' opacity='.4'/>`
      : kind === 'srs'
      ? `<rect x='90' y='24' width='20' height='114' rx='5' fill='${color}' ${edge}/>`
      : kind === 'body'
      ? `<rect x='56' y='24' width='88' height='114' rx='7' fill='${color}' ${edge}/>` +
        `<line x1='100' y1='24' x2='100' y2='138' stroke='rgba(30,36,44,.28)' stroke-width='2'/>` +
        `<line x1='56' y1='81' x2='144' y2='81' stroke='rgba(30,36,44,.2)' stroke-width='2'/>`
      : `<rect x='52' y='30' width='96' height='96' rx='14' fill='${color}' ${edge}/>`;
  const short = label.length > 12 ? `${label.slice(0, 12)}…` : label;
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><!--hp3gen-->` +
    `<rect width='200' height='200' fill='#f4f5f7'/>` +
    glyph +
    `<text x='100' y='170' font-family='Pretendard,sans-serif' font-size='15' font-weight='600' fill='#4b5563' text-anchor='middle'>${short}</text>` +
    `</svg>`,
  )}`;
}
const SEED_EDITORS = ['이동우', '강현우', '한소율', '김지안', '박서준'];
const SEED_THUMBS: ('' | 'k2' | 'k3')[] = ['', 'k2', 'k3'];

function generateSeedProducts(): Product[] {
  const out: Product[] = [];
  let n = 0;
  for (const d of SEED_DEFS) {
    const kinds = INITIAL_KINDS[d.group] ?? ['일반'];
    const models = INITIAL_MODELS[d.group] ?? [];
    // 상품군별 10~20개 (그룹명 길이로 결정 — 빌드 간 동일 유지)
    const count = 10 + ((d.group.length * 7 + d.prefix.charCodeAt(0)) % 11);
    for (let i = 0; i < count; i++) {
      n += 1;
      const kind = kinds[i % kinds.length];
      const model = models.length ? models[i % models.length] : '';
      const style = SEED_STYLES[i % SEED_STYLES.length];
      const color = SEED_COLORS[i % SEED_COLORS.length];
      const isFinish = d.attr !== '모델링';
      const [bw, bd, bh] = d.size;
      // 가구는 침대/소파를 전용 하위 폴더로 배치
      const folder =
        d.group === '가구' ? (kind === '침대' ? 'f-bed' : kind === '소파' ? 'f-sofa' : 'f-furniture')
        : d.group === '마감재' ? (kind === '벽지' ? 'f-wall' : kind === '타일' ? 'f-tile' : 'f-floor')
        : d.folder;
      const attr: AttrType = isFinish ? (kind === '벽지' ? '머터리얼' : '텍스쳐') : '모델링';
      out.push({
        contentCode: `SEED${d.prefix}${String(n).padStart(4, '0')}`,
        name: `${model ? model + ' ' : ''}${kind} ${style.name} ${color.name} ${String(i + 1).padStart(2, '0')}`,
        brand: i % 7 === 0 ? '리바트' : '한샘',
        productGroup: d.group,
        quoteGroup: d.quote,
        productCode: `${d.prefix}${String(10000 + n)}`,
        visible: i % 6 !== 0,
        permission: i % 5 === 0 ? 'g-ops' : '전체',
        w: isFinish ? 0 : bw + (i % 5) * 100,
        d: isFinish ? 0 : bd + (i % 3) * 50,
        h: isFinish ? 0 : bh + (i % 4) * 20,
        placement: d.placement,
        placeHeight: d.placement === '벽' ? 600 + (i % 3) * 100 : 0,
        attrType: attr,
        modelingType: isFinish ? null : d.modeling,
        productKind: kind,
        modelKind: model,
        filterValues: [style.fo, color.fo],
        thumb: SEED_THUMBS[i % SEED_THUMBS.length],
        thumbUrl: genThumb('swatch', `${kind} ${color.name}`, color.bg),
        folderId: folder,
        updatedAt: `2026-06-${String(1 + (n % 14)).padStart(2, '0')}`,
        updatedBy: SEED_EDITORS[n % SEED_EDITORS.length],
      });
    }
  }
  return out;
}

/** ── #body.변수명(몸통 사용자 변수 참조) 확인용 샘플 ──
 *  몸통 1(변수 LDH=20, 패널두께=18) + 도어 3(L/R 수식 참조, X는 조건 미충족 데모).
 *  설계 미리보기: 수납 폴더에서 "샘플 몸통" 배치 → 스타일 설정 탭 → [샘플 도어(#body 데모)] 클릭.
 *  기대 결과: 도어 W = #bodyW/2 - #body.패널두께 = 582, H = #bodyH - #body.LDH = 1980,
 *            X도어는 조건(#body.LDH >= 999) 미충족으로 제외 토스트에 표기. */
const SAMPLE_COMMON = {
  brand: '한샘', visible: true, permission: '전체', filterValues: [] as string[],
  thumb: '' as const, thumbUrl: DEFAULT_THUMB, updatedAt: '2026-07-03', updatedBy: '시스템',
};
export const SAMPLE_BODYVAR_PRODUCTS: Product[] = [
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-BODY-001', name: '샘플 몸통 — #body 변수 데모',
    productGroup: '수납', quoteGroup: '붙박이장', productCode: 'SMP10001',
    thumbUrl: genThumb('body', '샘플 몸통', '#c9a063'), color: '#c9a063',
    w: 1200, d: 600, h: 2000, dp: 'SMP',
    vars: [
      { name: 'LDH', value: '20', type: '고정값', expose: true },
      { name: '패널두께', value: '18', type: '고정값', expose: true },
    ],
    modelingSlots: [{ slot: '도어', groupId: 'sg-sample-bodyvar-door' }],
    placement: '바닥', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
    productKind: '스윙장', modelKind: '', folderId: 'f-storage-body',
  },
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-DOOR-L01', name: '샘플 도어 L — W=#bodyW/2-#body.패널두께',
    productGroup: '도어', quoteGroup: '도어', productCode: 'SMP20001',
    thumbUrl: genThumb('door', '샘플 도어 L'),
    w: 600, d: 20, h: 2000, dp: 'SMP', pos: 'L',
    vars: [
      { name: 'W', value: '#bodyW/2 - #body.패널두께', type: '수식' },
      { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
      { name: '배치가능', value: '#body.LDH >= 20', type: '조건식' },
    ],
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
    productKind: '여닫이도어', modelKind: '', folderId: 'fi-door',
  },
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-DOOR-R01', name: '샘플 도어 R — H=#bodyH-#body.LDH',
    productGroup: '도어', quoteGroup: '도어', productCode: 'SMP20002',
    thumbUrl: genThumb('door', '샘플 도어 R'),
    w: 600, d: 20, h: 2000, dp: 'SMP', pos: 'R',
    vars: [
      { name: 'W', value: '#bodyW/2 - #body.패널두께', type: '수식' },
      { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
      { name: '배치가능', value: '#body.LDH >= 20', type: '조건식' },
    ],
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
    productKind: '여닫이도어', modelKind: '', folderId: 'fi-door',
  },
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-DOOR-X01', name: '샘플 도어 X — 조건 미충족 데모(#body.LDH >= 999)',
    productGroup: '도어', quoteGroup: '도어', productCode: 'SMP20003',
    thumbUrl: genThumb('door', '샘플 도어 X'),
    w: 600, d: 20, h: 2000, dp: 'SMP', pos: 'X',
    vars: [
      { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
      { name: '배치가능', value: '#body.LDH >= 999', type: '조건식' },
    ],
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
    productKind: '여닫이도어', modelKind: '', folderId: 'fi-door',
  },
  // ── 수납 몸통 부속 샘플 (노출 폴더 f-storage) ──
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-EP-001', name: '샘플 EP — 비규격 (W/D 최대 현재크기 · H 최대 9999)',
    productGroup: '수납', quoteGroup: '붙박이장', productCode: 'SMP30001',
    thumbUrl: genThumb('ep', '샘플 EP'),
    w: 20, d: 700, h: 2400, nonStandard: true,
    opSize: { minW: 10, maxW: 20, gapW: 1, minD: 10, maxD: 700, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
    placement: '바닥', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
    productKind: 'EP', modelKind: '', folderId: 'f-storage-ep',
  },
  // 상부 서라운딩 — H 50(기본)/75/100/200 형제 변형(같은 modelCode+itemCode → 설계에서 H 단계 선택)
  ...[50, 75, 100, 200].map((sh, i): Product => ({
    ...SAMPLE_COMMON,
    contentCode: `SMP-SRD-${String(sh).padStart(3, '0')}`,
    name: `샘플 상부 서라운딩 H${sh} — 비규격 (W 최대 9999)`,
    productGroup: '수납', quoteGroup: '붙박이장', productCode: `SMP4000${i + 1}`,
    thumbUrl: genThumb('srd', `상부 H${sh}`),
    modelCode: 'SMP-SRD', itemCode: 'SRD',
    w: 2400, d: 20, h: sh, nonStandard: true,
    opSize: { minW: 10, maxW: 9999, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: sh, gapH: 1 },
    placement: '벽', placeHeight: 2400 - sh, attrType: '모델링', modelingType: '설계형',
    productKind: '상부 서라운딩', modelKind: '', folderId: 'f-storage-srd',
  })),
  // 측면 서라운딩 — W 50(기본)/75/100/200 개별 추가(같은 modelCode+itemCode → 설계에서 W 단계 선택)
  ...[50, 75, 100, 200].map((sw, i): Product => ({
    ...SAMPLE_COMMON,
    contentCode: `SMP-SRS-${String(sw).padStart(3, '0')}`,
    name: `샘플 측면 서라운딩 W${sw} — 비규격 (H 최대 9999)`,
    productGroup: '수납', quoteGroup: '붙박이장', productCode: `SMP4500${i + 1}`,
    thumbUrl: genThumb('srs', `측면 W${sw}`),
    modelCode: 'SMP-SRS', itemCode: 'SRS',
    w: sw, d: 20, h: 2400, nonStandard: true,
    opSize: { minW: 10, maxW: sw, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
    productKind: '측면 서라운딩', modelKind: '', folderId: 'f-storage-srs',
  })),
  // ── 수납 노출 폴더 도어 샘플 — DP/POS/수식 정보 포함 ──
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-DOOR-N01', name: '샘플 여닫이도어 L — 노출 (DP SMP · H=#bodyH-#body.LDH)',
    productGroup: '도어', quoteGroup: '도어', productCode: 'SMP50001',
    thumbUrl: genThumb('door', '여닫이도어 L'),
    w: 600, d: 20, h: 2400, dp: 'SMP', pos: 'L', nonStandard: true,
    opSize: { minW: 10, maxW: 600, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
    vars: [
      { name: 'W', value: '#bodyW/2 - #body.패널두께', type: '수식' },
      { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
      { name: '배치가능', value: '#body.LDH >= 20', type: '조건식' },
    ],
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
    productKind: '여닫이도어', modelKind: '', folderId: 'f-storage-door',
  },
  {
    ...SAMPLE_COMMON,
    contentCode: 'SMP-DOOR-N02', name: '샘플 여닫이도어 R — 노출 (DP SMP · W=#bodyW/2-#body.패널두께)',
    productGroup: '도어', quoteGroup: '도어', productCode: 'SMP50002',
    thumbUrl: genThumb('door', '여닫이도어 R'),
    w: 600, d: 20, h: 2400, dp: 'SMP', pos: 'R', nonStandard: true,
    opSize: { minW: 10, maxW: 600, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
    vars: [
      { name: 'W', value: '#bodyW/2 - #body.패널두께', type: '수식' },
      { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
      { name: '배치가능', value: '#body.LDH >= 20', type: '조건식' },
    ],
    placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
    productKind: '여닫이도어', modelKind: '', folderId: 'f-storage-door',
  },
  // ── 컬러(마감 모델)별 도어·EP·서라운딩 상품 세트 ──
  //    모델 라인(예: 매트화이트)마다 도어 L/R + EP + 상부/측면 서라운딩을 개별 상품으로 생성·등록.
  //    사이즈 규칙은 위 기준 상품과 동일: EP W10~20·D10~700·H10~9999, 상부 H단계·W10~9999, 측면 W단계·H10~9999 (갭1).
  ...([
    { name: '매트화이트', code: 'MWH', fo: 'fo-white', hex: '#e9eae7' },
    { name: '크림아이보리', code: 'CIV', fo: 'fo-white', hex: '#f0e8d6' },
    { name: '매트그레이', code: 'MGR', fo: 'fo-gray', hex: '#a2a8b0' },
    { name: '스톤차콜', code: 'SCH', fo: 'fo-gray', hex: '#6a7076' },
    { name: '리노아베이지', code: 'LBG', fo: 'fo-wood', hex: '#d8c6ab' },
    { name: '네추럴오크', code: 'NOK', fo: 'fo-wood', hex: '#c79a63' },
    { name: '월넛브라운', code: 'WNB', fo: 'fo-wood', hex: '#7e5a3a' },
    { name: '세이지그린', code: 'SGN', fo: 'fo-gray', hex: '#a4b8a1' },
    { name: '미드나잇네이비', code: 'MNV', fo: 'fo-black', hex: '#33405c' },
    { name: '매트블랙', code: 'MBK', fo: 'fo-black', hex: '#43474d' },
  ] as const).flatMap((c, ci): Product[] => [
    // 여닫이도어 L/R — DP 'SMP', #body 수식·조건 포함
    ...(['L', 'R'] as const).map((pos, pi): Product => ({
      ...SAMPLE_COMMON,
      contentCode: `SMP-DOOR-${c.code}-${pos}`,
      name: `${c.name} 여닫이도어 ${pos}`,
      productGroup: '도어', quoteGroup: '도어', productCode: `SMP6${ci}0${pi + 1}`,
      color: c.hex, thumbUrl: genThumb('door', `${c.name} ${pos}`, c.hex),
      w: 600, d: 20, h: 2400, dp: 'SMP', pos, nonStandard: true,
      opSize: { minW: 10, maxW: 600, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
      vars: [
        { name: 'W', value: '#bodyW/2 - #body.패널두께', type: '수식' },
        { name: 'H', value: '#bodyH - #body.LDH', type: '수식' },
        { name: '배치가능', value: '#body.LDH >= 20', type: '조건식' },
      ],
      filterValues: [c.fo],
      placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '배치형',
      productKind: '여닫이도어', modelKind: c.name, folderId: 'f-storage-door',
    })),
    // EP — W 10~20 · D 10~700 · H 10~9999 (갭1)
    {
      ...SAMPLE_COMMON,
      contentCode: `SMP-EP-${c.code}`, name: `${c.name} EP`,
      productGroup: '수납', quoteGroup: '붙박이장', productCode: `SMP6${ci}03`,
      color: c.hex, thumbUrl: genThumb('ep', `${c.name} EP`, c.hex),
      w: 20, d: 700, h: 2400, nonStandard: true,
      opSize: { minW: 10, maxW: 20, gapW: 1, minD: 10, maxD: 700, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
      filterValues: [c.fo],
      placement: '바닥', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
      productKind: 'EP', modelKind: c.name, folderId: 'f-storage-ep',
    },
    // 상부 서라운딩 — H 50/75/100/200 개별(모델별 형제 라인, W 10~9999)
    ...[50, 75, 100, 200].map((sh, i): Product => ({
      ...SAMPLE_COMMON,
      contentCode: `SMP-SRD-${c.code}-${String(sh).padStart(3, '0')}`,
      name: `${c.name} 상부 서라운딩 H${sh}`,
      productGroup: '수납', quoteGroup: '붙박이장', productCode: `SMP6${ci}1${i + 1}`,
      color: c.hex, thumbUrl: genThumb('srd', `${c.name} H${sh}`, c.hex),
      modelCode: `SMP-SRD-${c.code}`, itemCode: 'SRD',
      w: 2400, d: 20, h: sh, nonStandard: true,
      opSize: { minW: 10, maxW: 9999, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: sh, gapH: 1 },
      filterValues: [c.fo],
      placement: '벽', placeHeight: 2400 - sh, attrType: '모델링', modelingType: '설계형',
      productKind: '상부 서라운딩', modelKind: c.name, folderId: 'f-storage-srd',
    })),
    // 측면 서라운딩 — W 50/75/100/200 개별(모델별 형제 라인, H 10~9999)
    ...[50, 75, 100, 200].map((sw, i): Product => ({
      ...SAMPLE_COMMON,
      contentCode: `SMP-SRS-${c.code}-${String(sw).padStart(3, '0')}`,
      name: `${c.name} 측면 서라운딩 W${sw}`,
      productGroup: '수납', quoteGroup: '붙박이장', productCode: `SMP6${ci}2${i + 1}`,
      color: c.hex, thumbUrl: genThumb('srs', `${c.name} W${sw}`, c.hex),
      modelCode: `SMP-SRS-${c.code}`, itemCode: 'SRS',
      w: sw, d: 20, h: 2400, nonStandard: true,
      opSize: { minW: 10, maxW: sw, gapW: 1, minD: 10, maxD: 20, gapD: 1, minH: 10, maxH: 9999, gapH: 1 },
      filterValues: [c.fo],
      placement: '벽', placeHeight: 0, attrType: '모델링', modelingType: '설계형',
      productKind: '측면 서라운딩', modelKind: c.name, folderId: 'f-storage-srs',
    })),
  ]),
];

export const INITIAL_PRODUCTS: Product[] = [...SAMPLE_BODYVAR_PRODUCTS, ...generateSeedProducts()];
export const PRODUCTS_STORE_KEY_EXPORT = 'hp3-products-state';

let folderSeq = 0;
let productSeq = 0;

/** 상품관리 상태 영속화 (localStorage) */
const PRODUCTS_STORE_KEY = 'hp3-products-state';
/** 기본값(시드/구조)을 바꾸면 이 버전을 올려 옛 저장본을 무효화 */
const PRODUCTS_STORE_VERSION = 6;
type ProductsSnapshot = {
  products: Product[];
  folders: Folder[];
  productGroups: string[];
  quoteGroups: Record<string, QuoteGroup[]>;
  kindsByGroup: Record<string, string[]>;
  modelsByGroup: Record<string, string[]>;
  filterGroups: FilterGroup[];
  fields: FieldDef[];
  /** UI 상태 — 선택 폴더, 접힌 폴더, 패널 너비 */
  activeFolder: string;
  collapsedFolders: string[];
  folderWidth: number;
};
function loadProductsState(): Partial<ProductsSnapshot> {
  try {
    const raw = JSON.parse(localStorage.getItem(PRODUCTS_STORE_KEY) ?? '{}');
    if (raw.__v !== PRODUCTS_STORE_VERSION) return {}; // 버전 불일치 → 기본값 사용
    const data = raw as Partial<ProductsSnapshot>;
    // 썸네일 없는 기존 상품에 이름 기반 썸네일 자동 채움
    if (data.products) {
      // 업로드 이미지(jpeg/png)와 생성 썸네일('hp3gen' 마커)은 유지, 없거나 옛 SVG 라벨이면 기본 회색+아이콘으로 교체
      data.products = data.products.map((p) =>
        (p.thumbUrl && (!p.thumbUrl.startsWith('data:image/svg') || p.thumbUrl.includes('hp3gen'))) ? p : { ...p, thumbUrl: DEFAULT_THUMB });
      // 수납 직속 상품 → 종류별 최종 폴더 이관 (수납은 분류 폴더).
      // ⚠ 시드(updatedBy='시스템') 상품만 — 사용자가 이동/수정한 상품의 폴더를
      //   매 로드마다 되돌리던 문제('저장해도 원복')의 원인이라 제외한다.
      data.products = data.products.map((p) => {
        if (p.updatedBy !== '시스템') return p;
        const leaf = storageLeafFolder(p);
        return leaf ? { ...p, folderId: leaf } : p;
      });
      // #body 변수 데모 샘플 — 저장본에 없으면 추가, 사용자가 수정하지 않은 것(updatedBy='시스템')은 최신 시드로 동기화
      for (const sp of SAMPLE_BODYVAR_PRODUCTS) {
        const idx = data.products.findIndex((p) => p.contentCode === sp.contentCode);
        if (idx < 0) data.products.unshift(sp);
        else if (data.products[idx].updatedBy === '시스템') data.products[idx] = sp;
      }
    }
    // 노출/비노출 미분류 루트는 항상 존재해야 함
    if (data.folders) {
      if (!data.folders.some((f) => f.id === ROOT_FOLDER_ID)) data.folders.unshift({ id: ROOT_FOLDER_ID, name: '미분류', parentId: null, kind: 'external' });
      if (!data.folders.some((f) => f.id === INT_ROOT_ID)) data.folders.push({ id: INT_ROOT_ID, name: '미분류', parentId: null, kind: 'internal' });
      // 수납 하위 샘플 분류 폴더(몸통/도어/EP/서라운딩) 보장 — 기존 저장본에 없으면 병합
      const fl = data.folders;
      for (const sf of INITIAL_FOLDERS.filter((f) => f.parentId === 'f-storage')) {
        if (!fl.some((f) => f.id === sf.id)) fl.push({ ...sf });
      }
    }
    return data;
  } catch {
    return {};
  }
}
function saveProductsState(s: ProductsSnapshot) {
  try {
    // 에셋 바이너리(data URL)는 용량이 커 localStorage에 못 담으므로 IndexedDB에 저장하고,
    // 여기(localStorage)엔 메타(id/name/type)만 보관한다. data URL은 putAsset로 IDB에 stash.
    const products = s.products.map((p) => ({
      ...p,
      assets: (p.assets ?? []).map((a) => {
        if (a.url && a.url.startsWith('data:')) putAsset(a.id, a.url); // IDB 저장(비동기, 대기 불필요)
        return { id: a.id, name: a.name, type: a.type };
      }),
      // ⭐ 썸네일 data URL 도 IDB 로 오프로드 — localStorage quota 초과로 저장 전체가
      //   조용히 실패하던 문제(폴더 이동 등 '저장했는데 반영 안 됨')의 주범.
      thumbUrl:
        p.thumbUrl && p.thumbUrl.startsWith('data:')
          ? (putAsset(`thumb:${p.contentCode}`, p.thumbUrl), `idb:thumb:${p.contentCode}`)
          : p.thumbUrl,
    }));
    localStorage.setItem(PRODUCTS_STORE_KEY, JSON.stringify({ ...s, products, __v: PRODUCTS_STORE_VERSION }));
  } catch (err) {
    // 무음 실패 금지 — 사용자에게 즉시 알림 (반영 안 된 채 새로고침하면 데이터 유실 체감)
    console.error('[Products] 저장 실패', err);
    window.alert('⚠ 상품 데이터 저장에 실패했습니다 (브라우저 저장공간 부족 가능). 설정 > 백업 내보내기로 데이터를 보관한 뒤, 사용하지 않는 상품/이미지를 정리해 주세요.');
  }
}

function collectSubtree(folders: Folder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

type ProductForm = {
  /** 이번 저장의 수정 내용 메모 — 저장 시 editLogs 에 기록되고 비워짐. */
  editNote: string;
  attrType: AttrType;
  name: string;
  brand: string;
  productGroup: string;
  quoteGroup: string;
  contentCode: string;
  productCode: string;
  modelCode: string;
  itemCode: string;
  price: string;
  modelUrl: string;
  modelGroupId: string;
  permission: string;
  w: string;
  d: string;
  h: string;
  /** 운영 사이즈 입력 (문자열) — 빈값이면 미설정 */
  opSize: { minW: string; maxW: string; gapW: string; minD: string; maxD: string; gapD: string; minH: string; maxH: string; gapH: string };
  dp: string;
  pos: string;
  nonStandard: boolean;
  formula: { w: string; d: string; h: string };
  vars: { name: string; value: string; type?: VarType; expose?: boolean }[];
  condition: string;
  placement: '바닥' | '벽' | '천장';
  placeHeight: string;
  modelingType: '배치형' | '설계형';
  productKind: string;
  modelKind: string;
  folderId: string;
  filterValues: string[];
  /** 운영정보 조합별 입력값 */
  opValues: Record<string, string>;
  /** 구성/교체 슬롯 */
  modelingSlots: { slot: string; groupId: string; defaultModelingId?: string; rules?: { condition: string; groupId: string }[] }[];
  styleIds: string[];
  specUrls: { name: string; url: string }[];
  mallUrls: { name: string; url: string }[];
  /** 썸네일·에셋 — 저장 전까지 폼에만 유지 */
  thumbUrl?: string;
  assets: NonNullable<Product['assets']>;
};

const EMPTY_OPSIZE = { minW: '', maxW: '', gapW: '', minD: '', maxD: '', gapD: '', minH: '', maxH: '', gapH: '' };
const EMPTY_PRODUCT_FORM: ProductForm = {
  editNote: '',
  attrType: '모델링', name: '', brand: '한샘', productGroup: '', quoteGroup: '', contentCode: '',
  productCode: '', modelCode: '', itemCode: '', price: '', modelUrl: '', modelGroupId: '', permission: '전체', w: '', d: '', h: '', opSize: { ...EMPTY_OPSIZE }, dp: '', pos: '', nonStandard: false, formula: { w: '', d: '', h: '' }, vars: [], condition: '', placement: '바닥', placeHeight: '0',
  modelingType: '배치형', productKind: '', modelKind: '', folderId: 'f-model', filterValues: [], opValues: {},
  modelingSlots: [], styleIds: [], specUrls: [], mallUrls: [], thumbUrl: undefined, assets: [],
};

type ProductsProps = {
  /** 사용자 관리에서 생성·관리되는 그룹 — 컨텐츠 권한 옵션으로 사용 */
  groups: Group[];
  /** 좌측 하위메뉴 연동: catalog=상품군·구분, models=모델, fields=노출 필드, filters=필터 */
  panel?: 'list' | 'catalog' | 'models' | 'fields' | 'filters' | 'quoteGroups';
  onClosePanel?: () => void;
  /** 현재 로그인 관리자명 — 최종수정자에 기록 */
  currentUser?: string;
};

export function Products({ groups, panel = 'list', onClosePanel, currentUser = '관리자' }: ProductsProps) {
  const saved = useRef(loadProductsState()).current;
  // 저장 시 IDB 로 오프로드한 썸네일(idb:thumb:*) 복원
  useEffect(() => {
    const needs = (saved.products ?? []).filter((p) => p.thumbUrl?.startsWith('idb:thumb:'));
    if (needs.length === 0) return;
    void Promise.all(
      needs.map(async (p) => ({ code: p.contentCode, url: await getAsset(`thumb:${p.contentCode}`) })),
    ).then((rows) => {
      const map = new Map(rows.filter((r) => r.url).map((r) => [r.code, r.url!]));
      if (map.size === 0) return;
      setProducts((prev) => prev.map((p) => (map.has(p.contentCode) ? { ...p, thumbUrl: map.get(p.contentCode)! } : p)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [folders, setFolders] = useState<Folder[]>(saved.folders ?? INITIAL_FOLDERS);
  const [products, setProducts] = useState<Product[]>(saved.products ?? INITIAL_PRODUCTS);
  const [activeFolder, setActiveFolder] = useState<string>(saved.activeFolder ?? ROOT_FOLDER_ID);
  const [typeFilter, setTypeFilter] = useState<'all' | '배치형' | '설계형' | '텍스쳐' | '머터리얼'>('all');
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  /** 폴더 ⋯ 메뉴(폴더별) + 썸네일 변경 대상 */
  const [menuFolder, setMenuFolder] = useState<string | null>(null);
  /** ⋯ 메뉴 위치(고정 좌표) — 스크롤 컨테이너 잘림 방지 */
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const thumbTargetRef = useRef<string | null>(null);
  /** 모델링 일괄등록 — 파일 미리보기 + 상품명 직접 입력(최대 50개) */
  const BULK_MAX = 50;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkItems, setBulkItems] = useState<{ fileName: string; dataUrl: string; name: string }[]>([]);
  const excelInputRef = useRef<HTMLInputElement>(null);
  /** 컨텐츠정보 엑셀 다운로드·업로드 메뉴 */
  const [ciOpen, setCiOpen] = useState(false);
  /** 필터 선택 팝업 — 열릴 때 현재 적용 필터로 초안 초기화, 저장 시 반영 */
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<string[]>([]);
  /** 접힌 폴더 id 집합 (기본 펼침) */
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set(saved.collapsedFolders ?? []));
  const toggleFolderOpen = (id: string) =>
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [renameDraft, setRenameDraft] = useState('');
  const dragFolder = useRef<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  /** 드롭 방식: before = 대상 앞 위치로, into = 대상의 하위로 */
  const [dropMode, setDropMode] = useState<'before' | 'into'>('before');
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState<ProductForm>(EMPTY_PRODUCT_FORM);
  /** 교체 그룹(부위 상품) — 구성/교체 슬롯 연결용. 편집 진입 시 최신 로드 */
  const [swapState, setSwapState] = useState(loadSwapState);
  /** 폴더 패널 너비 (드래그로 조절) */
  const [folderWidth, setFolderWidth] = useState(saved.folderWidth ?? 250);
  const resizing = useRef(false);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = folderWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const next = Math.min(560, Math.max(180, startW + ev.clientX - startX));
      setFolderWidth(next);
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  /** 편집 화면으로 진입한 컨텐츠 코드 (null = 목록) */
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(true);
  const [editPermission, setEditPermission] = useState<string>('전체');
  const thumbFileRef = useRef<HTMLInputElement>(null);

  /** 선택한 이미지 파일을 data URL로 읽어 폼에만 반영 (저장 시 확정) */
  const onThumbFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setForm((f) => ({ ...f, thumbUrl: url }));
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // 같은 파일 재선택 허용
  };

  /** 공통 에셋 업로드 — 확장자로 종류 자동 인식 */
  const assetRef = useRef<HTMLInputElement>(null);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const detectAssetType = (name: string): '모델링' | '재질' | '텍스쳐' | '기타' => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['fbx', 'obj', 'glb', 'gltf', 'bundle', 'assetbundle'].includes(ext)) return '모델링';
    if (['mat', 'mtl', 'json'].includes(ext)) return '재질';
    if (['png', 'jpg', 'jpeg', 'ktx', 'tga', 'webp', 'bmp'].includes(ext)) return '텍스쳐';
    return '기타';
  };
  /** 업로드 후 등록 대기 중인 에셋 (등록 누르면 확정, 취소하면 폐기) */
  const [pendingAsset, setPendingAsset] = useState<NonNullable<Product['assets']>[number] | null>(null);
  const [assetBusy, setAssetBusy] = useState(false);
  // 변환 로그 — localStorage 영속: 새로고침해도 유지, 새 변환 완료 시 교체.
  const CONVERT_LOG_KEY = 'hp3-fbx-convert-log';
  const [assetMsg, _setAssetMsg] = useState(() => {
    try { return localStorage.getItem(CONVERT_LOG_KEY) ?? ''; } catch { return ''; }
  });
  const setAssetMsg = (msg: string) => {
    _setAssetMsg(msg);
    try {
      if (msg) localStorage.setItem(CONVERT_LOG_KEY, msg);
    } catch { /* ignore */ }
  };
  const onAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // 한 번에 하나의 에셋만 — 업로드하면 등록 대기 상태로.
    // data URL(base64)로 읽어 영속화·교차출처(설계 미리보기 iframe) 로드가 가능하게 한다.
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

    // FBX는 GLB로 자동 변환 — 더미(DP/hotspot 등)를 이름 마커 메시로 보존해 GLB에 살린다.
    if (ext === 'fbx') {
      setAssetBusy(true);
      try {
        const buf = await file.arrayBuffer();
        const { glb, markerCount, meshCount, vertsBefore, vertsAfter, textureCount, elapsedMs } = await convertFbxToGlb(buf);
        const glbName = file.name.replace(/\.fbx$/i, '.glb');
        setPendingAsset({ id: `a-${Date.now()}-${glbName}`, name: glbName, type: '모델링', url: glbToDataUrl(glb) });
        // 압축 로그 — FBX/GLB 크기·감소율·텍스처(WebP)·메시·마커·소요시간
        const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
        const ratio = buf.byteLength > 0 ? Math.round((1 - glb.byteLength / buf.byteLength) * 100) : 0;
        setAssetMsg(
          `✓ FBX→GLB 변환 완료 — ${mb(buf.byteLength)}MB → ${mb(glb.byteLength)}MB (${ratio >= 0 ? ratio + '%↓' : Math.abs(ratio) + '%↑'})` +
          ` · WebP 텍스처 ${textureCount}개 · 정점 ${vertsBefore.toLocaleString()}→${vertsAfter.toLocaleString()} · 메시 ${meshCount}개 · 마커 ${markerCount}개 · ${(elapsedMs / 1000).toFixed(1)}s`,
        );
        console.log('[FBX→GLB]', { file: file.name, fbxBytes: buf.byteLength, glbBytes: glb.byteLength, ratio: `${ratio}%↓`, textureCount, vertsBefore, vertsAfter, meshCount, markerCount, elapsedMs: Math.round(elapsedMs) });
      } catch (err) {
        setAssetMsg(`⚠ FBX 변환 실패: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setAssetBusy(false);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPendingAsset({ id: `a-${Date.now()}-${file.name}`, name: file.name, type: detectAssetType(file.name), url: reader.result as string });
    reader.readAsDataURL(file);
  };
  /** 등록: 대기 에셋을 목록에 확정 */
  const commitAsset = () => {
    if (!pendingAsset) return;
    setForm((f) => ({ ...f, assets: [...f.assets, pendingAsset] }));
    setPreviewAssetId(pendingAsset.id);
    setPendingAsset(null);
  };
  /** 취소: 대기 에셋 폐기 */
  const cancelAsset = () => {
    if (pendingAsset?.url) { try { URL.revokeObjectURL(pendingAsset.url); } catch { /* ignore */ } }
    setPendingAsset(null);
  };
  const removeAsset = (id: string) =>
    setForm((f) => ({ ...f, assets: f.assets.filter((a) => a.id !== id) }));

  /** 권한 표시명: '전체' 또는 그룹 이름 */
  const permissionName = (perm: string) =>
    perm === '전체' ? '전체' : groups.find((g) => g.id === perm)?.name ?? '전체';
  const [newGroup, setNewGroup] = useState('');
  /** 상품군 마스터 */
  const [productGroups, setProductGroups] = useState<string[]>(saved.productGroups ?? INITIAL_PRODUCT_GROUPS);
  const [groupInput, setGroupInput] = useState('');
  /** 견적그룹 마스터 — 상품 견적그룹 선택지 */
  const [quoteGroups, setQuoteGroups] = useState<Record<string, QuoteGroup[]>>(saved.quoteGroups ?? INITIAL_QUOTE_GROUPS);
  const [showQuoteManager, setShowQuoteManager] = useState(false);
  const [quoteInputs, setQuoteInputs] = useState<Record<string, string>>({});
  /** 이름변경 중인 견적그룹 키 "상품군::견적그룹" */
  const [quoteRenaming, setQuoteRenaming] = useState<string | null>(null);
  const [quoteRenameDraft, setQuoteRenameDraft] = useState('');
  /** DB 필드 정의 */
  const [fields, setFields] = useState<FieldDef[]>(saved.fields ?? INITIAL_FIELDS);
  const [showFieldManager, setShowFieldManager] = useState(false);
  const [fieldInput, setFieldInput] = useState('');
  /** 노출 필드 관리 임시 편집본 — 저장 시 fields에 확정 */
  const [fieldDraft, setFieldDraft] = useState<FieldDef[]>(saved.fields ?? INITIAL_FIELDS);
  const [fieldDirty, setFieldDirty] = useState(false);
  /** 필터 마스터 — 제목 그룹 + 선택 항목(2단). 컨텐츠 필터 분류에 사용 */
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>(saved.filterGroups ?? INITIAL_FILTER_GROUPS);
  const [showFilterManager, setShowFilterManager] = useState(false);
  const [newFilterGroup, setNewFilterGroup] = useState('');
  /** 그룹별 옵션 입력값 */
  const [optionInputs, setOptionInputs] = useState<Record<string, string>>({});
  /** 상품군별 상품 구분(품목) */
  const [kindsByGroup, setKindsByGroup] = useState<Record<string, string[]>>(saved.kindsByGroup ?? INITIAL_KINDS);
  const [showKindManager, setShowKindManager] = useState(false);
  const [kindInputs, setKindInputs] = useState<Record<string, string>>({});
  /** 상품군별 모델 */
  const [modelsByGroup, setModelsByGroup] = useState<Record<string, string[]>>(saved.modelsByGroup ?? INITIAL_MODELS);
  const [showModelManager, setShowModelManager] = useState(false);
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});

  // 좌측 하위메뉴 연동 — catalog = 상품군·구분 통합 관리
  useEffect(() => {
    setShowFieldManager(panel === 'fields');
    setShowFilterManager(panel === 'filters');
    setShowKindManager(panel === 'catalog');
    setShowModelManager(panel === 'models');
    setShowQuoteManager(panel === 'quoteGroups');
    if (panel === 'fields') { setFieldDraft(fields); setFieldDirty(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  // 상품관리 상태 영속화 — 자동저장 없음. '저장' 버튼(등록)으로만 localStorage 반영
  const buildSnapshot = (): ProductsSnapshot => ({
    products, folders, productGroups, quoteGroups, kindsByGroup, modelsByGroup, filterGroups, fields,
    activeFolder, collapsedFolders: [...collapsedFolders], folderWidth,
  });
  // 내용(컨텐츠) 변경 여부만 추적 — 폴더 선택/접힘 등 화면상태는 제외
  const contentSig = JSON.stringify({ products, folders, productGroups, quoteGroups, kindsByGroup, modelsByGroup, filterGroups, fields });
  const savedSigRef = useRef(contentSig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(contentSig !== savedSigRef.current); }, [contentSig]);
  const saveAll = () => { saveProductsState(buildSnapshot()); savedSigRef.current = JSON.stringify({ products, folders, productGroups, quoteGroups, kindsByGroup, modelsByGroup, filterGroups, fields }); setDirty(false); };
  /** 명시적 등록 동작(상품 등록/수정/삭제)에서 최신 값으로 즉시 영속화 */
  const persistWith = (over: Partial<ProductsSnapshot>) => {
    const snap = { ...buildSnapshot(), ...over };
    saveProductsState(snap);
    const { products: p, folders: f, productGroups: pg, quoteGroups: qg, kindsByGroup: kb, modelsByGroup: mb, filterGroups: fg, fields: fl } = snap;
    savedSigRef.current = JSON.stringify({ products: p, folders: f, productGroups: pg, quoteGroups: qg, kindsByGroup: kb, modelsByGroup: mb, filterGroups: fg, fields: fl });
    setDirty(false);
  };

  /* ---------- 견적그룹 관리 (상품군별 + 공통영역) ---------- */
  const quoteKey = (group: string, name: string) => `${group}::${name}`;
  const addQuoteGroup = (group: string) => {
    const v = (quoteInputs[group] ?? '').trim();
    if (!v) return;
    setQuoteGroups((prev) => {
      // 같은 상품군 또는 공통영역에 이미 있으면 중복 추가 금지
      const existing = new Set([...(prev[group] ?? []), ...(prev[QUOTE_COMMON_KEY] ?? [])].map((q) => q.name));
      if (existing.has(v)) return prev;
      return { ...prev, [group]: [...(prev[group] ?? []), { name: v, desc: '' }] };
    });
    setQuoteInputs((prev) => ({ ...prev, [group]: '' }));
  };
  const commitQuoteRename = () => {
    const v = quoteRenameDraft.trim();
    if (quoteRenaming && v) {
      const [group, old] = quoteRenaming.split('::');
      setQuoteGroups((prev) => ({ ...prev, [group]: (prev[group] ?? []).map((q) => (q.name === old ? { ...q, name: v } : q)) }));
      setProducts((p) => p.map((pr) => (pr.quoteGroup === old ? { ...pr, quoteGroup: v } : pr))); // 사용 중인 상품 동기화
    }
    setQuoteRenaming(null);
  };
  const setQuoteDesc = (group: string, name: string, desc: string) =>
    setQuoteGroups((prev) => ({ ...prev, [group]: (prev[group] ?? []).map((q) => (q.name === name ? { ...q, desc } : q)) }));
  const deleteQuoteGroup = (group: string, name: string) =>
    setQuoteGroups((prev) => ({ ...prev, [group]: (prev[group] ?? []).filter((q) => q.name !== name) }));

  const addKind = (group: string) => {
    const name = (kindInputs[group] ?? '').trim();
    if (!name) return;
    setKindsByGroup((prev) => {
      const list = prev[group] ?? [];
      if (list.includes(name)) return prev;
      return { ...prev, [group]: [...list, name] };
    });
    setKindInputs((prev) => ({ ...prev, [group]: '' }));
  };
  const deleteKind = (group: string, name: string) =>
    setKindsByGroup((prev) => ({ ...prev, [group]: (prev[group] ?? []).filter((k) => k !== name) }));

  /** 상품군 이름 변경 — 연결된 상품/품목/모델 키도 함께 갱신 */
  const renameGroup = (oldName: string, raw: string) => {
    const name = raw.trim();
    if (!name || name === oldName || productGroups.includes(name)) return;
    setProductGroups((prev) => prev.map((g) => (g === oldName ? name : g)));
    setKindsByGroup((prev) => {
      const { [oldName]: kinds, ...rest } = prev;
      return kinds ? { ...rest, [name]: kinds } : prev;
    });
    setModelsByGroup((prev) => {
      const { [oldName]: models, ...rest } = prev;
      return models ? { ...rest, [name]: models } : prev;
    });
    setProducts((prev) => prev.map((p) => (p.productGroup === oldName ? { ...p, productGroup: name } : p)));
  };

  /** 상품 구분(품목) 이름 변경 — 해당 품목을 쓰는 상품도 갱신 */
  const renameKind = (group: string, oldName: string, raw: string) => {
    const name = raw.trim();
    if (!name || name === oldName || (kindsByGroup[group] ?? []).includes(name)) return;
    setKindsByGroup((prev) => ({ ...prev, [group]: (prev[group] ?? []).map((k) => (k === oldName ? name : k)) }));
    setProducts((prev) =>
      prev.map((p) => (p.productGroup === group && p.productKind === oldName ? { ...p, productKind: name } : p)),
    );
  };

  const addModel = (group: string) => {
    const name = (modelInputs[group] ?? '').trim();
    if (!name) return;
    setModelsByGroup((prev) => {
      const list = prev[group] ?? [];
      if (list.includes(name)) return prev;
      return { ...prev, [group]: [...list, name] };
    });
    setModelInputs((prev) => ({ ...prev, [group]: '' }));
  };
  const deleteModel = (group: string, name: string) =>
    setModelsByGroup((prev) => ({ ...prev, [group]: (prev[group] ?? []).filter((m) => m !== name) }));

  const closeKindManager = () => { setShowKindManager(false); onClosePanel?.(); };
  const closeQuoteManager = () => { setShowQuoteManager(false); onClosePanel?.(); };
  const closeModelManager = () => { setShowModelManager(false); onClosePanel?.(); };

  const closeFieldManager = () => {
    setShowFieldManager(false);
    onClosePanel?.();
  };
  const closeFilterManager = () => {
    setShowFilterManager(false);
    onClosePanel?.();
  };

  let filterSeq = 0;
  const addFilterGroup = () => {
    const name = newFilterGroup.trim();
    if (!name || filterGroups.some((g) => g.name === name)) return;
    setFilterGroups((prev) => [...prev, { id: `fg-new-${Date.now()}-${++filterSeq}`, name, options: [] }]);
    setNewFilterGroup('');
  };
  const renameFilterGroup = (id: string, name: string) => {
    setFilterGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  };
  const deleteFilterGroup = (id: string) => {
    setFilterGroups((prev) => prev.filter((g) => g.id !== id));
    setProducts((prev) =>
      prev.map((p) => ({
        ...p,
        filterValues: (p.filterValues ?? []).filter(
          (oid) => !filterGroups.find((g) => g.id === id)?.options.some((o) => o.id === oid),
        ),
      })),
    );
  };
  const addFilterOption = (groupId: string) => {
    const name = (optionInputs[groupId] ?? '').trim();
    if (!name) return;
    setFilterGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && !g.options.some((o) => o.name === name)
          ? { ...g, options: [...g.options, { id: `fo-new-${Date.now()}-${++filterSeq}`, name }] }
          : g,
      ),
    );
    setOptionInputs((prev) => ({ ...prev, [groupId]: '' }));
  };
  const deleteFilterOption = (groupId: string, optionId: string) => {
    setFilterGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, options: g.options.filter((o) => o.id !== optionId) } : g)),
    );
    setProducts((prev) =>
      prev.map((p) => ({ ...p, filterValues: (p.filterValues ?? []).filter((oid) => oid !== optionId) })),
    );
  };

  const groupOptions = productGroups;

  /** 상품군별 사용 중인 상품 수 */
  const groupUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.productGroup, (map.get(p.productGroup) ?? 0) + 1);
    return map;
  }, [products]);

  const addGroup = () => {
    const name = groupInput.trim();
    if (!name || productGroups.includes(name)) return;
    setProductGroups((prev) => [...prev, name]);
    setGroupInput('');
  };

  const deleteGroup = (name: string) => {
    if ((groupUsage.get(name) ?? 0) > 0) return;
    setProductGroups((prev) => prev.filter((g) => g !== name));
  };

  let fieldSeq = fields.length;
  const addField = () => {
    const label = fieldInput.trim();
    if (!label || fieldDraft.some((f) => f.label === label)) return;
    setFieldDraft((prev) => [
      ...prev,
      { key: `custom-${++fieldSeq}`, label, manualInput: true, required: false, editable: true, example: '', builtin: false },
    ]);
    setFieldInput('');
    setFieldDirty(true);
  };

  const patchField = (key: string, patch: Partial<FieldDef>) => {
    setFieldDraft((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    setFieldDirty(true);
  };

  const deleteField = (key: string) => {
    setFieldDraft((prev) => prev.filter((f) => f.key !== key));
    setFieldDirty(true);
  };
  const resetFields = () => { setFieldDraft(INITIAL_FIELDS); setFieldDirty(true); };
  const saveFields = () => { setFields(fieldDraft); setFieldDirty(false); setShowFieldManager(false); onClosePanel?.(); };

  const directCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) map.set(p.folderId, (map.get(p.folderId) ?? 0) + 1);
    return map;
  }, [products]);

  const activeSubtree = useMemo(() => collectSubtree(folders, activeFolder), [folders, activeFolder]);
  const activeFolderName = folders.find((f) => f.id === activeFolder)?.name ?? '';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        // 검색어가 있으면 폴더 범위를 무시하고 전체에서 검색 (다른 폴더 상품도 찾히도록)
        (q ? true : activeSubtree.has(p.folderId)) &&
        (typeFilter === 'all' ||
          (typeFilter === '배치형' || typeFilter === '설계형'
            ? p.attrType === '모델링' && p.modelingType === typeFilter
            : p.attrType === typeFilter)) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.contentCode.toLowerCase().includes(q) ||
          p.productCode.toLowerCase().includes(q)),
    );
  }, [products, activeSubtree, typeFilter, query]);

  const sort = useSort(visible, {
    name: (p: Product) => p.name,
    attrType: (p: Product) => p.attrType,
    productGroup: (p: Product) => p.productGroup,
    contentCode: (p: Product) => p.contentCode,
    productCode: (p: Product) => p.productCode,
    brand: (p: Product) => p.brand,
    quoteGroup: (p: Product) => p.quoteGroup,
    size: (p: Product) => p.w * p.d * p.h,
    placement: (p: Product) => p.placement,
    productKind: (p: Product) => p.productKind,
    modelKind: (p: Product) => p.modelKind || '￿',
    updatedAt: (p: Product) => p.updatedAt,
  });

  const pg = usePagination(sort.sorted.length, `${query}|${typeFilter}|${activeFolder}|${sort.sortKey}|${sort.dir}`);
  const pageRows = sort.sorted.slice(pg.start, pg.end);

  const typeCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (!activeSubtree.has(p.folderId)) continue;
      const key = p.attrType === '모델링' ? p.modelingType ?? '배치형' : p.attrType;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [products, activeSubtree]);

  const allChecked = visible.length > 0 && visible.every((p) => checked.has(p.contentCode));

  const toggleAll = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) visible.forEach((p) => next.delete(p.contentCode));
      else visible.forEach((p) => next.add(p.contentCode));
      return next;
    });
  };

  const toggleOne = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleVisible = (code: string) => {
    setProducts((prev) => prev.map((p) => (p.contentCode === code ? { ...p, visible: !p.visible } : p)));
  };

  /* ---------- 폴더 ---------- */
  const createFolder = () => {
    const name = newName.trim();
    if (!name || addingUnder === null) return;
    // '+ 새 폴더'는 현재 선택된 폴더 하위에 생성 (선택 없으면 노출 미분류)
    const parentId = addingUnder === 'root' ? (activeFolder || ROOT_FOLDER_ID) : addingUnder;
    const parentFolder = folders.find((f) => f.id === parentId);
    const folder: Folder = {
      id: `f-new-${Date.now()}-${++folderSeq}`,
      name,
      parentId,
      kind: parentFolder?.kind ?? 'external', // 부모 섹션(노출/비노출) 상속
    };
    setFolders((prev) => [...prev, folder]);
    // 선택을 새 폴더로 옮기지 않음 — 같은 부모 하위로 연속 생성되게 (부모 자동 펼침만)
    setCollapsedFolders((prev) => { const n = new Set(prev); n.delete(parentId); return n; });
    setNewName('');
  };

  const { confirm, confirmDialog } = useConfirm();
  // 삭제 되돌리기 — products·folders 스냅샷 (undo/redo 각 최대 10)
  const undoRef = useRef<{ products: Product[]; folders: Folder[] }[]>([]);
  const redoRef = useRef<{ products: Product[]; folders: Folder[] }[]>([]);
  const [, setHistTick] = useState(0);
  const pushHistory = () => {
    undoRef.current.push({ products, folders });
    if (undoRef.current.length > 10) undoRef.current.shift();
    redoRef.current = [];
    setHistTick((t) => t + 1);
  };
  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push({ products, folders });
    if (redoRef.current.length > 10) redoRef.current.shift();
    setProducts(prev.products); setFolders(prev.folders); persistWith({ products: prev.products, folders: prev.folders });
    setHistTick((t) => t + 1);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push({ products, folders });
    if (undoRef.current.length > 10) undoRef.current.shift();
    setProducts(next.products); setFolders(next.folders); persistWith({ products: next.products, folders: next.folders });
    setHistTick((t) => t + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // 입력 중엔 무시
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const deleteFolder = (id: string) => {
    if (ROOT_IDS.includes(id)) return;
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    // 하위 폴더가 있으면 먼저 이동/삭제해야 함
    if (folders.some((c) => c.parentId === id)) return;
    pushHistory();
    // 안에 있던 상품은 상위 폴더로 이동 (없으면 해당 섹션 미분류 루트)
    const parent = folder.parentId ?? (folder.kind === 'internal' ? INT_ROOT_ID : ROOT_FOLDER_ID);
    const nextP = products.map((p) => (p.folderId === id ? { ...p, folderId: parent } : p));
    const nextF = folders.filter((f) => f.id !== id);
    setProducts(nextP); setFolders(nextF); persistWith({ products: nextP, folders: nextF });
    if (activeFolder === id) setActiveFolder(parent);
  };

  const startRename = (id: string, name: string) => {
    setAddingUnder(null);
    setRenamingFolder(id);
    setRenameDraft(name);
  };
  const commitRename = () => {
    const name = renameDraft.trim();
    if (renamingFolder && name) {
      setFolders((prev) => prev.map((f) => (f.id === renamingFolder ? { ...f, name } : f)));
    }
    setRenamingFolder(null);
  };

  /** 폴더 썸네일 추가/변경 — 이미지 파일을 80px JPEG 데이터URL로 축소 저장 */
  const setFolderThumb = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 80;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const thumb = canvas.toDataURL('image/jpeg', 0.82);
        setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, thumb, thumbReset: false } : f)));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };
  /** 초기화 — 사용자 썸네일 제거 + 기본 폴더 이미지 강제 표시 */
  const resetFolderThumb = (id: string) =>
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, thumb: undefined, thumbReset: true } : f)));
  /** 폴더 숨기기 토글 — 설계 미리보기 라이브러리 목록에서 숨김(상품관리에는 그대로 노출) */
  const toggleFolderHidden = (id: string) => {
    const next = folders.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f));
    setFolders(next);
    persistWith({ folders: next });
  };
  /** 폴더 대표 썸네일: 사용자 지정 > (초기화 시 기본) > 첫 등록 컨텐츠 썸네일 > 기본 폴더 이미지 */
  const folderRepThumb = (id: string): string | undefined => {
    const f = folders.find((x) => x.id === id);
    if (f?.thumb) return f.thumb;
    if (f?.thumbReset) return undefined;
    // 직접 담긴 컨텐츠가 있는 폴더에만 자동 썸네일 (상위 폴더 제외)
    const inFolder = products.filter((p) => p.folderId === id);
    if (inFolder.length === 0) return undefined;
    // products는 등록 시 앞에 추가됨 → 배열 끝이 가장 먼저 등록한 컨텐츠
    const earliest = [...inFolder].reverse().find((p) => p.thumbUrl) ?? inFolder[inFolder.length - 1];
    return earliest?.thumbUrl || undefined;
  };

  /** 드래그&드롭: before = target 앞 위치(target과 같은 레벨), into = target의 하위로 */
  const reorderFolder = (src: string, target: string, mode: 'before' | 'into') => {
    if (src === target) return;
    const subtree = collectSubtree(folders, src);
    if (subtree.has(target)) return; // 자기 하위로는 불가
    setFolders((prev) => {
      const srcItem = prev.find((f) => f.id === src);
      const targetItem = prev.find((f) => f.id === target);
      if (!srcItem || !targetItem) return prev;
      const newParentId = mode === 'into' ? target : targetItem.parentId;
      const newKind = (mode === 'into' ? targetItem.kind : targetItem.kind) ?? 'external'; // 대상 섹션(노출/비노출) 상속
      // 이동되는 폴더 + 하위 전체의 섹션(kind) 동기화
      const reKinded = prev.map((f) => (subtree.has(f.id) ? { ...f, kind: newKind } : f));
      const moved = reKinded.find((f) => f.id === src)!;
      const without = reKinded.filter((f) => f.id !== src);
      if (mode === 'into') {
        without.push({ ...moved, parentId: newParentId });
      } else {
        const idx = without.findIndex((f) => f.id === target);
        without.splice(idx, 0, { ...moved, parentId: newParentId });
      }
      return without;
    });
  };

  const moveChecked = (folderId: string) => {
    if (!folderId) return;
    const today = new Date().toISOString().slice(0, 10);
    // updatedBy 스탬프 필수 — '시스템' 그대로면 로드 시 시드 동기화가 폴더를 원복시킨다
    const next = products.map((p) => (checked.has(p.contentCode) ? { ...p, folderId, updatedAt: today, updatedBy: currentUser } : p));
    setProducts(next);
    persistWith({ products: next });
    setChecked(new Set());
  };

  /** 선택 상품을 대상 폴더로 그대로 복사(추가) — 같은 상품을 새 컨텐츠코드로 해당 폴더에 생성 */
  const copyCheckedTo = (folderId: string) => {
    if (!folderId) return;
    const targets = products.filter((p) => checked.has(p.contentCode));
    if (targets.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const used = new Set(products.map((p) => p.contentCode));
    const copies = targets.map((p) => {
      let cc = `${p.contentCode}-COPY`;
      let n = 1;
      while (used.has(cc)) { n += 1; cc = `${p.contentCode}-COPY${n}`; }
      used.add(cc);
      return { ...p, contentCode: cc, folderId, updatedAt: today, updatedBy: currentUser };
    });
    const next = [...copies, ...products];
    setProducts(next);
    persistWith({ products: next });
    setChecked(new Set());
  };

  const deleteChecked = () => {
    pushHistory();
    const next = products.filter((p) => !checked.has(p.contentCode));
    setProducts(next);
    persistWith({ products: next });
    setChecked(new Set());
  };

  const toggleFilterValue = (optionId: string) =>
    setForm((f) => ({
      ...f,
      filterValues: f.filterValues.includes(optionId)
        ? f.filterValues.filter((id) => id !== optionId)
        : [...f.filterValues, optionId],
    }));

  /** 스펙/몰 URL 목록 편집 헬퍼 */
  type UrlField = 'specUrls' | 'mallUrls';
  const addUrl = (field: UrlField) => setForm((f) => ({ ...f, [field]: [...f[field], { name: '', url: '' }] }));
  const patchUrl = (field: UrlField, i: number, key: 'name' | 'url', value: string) =>
    setForm((f) => ({ ...f, [field]: f[field].map((u, idx) => (idx === i ? { ...u, [key]: value } : u)) }));
  const removeUrl = (field: UrlField, i: number) =>
    setForm((f) => ({ ...f, [field]: f[field].filter((_, idx) => idx !== i) }));

  const renderUrlList = (field: UrlField, label: string) => (
    <div className="form-field span-2">
      <span>{label}</span>
      {form[field].map((u, i) => (
        <div key={i} className="url-row">
          <input
            className="inline-input"
            style={{ width: 110 }}
            value={u.name}
            placeholder="이름"
            aria-label={`${label} 이름 ${i + 1}`}
            onChange={(e) => patchUrl(field, i, 'name', e.target.value)}
          />
          <input
            className="inline-input"
            style={{ flex: 1 }}
            value={u.url}
            placeholder="https://"
            aria-label={`${label} 주소 ${i + 1}`}
            onChange={(e) => patchUrl(field, i, 'url', e.target.value)}
          />
          <button className="asset-btn danger" aria-label={`${label} ${i + 1} 삭제`} onClick={() => removeUrl(field, i)}>✕</button>
        </div>
      ))}
      <button className="folder-new-cta" style={{ marginTop: form[field].length ? 6 : 0 }} onClick={() => addUrl(field)}>
        + {label} 추가
      </button>
    </div>
  );

  /* ---------- 상품 등록 ---------- */
  const canSubmit =
    form.name.trim() &&
    (form.productGroup === '__new__' ? newGroup.trim() : form.productGroup) &&
    form.quoteGroup.trim() &&
    form.productCode.trim() &&
    form.productKind.trim();

  const submitRegister = () => {
    if (!canSubmit) return;
    const today = new Date().toISOString().slice(0, 10);
    const nextGroups = form.productGroup === '__new__' && !productGroups.includes(newGroup.trim())
      ? [...productGroups, newGroup.trim()]
      : productGroups;
    if (nextGroups !== productGroups) setProductGroups(nextGroups);
    const nextProducts: Product[] = [
      {
        contentCode: form.contentCode.trim() || `NEW-${String(++productSeq).padStart(4, '0')}`,
        name: form.name.trim(),
        brand: form.brand.trim() || '한샘',
        productGroup: form.productGroup === '__new__' ? newGroup.trim() : form.productGroup,
        quoteGroup: form.quoteGroup.trim(),
        productCode: form.productCode.trim(),
        modelCode: form.modelCode.trim() || undefined,
        itemCode: form.itemCode.trim() || undefined,
        nonStandard: form.nonStandard,
        visible: true,
        price: Number(form.price) || 0,
        modelUrl: form.modelUrl.trim() || undefined,
        modelGroupId: form.modelGroupId || undefined,
        permission: form.permission,
        w: Number(form.w) || 0,
        d: Number(form.d) || 0,
        h: Number(form.h) || 0,
        opSize: formToOpSize(form.opSize),
        dp: form.dp.trim() || undefined,
        pos: form.pos.trim() || undefined,
        formula: formToFormula(form.formula),
        vars: form.vars.filter((v) => v.name.trim()),
        condition: form.condition.trim() || undefined,
        placement: form.placement,
        placeHeight: Number(form.placeHeight) || 0,
        attrType: form.attrType,
        modelingType: form.attrType === '모델링' ? form.modelingType : null,
        productKind: form.productKind.trim(),
        modelKind: form.modelKind.trim(),
        filterValues: form.filterValues,
        opValues: form.opValues,
        modelingSlots: form.modelingSlots,
        styleIds: form.styleIds,
        specUrls: form.specUrls.filter((u) => u.name.trim() || u.url.trim()),
        mallUrls: form.mallUrls.filter((u) => u.name.trim() || u.url.trim()),
        thumbUrl: form.thumbUrl,
        assets: form.assets,
        thumb: '',
        folderId: form.folderId,
        updatedAt: today,
        updatedBy: currentUser,
      },
      ...products,
    ];
    setProducts(nextProducts);
    // 상품 등록은 명시적 등록 동작 — 즉시 영속화
    persistWith({ products: nextProducts, productGroups: nextGroups });
    setShowRegister(false);
    setForm(EMPTY_PRODUCT_FORM);
    setNewGroup('');
  };

  /* ---------- 상품 편집 ---------- */
  /** 노출 필드 관리에서 정한 수정 가능 여부 (정의 없으면 기본 허용) */
  // 컨텐츠 코드는 자동 생성 — 기본 정책상 수정 불가(노출필드 설정과 무관하게 강제)
  const fieldEditable = (key: string) =>
    key === 'contentCode' ? false : (fields.find((f) => f.key === key)?.editable ?? true);

  const productToForm = (p: Product): ProductForm => ({
    editNote: '',
    attrType: p.attrType,
    modelingType: p.modelingType ?? '배치형',
    name: p.name,
    brand: p.brand,
    productGroup: p.productGroup,
    quoteGroup: p.quoteGroup,
    contentCode: p.contentCode,
    productCode: p.productCode,
    modelCode: p.modelCode ?? '',
    itemCode: p.itemCode ?? '',
    price: p.price ? String(p.price) : '',
    modelUrl: p.modelUrl ?? '',
    modelGroupId: p.modelGroupId ?? '',
    permission: p.permission,
    opSize: opSizeToForm(p.opSize),
    dp: p.dp ?? '',
    pos: p.pos ?? '',
    nonStandard: p.nonStandard ?? false,
    formula: { w: p.formula?.w ?? '', d: p.formula?.d ?? '', h: p.formula?.h ?? '' },
    vars: p.vars ? p.vars.map((v) => ({ ...v })) : [],
    condition: p.condition ?? '',
    w: String(p.w || ''),
    d: String(p.d || ''),
    h: String(p.h || ''),
    placement: p.placement,
    placeHeight: String(p.placeHeight),
    productKind: p.productKind,
    modelKind: p.modelKind,
    folderId: p.folderId,
    filterValues: p.filterValues ?? [],
    opValues: p.opValues ?? {},
    modelingSlots: p.modelingSlots ?? [],
    styleIds: p.styleIds ?? [],
    specUrls: p.specUrls ?? [],
    mallUrls: p.mallUrls ?? [],
    thumbUrl: p.thumbUrl,
    assets: p.assets ?? [],
  });

  const openEdit = (p: Product) => {
    setSwapState(loadSwapState()); // 최신 교체 그룹 반영
    setForm(productToForm(p));
    setEditVisible(p.visible);
    setEditPermission(p.permission);
    setEditCode(p.contentCode);
    setPendingAsset(null);
    setPreviewAssetId(p.assets?.[0]?.id ?? null); // 업로드 어셋이 있으면 첫 어셋 미리보기 자동 표시
    // 에셋 바이너리는 IDB에 있으므로 url 하이드레이트(미리보기/모델 로드용)
    const ids = (p.assets ?? []).map((a) => a.id);
    if (ids.length) getAssets(ids).then((map) => setForm((f) => ({ ...f, assets: f.assets.map((a) => (map[a.id] ? { ...a, url: map[a.id] } : a)) })));
  };

  /** 선택(체크)된 모든 상품을 그대로 복제 — 기본정보·운영정보 전체 복사, 컨텐츠코드만 새로 부여 */
  const copySelected = () => {
    const targets = products.filter((p) => checked.has(p.contentCode));
    if (targets.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const used = new Set(products.map((p) => p.contentCode));
    const copies = targets.map((p) => {
      let cc = `${p.contentCode}-COPY`;
      let n = 1;
      while (used.has(cc)) { n += 1; cc = `${p.contentCode}-COPY${n}`; }
      used.add(cc);
      return { ...p, contentCode: cc, name: `${p.name} (복사)`, updatedAt: today, updatedBy: currentUser };
    });
    const next = [...copies, ...products];
    setProducts(next);
    persistWith({ products: next });
    setChecked(new Set());
  };

  /** 모델링 파일 선택 — 미리보기 + 상품명(기본=파일명) 입력 행 생성 (최대 50개) */
  const onBulkFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const readDataUrl = (file: File) => new Promise<string>((resolve) => {
      const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => resolve(''); fr.readAsDataURL(file);
    });
    const room = BULK_MAX - bulkItems.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    const items = await Promise.all(picked.map(async (file) => ({
      fileName: file.name, dataUrl: await readDataUrl(file), name: file.name.replace(/\.[^.]+$/, ''),
    })));
    setBulkItems((prev) => [...prev, ...items].slice(0, BULK_MAX));
  };

  /** 자동 컨텐츠코드 생성 (MDL + 일련번호, 중복 회피) */
  const genContentCode = (used: Set<string>) => {
    let n = 1; let cc = '';
    do { cc = `MDL${String(Date.now() % 100000 + n).padStart(6, '0')}`; n += 1; } while (used.has(cc));
    used.add(cc); return cc;
  };

  /** 모델링 일괄등록 — 상품명이 입력된 항목을 선택 폴더에 신규 컨텐츠로 생성(컨텐츠코드 자동) */
  const applyBulkModeling = () => {
    const valid = bulkItems.filter((it) => it.name.trim() && it.dataUrl);
    if (valid.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const used = new Set(products.map((p) => p.contentCode));
    const created: Product[] = valid.map((it, i) => {
      const cc = genContentCode(used);
      const aid = `a-${Date.now()}-${i}`;
      putAsset(aid, it.dataUrl);
      return {
        contentCode: cc, name: it.name.trim(), brand: '한샘', productGroup: '', quoteGroup: '',
        productCode: cc, modelCode: '', itemCode: '', visible: true, permission: '전체',
        w: 0, d: 0, h: 0, placement: '바닥', placeHeight: 0,
        attrType: '모델링', modelingType: '배치형', productKind: '', modelKind: '',
        assets: [{ id: aid, name: it.fileName, type: '모델링', url: it.dataUrl }],
        thumb: '', folderId: activeFolder || ROOT_FOLDER_ID, updatedAt: today, updatedBy: currentUser,
      };
    });
    const next = [...created, ...products];
    setProducts(next);
    persistWith({ products: next });
    setBulkOpen(false);
    setBulkItems([]);
  };

  /** 엑셀(CSV) — 개별 상품 ‘기본 정보’ 전체 컬럼 (컨텐츠코드로 매칭해 일괄수정) */
  const serUrls = (arr?: { name: string; url: string }[]) => (arr ?? []).map((u) => `${u.name}|${u.url}`).join(' ; ');
  const parseUrls = (raw: string) => raw.split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [name, ...rest] = s.split('|'); return { name: (name ?? '').trim(), url: rest.join('|').trim() }; });
  const CSV_COLS: { key: keyof Product; label: string; out?: (p: Product) => unknown; parse?: (raw: string) => unknown }[] = [
    { key: 'contentCode', label: '컨텐츠코드' },
    { key: 'name', label: '상품명' },
    { key: 'brand', label: '브랜드' },
    { key: 'quoteGroup', label: '견적그룹' },
    { key: 'productGroup', label: '상품군' },
    { key: 'productKind', label: '상품구분' },
    { key: 'modelKind', label: '모델구분' },
    { key: 'productCode', label: '상품코드' },
    { key: 'modelCode', label: '모델코드' },
    { key: 'itemCode', label: '품목코드' },
    { key: 'permission', label: '사용자그룹' },
    { key: 'price', label: '가격', parse: (r) => Number(r) || 0 },
    { key: 'attrType', label: '속성구분' },
    { key: 'modelingType', label: '모델링구분' },
    { key: 'nonStandard', label: '규격유무', out: (p) => (p.nonStandard ? '비규격' : '규격'), parse: (r) => r.trim() === '비규격' },
    { key: 'visible', label: '노출여부', out: (p) => (p.visible === false ? '비노출' : '노출'), parse: (r) => r.trim() !== '비노출' },
    { key: 'w', label: 'W', parse: (r) => Number(r) || 0 },
    { key: 'd', label: 'D', parse: (r) => Number(r) || 0 },
    { key: 'h', label: 'H', parse: (r) => Number(r) || 0 },
    { key: 'placement', label: '배치위치' },
    { key: 'placeHeight', label: '배치높이', parse: (r) => Number(r) || 0 },
    { key: 'dp', label: 'DP' },
    { key: 'pos', label: 'POS' },
    { key: 'specUrls', label: '스펙URL', out: (p) => serUrls(p.specUrls), parse: parseUrls },
    { key: 'mallUrls', label: 'mallURL', out: (p) => serUrls(p.mallUrls), parse: parseUrls },
    { key: 'filterValues', label: '필터', out: (p) => (p.filterValues ?? []).join(' ; '), parse: (r) => r.split(';').map((s) => s.trim()).filter(Boolean) },
  ];
  const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const downloadExcelTemplate = () => {
    const head = CSV_COLS.map((c) => c.label).join(',');
    const rows = products.map((p) => CSV_COLS.map((c) => csvCell(c.out ? c.out(p) : p[c.key])).join(','));
    const csv = '﻿' + [head, ...rows].join('\r\n'); // BOM → 엑셀 한글 깨짐 방지
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `컨텐츠_일괄수정_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };
  /** 엑셀(CSV) 업로드 → 컨텐츠코드 매칭으로 기본정보 일괄 수정 */
  const onExcelUpload = async (file: File | null) => {
    if (!file) return;
    const text = (await file.text()).replace(/^﻿/, '');
    const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
    if (rows.length < 2) return;
    const header = rows[0].map((h) => h.trim());
    const colIdx = (label: string) => header.indexOf(label);
    const ccIdx = colIdx('컨텐츠코드');
    if (ccIdx < 0) { alert('엑셀에 컨텐츠코드 열이 없습니다.'); return; }
    const byCode = new Map<string, string[]>();
    rows.slice(1).forEach((r) => { const cc = (r[ccIdx] ?? '').trim(); if (cc) byCode.set(cc, r); });
    let updated = 0;
    const next = products.map((p) => {
      const r = byCode.get(p.contentCode);
      if (!r) return p;
      updated += 1;
      const patch: Record<string, unknown> = {};
      for (const c of CSV_COLS) {
        if (c.key === 'contentCode') continue;
        const idx = colIdx(c.label); if (idx < 0) continue;
        const raw = (r[idx] ?? '').trim();
        patch[c.key] = c.parse ? c.parse(raw) : raw;
      }
      return { ...p, ...patch, updatedAt: new Date().toISOString().slice(0, 10), updatedBy: currentUser } as Product;
    });
    setProducts(next);
    persistWith({ products: next });
    alert(`${updated}건 수정되었습니다.`);
  };

  const saveEdit = () => {
    if (!editCode || !form.name.trim()) return;
    const today = new Date().toISOString().slice(0, 10);
    const nextProducts = products.map((p) =>
        p.contentCode === editCode
          ? {
              ...p,
              name: form.name.trim(),
              brand: form.brand.trim() || '한샘',
              productGroup: form.productGroup,
              quoteGroup: form.quoteGroup.trim(),
              contentCode: form.contentCode.trim() || p.contentCode,
              productCode: form.productCode.trim() || p.productCode,
              modelCode: form.modelCode.trim() || undefined,
              itemCode: form.itemCode.trim() || undefined,
              nonStandard: form.nonStandard,
              permission: editPermission,
              visible: editVisible,
              price: Number(form.price) || 0,
              modelUrl: form.modelUrl.trim() || undefined,
              modelGroupId: form.modelGroupId || undefined,
              w: Number(form.w) || 0,
              d: Number(form.d) || 0,
              h: Number(form.h) || 0,
              opSize: formToOpSize(form.opSize),
              dp: form.dp.trim() || undefined,
              pos: form.pos.trim() || undefined,
              formula: formToFormula(form.formula),
              vars: form.vars.filter((v) => v.name.trim()),
              condition: form.condition.trim() || undefined,
              placement: form.placement,
              placeHeight: Number(form.placeHeight) || 0,
              attrType: form.attrType,
              modelingType: form.attrType === '모델링' ? form.modelingType : null,
              productKind: form.productKind.trim(),
              modelKind: form.modelKind.trim(),
              filterValues: form.filterValues,
              opValues: form.opValues,
              modelingSlots: form.modelingSlots,
              styleIds: form.styleIds,
              specUrls: form.specUrls.filter((u) => u.name.trim() || u.url.trim()),
              mallUrls: form.mallUrls.filter((u) => u.name.trim() || u.url.trim()),
              thumbUrl: form.thumbUrl,
              assets: form.assets,
              folderId: form.folderId,
              updatedAt: today,
              updatedBy: currentUser,
              // 수정 이력 — 메모가 입력된 경우에만 기록 (최신이 마지막)
              editLogs: form.editNote.trim()
                ? [...(p.editLogs ?? []), { at: today, by: currentUser, note: form.editNote.trim() }]
                : p.editLogs,
            }
          : p,
      );
    setProducts(nextProducts);
    persistWith({ products: nextProducts }); // 수정 저장은 명시적 등록 — 즉시 영속화
    setEditCode(null);
  };

  /* ---------- 트리 렌더링 ---------- */
  const renderTree = (parentId: string | null, depth: number, onlyRoot?: string) => {
    const children = parentId === null && onlyRoot
      ? folders.filter((f) => f.id === onlyRoot)
      : folders.filter((f) => f.parentId === parentId);
    return children.map((f) => {
      const hasChildren = folders.some((c) => c.parentId === f.id);
      const isRoot = ROOT_IDS.includes(f.id);
      const open = !collapsedFolders.has(f.id);
      const internal = f.kind === 'internal';
      return (
        <li key={f.id}>
          <div
            data-fid={f.id}
            className={`tree-item${isRoot ? ' brand' : ''}${internal ? ' internal' : ''}${f.id === activeFolder ? ' active' : ''}${dropFolder === f.id ? (dropMode === 'into' ? ' drop-into' : ' drop-target') : ''}`}
            style={{ paddingLeft: 10 + depth * 16 }}
            role="button"
            tabIndex={0}
            draggable={!isRoot}
            onClick={() => setActiveFolder(f.id)}
            onDoubleClick={() => { if (!isRoot) startRename(f.id, f.name); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setActiveFolder(f.id);
              if (e.key === 'F2' && !isRoot) startRename(f.id, f.name);
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              dragFolder.current = f.id;
            }}
            onDragEnter={() => setDropFolder(f.id)}
            onDragOver={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              // 루트는 항상 하위로만 드롭. 그 외는 위쪽 1/3 = 앞 위치, 나머지 = 하위
              setDropMode(!isRoot && e.clientY - rect.top < rect.height / 3 ? 'before' : 'into');
              setDropFolder(f.id);
            }}
            onDragEnd={() => {
              dragFolder.current = null;
              setDropFolder(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFolder.current) reorderFolder(dragFolder.current, f.id, dropMode);
              dragFolder.current = null;
              setDropFolder(null);
            }}
          >
            {hasChildren ? (
              <button
                className={`tree-caret${open ? ' open' : ''}`}
                aria-label={open ? '접기' : '펼치기'}
                aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); toggleFolderOpen(f.id); }}
              >
                ›
              </button>
            ) : (
              <span className="tree-caret placeholder" aria-hidden="true" />
            )}
            {!isRoot && <span className="rail-grip folder-grip" aria-hidden="true">⠿</span>}
            {(() => { const rep = folderRepThumb(f.id); return (
              <span className="folder-thumb-wrap">
                <span className="folder-thumb" aria-hidden="true">
                  {rep ? <img src={rep} alt="" /> : <FolderIcon />}
                </span>
              </span>
            ); })()}
            {renamingFolder === f.id ? (
              <input
                className="inline-input tree-rename"
                autoFocus
                value={renameDraft}
                aria-label={`${f.name} 이름 변경`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingFolder(null);
                }}
              />
            ) : (
              <span className={`t${f.hidden ? ' folder-hidden' : ''}`}>{f.name}{f.hidden && <span className="folder-hidden-badge" title="설계 화면에서 숨김">숨김</span>}</span>
            )}
            <span className="count">{directCount.get(f.id) ?? 0}</span>
            <span className="tree-actions">
              <span className="tree-act folder-menu-btn" role="button"
                aria-label={`${f.name} 폴더 메뉴`} aria-haspopup="menu" title="폴더 메뉴"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMenuPos({ x: r.right, y: r.bottom });
                  setMenuFolder((m) => (m === f.id ? null : f.id));
                }}
              >⋯</span>
            </span>
            {menuFolder === f.id && createPortal(
              <div className="folder-menu" role="menu"
                style={{ position: 'fixed', top: menuPos.y + 4, left: Math.max(8, menuPos.x - 184) }}
                onClick={(e) => e.stopPropagation()}>
                {checked.size > 0 && (<>
                  <button role="menuitem" onClick={() => { copyCheckedTo(f.id); setMenuFolder(null); }}>＋ 선택 상품 추가(복사) <em>{checked.size}</em></button>
                  <button role="menuitem" onClick={() => { moveChecked(f.id); setMenuFolder(null); }}>↪ 선택 상품 이동 <em>{checked.size}</em></button>
                  <div className="folder-menu-div" />
                </>)}
                <button role="menuitem" onClick={() => { setAddingUnder(f.id); setNewName(''); setMenuFolder(null); }}>＋ 하위 폴더 추가</button>
                {!isRoot && <button role="menuitem" onClick={() => { startRename(f.id, f.name); setMenuFolder(null); }}>이름 변경</button>}
                <button role="menuitem" onClick={() => { thumbTargetRef.current = f.id; setMenuFolder(null); thumbInputRef.current?.click(); }}>썸네일 변경하기</button>
                <button role="menuitem" onClick={() => { resetFolderThumb(f.id); setMenuFolder(null); }}>썸네일 초기화하기</button>
                {!isRoot && (
                  <button role="menuitem" onClick={() => { toggleFolderHidden(f.id); setMenuFolder(null); }}>
                    {f.hidden ? '설계 화면 표시하기' : '설계 화면에서 숨기기'}
                  </button>
                )}
                {!isRoot && <>
                  <div className="folder-menu-div" />
                  <button role="menuitem" className="danger" disabled={hasChildren}
                    title={hasChildren ? '하위 폴더를 먼저 이동/삭제하세요' : undefined}
                    onClick={() => {
                      setMenuFolder(null);
                      if (hasChildren) return;
                      const cnt = products.filter((p) => p.folderId === f.id).length;
                      confirm({ message: <>‘{f.name}’ 폴더를 삭제할까요?<br />폴더 안 상품 {cnt}개는 상위 폴더로 이동합니다.</>, onConfirm: () => deleteFolder(f.id) });
                    }}>삭제</button>
                </>}
              </div>,
              document.body,
            )}
          </div>

          {addingUnder === f.id && (
            <div className="folder-new" style={{ marginLeft: 10 + (depth + 1) * 16 }}>
              <input
                autoFocus
                value={newName}
                placeholder="하위 폴더 이름"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFolder();
                  if (e.key === 'Escape') setAddingUnder(null);
                }}
              />
              <button className="btn-mini" onClick={createFolder}>생성</button>
            </div>
          )}

          {open && <ul className="tree">{renderTree(f.id, depth + 1)}</ul>}
        </li>
      );
    });
  };

  const sizeText = (p: Product) => (p.w || p.d || p.h ? `${p.w}×${p.d}×${p.h}` : '–');

  /** 속성 구분 통합 선택기: 배치형/설계형 모델링 + 텍스쳐 + 머터리얼 */
  const ATTR_OPTIONS = [
    { key: '배치형', label: '배치형 모델링', attr: '모델링' as AttrType, model: '배치형' as const },
    { key: '설계형', label: '설계형 모델링', attr: '모델링' as AttrType, model: '설계형' as const },
    { key: '텍스쳐', label: '텍스쳐', attr: '텍스쳐' as AttrType, model: null },
    { key: '머터리얼', label: '머터리얼', attr: '머터리얼' as AttrType, model: null },
  ];
  const currentAttrKey = form.attrType === '모델링' ? form.modelingType : form.attrType;
  const renderAttrSelector = () => (
    <div className="form-field span-2">
      <span>속성 구분 *<HelpTip text={FIELD_HINTS.attrType} /></span>
      <div className="seg" role="radiogroup" aria-label="속성 구분" style={{ flexWrap: 'wrap' }}>
        {ATTR_OPTIONS.map((o) => (
          <button
            key={o.key} role="radio" aria-checked={currentAttrKey === o.key}
            className={`seg-item${currentAttrKey === o.key ? ' active' : ''}`}
            onClick={() => setForm((f) => ({ ...f, attrType: o.attr, modelingType: o.model ?? '배치형' }))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  /** 상품군 + 상품 분류 조합별 운영정보 항목 (조합 매핑은 추후 정의) */
  const renderOperationInfo = () => {
    const spec = OPERATION_SPEC[`${form.productGroup}|${form.productKind}`] ?? OPERATION_SPEC[form.productGroup];
    if (!spec || spec.length === 0) {
      return (
        <p className="hint">
          {form.productGroup && form.productKind
            ? `‘${form.productGroup} · ${form.productKind}’ 조합의 운영 항목은 아직 정의되지 않았습니다.`
            : '상품군과 상품 구분을 선택하면 해당 조합의 운영 항목이 표시됩니다.'}
          {' '}(조합별 항목 정의 예정)
        </p>
      );
    }
    return (
      <div className="form-grid two-col">
        {spec.map((field) => (
          <label key={field.key} className="form-field">
            <span>{field.label}</span>
            <input
              className="inline-input full"
              value={form.opValues[field.key] ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => setForm((f) => ({ ...f, opValues: { ...f.opValues, [field.key]: e.target.value } }))}
            />
          </label>
        ))}
      </div>
    );
  };

  /** 운영 사이즈 — 축별 MIN/MAX/GAP. 범위·간격이 있으면 기본정보에서 단계 선택 가능 */
  const renderOpSize = () => {
    const setOp = (k: keyof ProductForm['opSize'], v: string) => setForm((f) => ({ ...f, opSize: { ...f.opSize, [k]: v } }));
    const axes: { label: string; min: keyof ProductForm['opSize']; max: keyof ProductForm['opSize']; gap: keyof ProductForm['opSize']; ax: 'W' | 'D' | 'H' }[] = [
      { label: 'W 폭', min: 'minW', max: 'maxW', gap: 'gapW', ax: 'W' },
      { label: 'D 깊이', min: 'minD', max: 'maxD', gap: 'gapD', ax: 'D' },
      { label: 'H 높이', min: 'minH', max: 'maxH', gap: 'gapH', ax: 'H' },
    ];
    const preview = formToOpSize(form.opSize);
    return (
      <div className="opsize">
        <div className="opsize-head"><span></span><span>MIN</span><span>MAX</span><span>GAP</span><span>선택값</span></div>
        {axes.map((a) => {
          const opts = opSizeOptions(preview, a.ax);
          const note = opts == null ? '미설정(자유 입력)' : opts.length > 1 ? opts.join(', ') : `고정 ${opts[0]}`;
          return (
            <div className="opsize-row" key={a.ax}>
              <span className="opsize-ax">{a.label}</span>
              <input type="number" min="0" placeholder="-" value={form.opSize[a.min]} aria-label={`${a.label} MIN`} onChange={(e) => setOp(a.min, e.target.value)} />
              <input type="number" min="0" placeholder="-" value={form.opSize[a.max]} aria-label={`${a.label} MAX`} onChange={(e) => setOp(a.max, e.target.value)} />
              <input type="number" min="0" placeholder="-" value={form.opSize[a.gap]} aria-label={`${a.label} GAP`} onChange={(e) => setOp(a.gap, e.target.value)} />
              <span className={`opsize-note${opts && opts.length > 1 ? ' on' : ''}`}>{note}</span>
            </div>
          );
        })}
        <p className="hint" style={{ margin: '6px 2px 0' }}>MIN·MAX·GAP을 입력하면 설계 기본정보에서 해당 범위를 GAP 간격으로 선택할 수 있습니다. MIN만(또는 MIN=MAX) 입력하면 고정값, 비워두면 자유 입력입니다.</p>
      </div>
    );
  };

  /** 구성/교체 — 부위 상품 교체 그룹 연결 (조립형 상품의 슬롯 구성) */
  const renderModelingSlots = () => {
    const setSlots = (next: ProductForm['modelingSlots']) => setForm((f) => ({ ...f, modelingSlots: next }));
    const swapMembers = expandMembers(swapState, folders, products as never);
    const memberProducts = (gid: string) =>
      (swapMembers[gid] ?? []).map((code) => products.find((p) => p.contentCode === code)).filter(Boolean) as Product[];
    // 탭(부위) = 구분 타이틀 — 컨텐츠 그룹 관리에서 그룹(교체 묶음·폴더 단위 노출)이 등록된 부위만 나열
    const cats = swapState.categories.filter((cat) => swapState.groups.some((g) => g.kind === cat));
    if (cats.length === 0) return <p className="hint"><b>컨텐츠 그룹 관리</b>에서 부위(탭)와 교체 묶음을 먼저 구성하세요.</p>;
    const groupLabel = (g: (typeof swapState.groups)[number]) => `${g.name}${g.type === 'grouping' ? ' — 폴더 노출' : ''}`;
    return (
      <div className="mslot-box">
        <p className="hint">부위(탭)별로 교체 묶음 또는 폴더 단위 노출 그룹을 연결하세요 — 연결한 부위만 설계 화면 구성 슬롯으로 동작합니다. (단일형 상품은 전부 미연결)</p>
        {cats.map((cat) => {
          const catGroups = swapState.groups.filter((g) => g.kind === cat);
          const si = form.modelingSlots.findIndex(
            (s) => (swapState.groups.find((g) => g.id === s.groupId)?.kind ?? s.slot) === cat,
          );
          const row = si >= 0 ? form.modelingSlots[si] : null;
          const members = row?.groupId ? memberProducts(row.groupId) : [];
          const rules = row?.rules ?? [];
          const setRules = (r: { condition: string; groupId: string }[]) => {
            if (si >= 0) setSlots(form.modelingSlots.map((s, j) => (j === si ? { ...s, rules: r } : s)));
          };
          return (
            <div className="mslot-block" key={cat}>
              <div className="mslot-row">
                <span className="mslot-slot">{cat}</span>
                <select className="inline-input" value={row?.groupId ?? ''}
                  onChange={(e) => {
                    const gid = e.target.value;
                    if (!gid) { if (si >= 0) setSlots(form.modelingSlots.filter((_, j) => j !== si)); return; }
                    if (si >= 0) setSlots(form.modelingSlots.map((s, j) => (j === si ? { ...s, groupId: gid, slot: cat, defaultModelingId: '' } : s)));
                    else setSlots([...form.modelingSlots, { slot: cat, groupId: gid, defaultModelingId: '' }]);
                  }}>
                  <option value="">미연결</option>
                  {catGroups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
                </select>
                <select className="inline-input" value={row?.defaultModelingId ?? ''} disabled={!row?.groupId}
                  onChange={(e) => { if (si >= 0) setSlots(form.modelingSlots.map((s, j) => (j === si ? { ...s, defaultModelingId: e.target.value } : s))); }}>
                  <option value="">기본 부위 상품</option>
                  {members.map((m) => <option key={m.contentCode} value={m.contentCode}>{m.name}</option>)}
                </select>
                <span className="mslot-cnt">{row ? `${members.length}개` : '—'}</span>
              </div>
              {/* 조건 분기 — 조건식이 참인 첫 규칙의 교체 묶음을 사용(예: 창높이별 손잡이). 연결된 부위만 */}
              {row && (
                <div className="mslot-rules">
                  {rules.map((r, ri) => (
                    <div className="mslot-rule" key={ri}>
                      <span className="mslot-rule-tag">조건</span>
                      <input className="inline-input" placeholder="예: #H <= 1200 (빈칸=그 외 기본)" value={r.condition}
                        onChange={(e) => setRules(rules.map((x, k) => (k === ri ? { ...x, condition: e.target.value } : x)))} />
                      <span className="mslot-rule-arrow">→</span>
                      <select className="inline-input" value={r.groupId}
                        onChange={(e) => setRules(rules.map((x, k) => (k === ri ? { ...x, groupId: e.target.value } : x)))}>
                        <option value="">그룹 선택</option>
                        {catGroups.map((g) => <option key={g.id} value={g.id}>{groupLabel(g)}</option>)}
                      </select>
                      <button className="order-btn" title="규칙 제거" onClick={() => setRules(rules.filter((_, k) => k !== ri))}><TrashIcon size={11} /></button>
                    </div>
                  ))}
                  <button className="link-mini" onClick={() => setRules([...rules, { condition: '', groupId: '' }])}>+ 조건 규칙</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  /** 스타일 그룹 — 스타일 그룹 관리의 스타일을 이 상품에 연결(선택 시 부위 일괄 교체 대상) */
  const renderStyleLinks = () => {
    const styles = swapState.styles ?? [];
    const folderNameOf = (fid: string) => folders.find((f) => f.id === fid)?.name ?? fid;
    if (styles.length === 0) return <p className="hint">등록된 스타일이 없습니다. <b>스타일 그룹 관리</b>에서 스타일을 만들면 여기서 연결할 수 있습니다.</p>;
    const toggle = (id: string) => setForm((f) => ({
      ...f,
      styleIds: f.styleIds.includes(id) ? f.styleIds.filter((x) => x !== id) : [...f.styleIds, id],
    }));
    return (
      <div className="filter-picker">
        {(swapState.styleCategories ?? [...new Set(styles.map((s) => s.kind ?? ''))]).map((cat) => {
          const catStyles = styles.filter((s) => (s.kind ?? '') === cat);
          if (catStyles.length === 0) return null;
          return (
            <div key={cat} className="filter-grp">
              <div className="filter-grp-head"><span className="filter-grp-name">🎨 {cat || '기본'}</span></div>
              <div className="filter-opts">
                {catStyles.map((s) => {
                  const on = form.styleIds.includes(s.id);
                  const comp = (s.folders ?? []).map(folderNameOf).join(' + ');
                  return (
                    <button key={s.id} type="button" className={`filter-opt${on ? ' on' : ''}`} aria-pressed={on}
                      title={comp || '구성 없음'} onClick={() => toggle(s.id)}>
                      {on && <span className="filter-opt-chk">✓</span>}{s.name}
                      {comp && <small style={{ opacity: 0.75, marginLeft: 4 }}>({comp})</small>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  /** 상품구분·모델 관리에서 연동되는 읽기전용 필터 그룹 */
  const derivedFilterGroups: FilterGroup[] = (() => {
    const kinds = [...new Set(Object.values(kindsByGroup).flat())];
    const models = [...new Set(Object.values(modelsByGroup).flat())];
    return [
      { id: 'fg-kind', name: '상품 구분', options: kinds.map((k) => ({ id: `fo-kind-${k}`, name: k })) },
      { id: 'fg-model', name: '모델 구분', options: models.map((m) => ({ id: `fo-model-${m}`, name: m })) },
    ];
  })();
  /** 필터 선택기에서 쓰는 전체 그룹 = 연동 그룹 + 사용자 정의 그룹 */
  const pickerGroups: FilterGroup[] = [...derivedFilterGroups, ...filterGroups];

  const filterLabel = (optionId: string) => {
    for (const g of pickerGroups) { const o = g.options.find((x) => x.id === optionId); if (o) return `${g.name}: ${o.name}`; }
    return optionId;
  };
  const openFilterModal = () => { setFilterDraft([...form.filterValues]); setFilterModalOpen(true); };
  const toggleDraft = (id: string) => setFilterDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const saveFilterModal = () => { setForm((f) => ({ ...f, filterValues: filterDraft })); setFilterModalOpen(false); };

  /** 필터 — 요약 칩 + ‘필터 추가/편집’ 버튼(팝업), 모달에서 다중선택 후 저장 */
  const renderFilterPicker = () => {
    const selected = form.filterValues;
    const draftSet = new Set(filterDraft);
    return (
      <div className="filter-picker">
        <div className="check-list" style={{ gap: 8, alignItems: 'center' }}>
          {selected.length === 0 && <span className="hint">선택된 필터가 없습니다.</span>}
          {selected.map((oid) => (
            <span key={oid} className="tag removable">{filterLabel(oid)}
              <button className="tag-x" aria-label={`${filterLabel(oid)} 제거`} onClick={() => toggleFilterValue(oid)}>×</button>
            </span>
          ))}
          <button type="button" className="btn-ghost" style={{ marginLeft: selected.length ? 4 : 0 }} onClick={openFilterModal}>
            + 필터 {selected.length ? '편집' : '추가'}
          </button>
        </div>

        {filterModalOpen && (
          <div className="modal-backdrop" onClick={() => setFilterModalOpen(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="필터 선택" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
              <h2 className="modal-title">필터 선택</h2>
              <p className="hint" style={{ margin: '0 0 12px' }}>옵션을 눌러 다중 선택하세요. 선택된 항목은 표시되며, <b>저장</b> 시 반영됩니다.</p>
              {pickerGroups.length === 0 ? (
                <p className="hint">등록된 필터 그룹이 없습니다. ‘필터 관리’에서 추가하세요.</p>
              ) : (
                <div className="filter-picker" style={{ maxHeight: '56vh', overflow: 'auto' }}>
                  {pickerGroups.map((g) => {
                    const onCount = g.options.filter((o) => draftSet.has(o.id)).length;
                    return (
                      <div key={g.id} className="filter-grp">
                        <div className="filter-grp-head">
                          <span className="filter-grp-name">{g.name}</span>
                          {onCount > 0 && <span className="filter-grp-cnt">{onCount}</span>}
                        </div>
                        <div className="filter-opts">
                          {g.options.length === 0 && <span className="hint">옵션 없음</span>}
                          {g.options.map((o) => {
                            const on = draftSet.has(o.id);
                            return (
                              <button key={o.id} type="button" className={`filter-opt${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleDraft(o.id)}>
                                {on && <span className="filter-opt-chk">✓</span>}{o.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="modal-actions">
                <span className="hint" style={{ marginRight: 'auto' }}>{filterDraft.length}개 선택</span>
                <button className="btn-ghost" onClick={() => setFilterModalOpen(false)}>취소</button>
                <button className="btn-primary" style={{ marginLeft: 0 }} onClick={saveFilterModal}>저장</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---------- 편집 진입 화면 ---------- */
  // 하위메뉴(관리 패널)가 활성이면 편집 화면 대신 목록+관리 모달을 우선 표시 → 상세에서도 메뉴 사용 가능
  const editing = editCode && panel === 'list' ? products.find((p) => p.contentCode === editCode) : null;
  if (editing) {
    return (
      <main className="main">
        <div className="page-head">
          <button className="btn-ghost" onClick={() => setEditCode(null)}>‹ 상품 목록</button>
          <h1>{editing.name}</h1>
          <span className={`tag type-${editing.attrType}`} style={{ marginBottom: 7 }}>{editing.attrType}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setEditCode(null)}>나가기</button>
          <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!form.name.trim()} onClick={saveEdit}>저장</button>
        </div>

        <div className="edit-layout">
          {/* 썸네일 이미지 */}
          <section className="panel thumb-panel">
            <div className="panel-head"><h2>썸네일 이미지</h2></div>
            <div
              className={`edit-thumb${form.thumbUrl ? '' : editing.thumb ? ` ${editing.thumb}` : ' none'}`}
              role="img"
              aria-label={form.thumbUrl || editing.thumb ? `${editing.name} 썸네일 (400×400)` : '썸네일 이미지 없음'}
              style={form.thumbUrl ? { backgroundImage: `url(${form.thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              {!editing.thumb && !form.thumbUrl && (
                <span className="edit-thumb-empty">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                  </svg>
                  이미지 없음
                </span>
              )}
              <span className="edit-thumb-size">400 × 400</span>
            </div>
            <input
              ref={thumbFileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onThumbFile}
            />
            <button
              className="btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => thumbFileRef.current?.click()}
            >
              이미지 교체
            </button>
            {form.thumbUrl && (
              <button
                className="btn-ghost"
                style={{ width: '100%', marginTop: 6 }}
                onClick={() => setForm((f) => ({ ...f, thumbUrl: undefined }))}
              >
                이미지 제거
              </button>
            )}

            {/* 업로드 에셋 — 공통 업로드, 확장자 자동 인식 + three.js 미리보기 */}
            <div className="asset-list">
              <div className="asset-list-title" style={{ marginTop: 16 }}>업로드 에셋</div>
              <div className="asset-box">
                <AssetViewer asset={pendingAsset ?? form.assets.find((a) => a.id === previewAssetId) ?? form.assets[0] ?? null} />
              </div>
              {pendingAsset && (
                <div className="asset-pending">업로드 대기: <b>{pendingAsset.name}</b> <span className={`asset-type t-${pendingAsset.type}`}>{pendingAsset.type}</span> — 등록을 눌러 확정하세요.</div>
              )}
              {form.assets.length > 0 && (
                <ul className="asset-items" style={{ marginTop: 8 }}>
                  {form.assets.map((a) => {
                    const sel = (previewAssetId ?? form.assets[0]?.id) === a.id;
                    return (
                      <li key={a.id} className={`asset-item${sel ? ' selected' : ''}`} onClick={() => setPreviewAssetId(a.id)}>
                        <span className={`asset-type t-${a.type}`}>{a.type}</span>
                        <span className="asset-name">{a.name}</span>
                        <button
                          className="asset-btn danger"
                          aria-label={`${a.name} 제거`}
                          onClick={(e) => { e.stopPropagation(); removeAsset(a.id); }}
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <input ref={assetRef} type="file" hidden onChange={onAssetUpload} />
              <div className="asset-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-ghost" style={{ flex: 1 }} disabled={assetBusy} onClick={() => assetRef.current?.click()}>{assetBusy ? '변환 중…' : '에셋 업로드'}</button>
                <button className="btn-primary" disabled={!pendingAsset} onClick={commitAsset}>등록</button>
                <button className="btn-ghost" disabled={!pendingAsset} onClick={cancelAsset}>취소</button>
              </div>
              {assetMsg && <p className="hint" style={{ margin: '6px 2px', color: assetMsg.startsWith('✓') ? 'var(--ink)' : '#c0392b' }}>{assetMsg}</p>}
            </div>
          </section>

          {/* 기본 정보 */}
          <section className="panel">
            <div className="panel-head"><h2>기본 정보</h2></div>
            <div className="form-grid two-col">
              <label className="form-field span-2">
                <span>상품명 *<HelpTip text={FIELD_HINTS.name} /></span>
                <input className="inline-input full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              {/* 수정 이력 — 이번 수정 내용을 기록으로 남긴다 (저장 시 일시/수정자와 함께 누적) */}
              <label className="form-field span-2">
                <span>수정 내용 (이력 기록)</span>
                <input
                  className="inline-input full"
                  placeholder="이번 수정의 변경 내용을 입력 — 저장 시 이력에 남습니다"
                  value={form.editNote}
                  onChange={(e) => setForm((f) => ({ ...f, editNote: e.target.value }))}
                />
              </label>
              {editing && (editing.editLogs?.length ?? 0) > 0 && (
                <div className="form-field span-2" style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>수정 이력 · {editing.editLogs!.length}건</span>
                  {[...editing.editLogs!].reverse().map((l, i) => (
                    <div key={i} style={{ fontSize: 12, lineHeight: 1.7, display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{l.at}</span>
                      <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{l.by}</span>
                      <span style={{ flex: 1 }}>{l.note}</span>
                    </div>
                  ))}
                </div>
              )}
              <label className="form-field">
                <span>브랜드<HelpTip text={FIELD_HINTS.brand} /></span>
                <input className="inline-input full" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>견적그룹 *<HelpTip text={FIELD_HINTS.quoteGroup} /></span>
                <select className="inline-input full" value={form.quoteGroup} onChange={(e) => setForm((f) => ({ ...f, quoteGroup: e.target.value }))}>
                  <option value="">선택</option>
                  {(() => {
                    const opts = [...(quoteGroups[form.productGroup] ?? []), ...(quoteGroups[QUOTE_COMMON_KEY] ?? [])];
                    if (form.quoteGroup && !opts.some((q) => q.name === form.quoteGroup)) opts.push({ name: form.quoteGroup, desc: '' });
                    return opts.map((q) => <option key={q.name} value={q.name}>{q.desc ? `${q.name} — ${q.desc}` : q.name}</option>);
                  })()}
                </select>
              </label>
              <label className="form-field">
                <span>상품군 *<HelpTip text={FIELD_HINTS.productGroup} /></span>
                <select
                  className="inline-input full"
                  value={form.productGroup}
                  onChange={(e) => {
                    const g = e.target.value;
                    setForm((f) => ({
                      ...f,
                      productGroup: g,
                      // 상품군이 바뀌면 그 상품군에 없는 상품구분/모델은 초기화
                      productKind: (kindsByGroup[g] ?? []).includes(f.productKind) ? f.productKind : '',
                      modelKind: (modelsByGroup[g] ?? []).includes(f.modelKind) ? f.modelKind : '',
                    }));
                  }}
                >
                  {productGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>상품 구분 *<HelpTip text={FIELD_HINTS.productKind} /></span>
                <select
                  className="inline-input full"
                  value={form.productKind}
                  onChange={(e) => setForm((f) => ({ ...f, productKind: e.target.value }))}
                >
                  <option value="">{form.productGroup ? '품목 선택' : '상품군을 먼저 선택'}</option>
                  {(kindsByGroup[form.productGroup] ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>모델 구분 <HelpTip text={FIELD_HINTS.modelKind} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(모델 구분 관리 등록)</small></span>
                <select className="inline-input full" value={form.modelKind}
                  onChange={(e) => setForm((f) => ({ ...f, modelKind: e.target.value }))}>
                  <option value="">{form.productGroup ? (modelsByGroup[form.productGroup] ?? []).length ? '모델 선택' : '모델 관리에서 등록 필요' : '상품군을 먼저 선택'}</option>
                  {(modelsByGroup[form.productGroup] ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <div className="span-2 code-pair-grid">
                <label className="form-field">
                  <span>컨텐츠 코드 <HelpTip text={FIELD_HINTS.contentCode} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>{fieldEditable('contentCode') ? '(키코드)' : '(수정 불가)'}</small></span>
                  <input className="inline-input full" value={form.contentCode} disabled={!fieldEditable('contentCode')}
                    onChange={(e) => setForm((f) => ({ ...f, contentCode: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span>상품코드 <HelpTip text={FIELD_HINTS.productCode} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>{fieldEditable('productCode') ? '' : '(수정 불가)'}</small></span>
                  <input className="inline-input full" value={form.productCode} disabled={!fieldEditable('productCode')}
                    onChange={(e) => setForm((f) => ({ ...f, productCode: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span>모델코드<HelpTip text={FIELD_HINTS.modelCode} /></span>
                  <input className="inline-input full" value={form.modelCode} placeholder="모델 식별 코드"
                    onChange={(e) => setForm((f) => ({ ...f, modelCode: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span>품목코드<HelpTip text={FIELD_HINTS.itemCode} /></span>
                  <input className="inline-input full" value={form.itemCode} placeholder="품목 식별 코드"
                    onChange={(e) => setForm((f) => ({ ...f, itemCode: e.target.value }))} />
                </label>
              </div>
              <label className="form-field">
                <span>사용자 그룹 <HelpTip text={FIELD_HINTS.permission} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(이 그룹 사용자에게 노출)</small></span>
                <select className="inline-input full" value={editPermission} onChange={(e) => setEditPermission(e.target.value)}>
                  <option value="전체">전체</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>가격 (원)<HelpTip text={FIELD_HINTS.price} /></span>
                <input className="inline-input full" type="number" value={form.price}
                  placeholder="0" onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
              </label>
              {/* 속성 구분 */}
              <div className="form-field span-2">
                <span>속성 구분 *<HelpTip text={FIELD_HINTS.attrType} /></span>
                <div className="seg" role="radiogroup" aria-label="속성 구분" style={{ flexWrap: 'wrap' }}>
                  {ATTR_OPTIONS.map((o) => (
                    <button
                      key={o.key} role="radio" aria-checked={currentAttrKey === o.key}
                      className={`seg-item${currentAttrKey === o.key ? ' active' : ''}`}
                      onClick={() => setForm((f) => ({ ...f, attrType: o.attr, modelingType: o.model ?? '배치형' }))}
                    >{o.label}</button>
                  ))}
                </div>
              </div>

              {/* 규격유무 + 노출여부 (같은 줄) */}
              <div className="form-field span-2">
                <div className="attr-visible-row">
                  <div style={{ flex: 1 }}>
                    <span>규격유무<HelpTip text={FIELD_HINTS.nonStandard} /></span>
                    <div className="seg" role="radiogroup" aria-label="규격유무">
                      <button role="radio" aria-checked={!form.nonStandard}
                        className={`seg-item${!form.nonStandard ? ' active' : ''}`}
                        onClick={() => setForm((f) => ({ ...f, nonStandard: false }))}>규격</button>
                      <button role="radio" aria-checked={form.nonStandard}
                        className={`seg-item${form.nonStandard ? ' active' : ''}`}
                        onClick={() => setForm((f) => ({ ...f, nonStandard: true }))}>비규격</button>
                    </div>
                  </div>
                  <div className="visible-toggle">
                    <span>노출여부</span>
                    <button
                      className={`switch${editVisible ? ' on' : ''}`}
                      role="switch" aria-checked={editVisible} aria-label="노출여부"
                      onClick={() => setEditVisible((v) => !v)}
                    />
                  </div>
                </div>
              </div>

              <div className="form-field span-2">
                <span>컨텐츠 크기 (mm) <HelpTip text={FIELD_HINTS.size} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(기본은 모델링 사이즈, 직접 입력 가능)</small></span>
                <div className="size-row">
                  <label className="size-cell"><span>W 폭<HelpTip text={FIELD_HINTS.w} /></span><input type="number" min="0" placeholder="0" value={form.w} aria-label="폭 W" onChange={(e) => setForm((f) => ({ ...f, w: e.target.value }))} /></label>
                  <label className="size-cell"><span>D 깊이<HelpTip text={FIELD_HINTS.d} /></span><input type="number" min="0" placeholder="0" value={form.d} aria-label="깊이 D" onChange={(e) => setForm((f) => ({ ...f, d: e.target.value }))} /></label>
                  <label className="size-cell"><span>H 높이<HelpTip text={FIELD_HINTS.h} /></span><input type="number" min="0" placeholder="0" value={form.h} aria-label="높이 H" onChange={(e) => setForm((f) => ({ ...f, h: e.target.value }))} /></label>
                </div>
              </div>
              <label className="form-field">
                <span>배치 위치<HelpTip text={FIELD_HINTS.placement} /></span>
                <select className="inline-input full" value={form.placement} onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value as ProductForm['placement'] }))}>
                  <option value="바닥">바닥</option>
                  <option value="벽">벽</option>
                  <option value="천장">천장</option>
                </select>
              </label>
              <label className="form-field">
                <span>배치 높이 (mm)<HelpTip text={FIELD_HINTS.placeHeight} /></span>
                <input className="inline-input full" type="number" min="0" value={form.placeHeight} placeholder="바닥배치 기본 0" onChange={(e) => setForm((f) => ({ ...f, placeHeight: e.target.value }))} />
              </label>

              {renderUrlList('specUrls', '스펙 URL')}
              {renderUrlList('mallUrls', 'mall URL')}
            </div>

            {/* 필터 분류 */}
            <div className="panel-head" style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: '0.92rem' }}>필터</h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>필터 추가로 분류</span>
            </div>
            {renderFilterPicker()}
          </section>

          {/* 컨텐츠 운영정보 — 설계형 모델링에서만 노출 (배치형은 기본정보만). 내용은 상품 구분별로 다름 */}
          {form.attrType === '모델링' && form.modelingType === '설계형' && (
          <section className="panel">
            <div className="panel-head">
              <h2>컨텐츠 운영정보</h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>
                {form.productGroup || '상품군'} · {form.productKind || '상품 구분'} 기준
              </span>
            </div>

            {/* 운영 사이즈 — MIN·MAX·GAP 선택형 사이즈 (비규격이면 명칭 변경) */}
            <div className="panel-head" style={{ marginTop: 4 }}>
              <h2 style={{ fontSize: '0.92rem' }}>{form.nonStandard ? '비규격 사이즈' : '운영 사이즈'}<HelpTip text={FIELD_HINTS.opSize} /></h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>MIN·MAX·GAP — 기본정보 사이즈 선택 범위</span>
            </div>
            {renderOpSize()}

            {/* 사용자 정의 변수 — 유형(고정값/수식/조건식) + 설계 노출 여부 */}
            <div className="panel-head" style={{ marginTop: 14 }}>
              <h2 style={{ fontSize: '0.92rem' }}>변수 정의<HelpTip text={FIELD_HINTS.vars} /></h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>#이름 참조 · 이름 W/D/H '수식' = 내보내기 치수 · '조건식'은 모두 TRUE일 때만 배치 · 노출☑ = 설계 화면에 표시</span>
              <button className="btn-mini" style={{ marginLeft: 'auto' }}
                onClick={() => setForm((f) => ({ ...f, vars: [...f.vars, { name: '', value: '', type: '고정값' as VarType }] }))}>+ 변수</button>
            </div>
            <div className="form-grid">
              {form.vars.length === 0 && <p className="hint">필요하면 변수를 추가하세요. 예) 이름 <b>LDH</b>, 유형 <b>고정값</b>, 값 <b>20</b> → 수식에서 <b>#LDH</b> · 도어 치수는 이름 <b>W</b>/<b>H</b>의 수식 변수로.</p>}
              {form.vars.map((v, i) => (
                <div key={i} className="opsize-row" style={{ gridTemplateColumns: '1fr 92px 1.6fr 52px 28px' }}>
                  <input type="text" placeholder="이름 (예: LDH, W)" value={v.name}
                    title={`수식에서 #${v.name.trim() || '이름'} 으로 참조`}
                    onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
                  <select value={varTypeOf(v)} aria-label="값 유형"
                    onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, type: e.target.value as VarType } : x) }))}>
                    {VAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="text" value={v.value}
                    placeholder={varTypeOf(v) === '고정값' ? '숫자 (예: 20)' : varTypeOf(v) === '조건식' ? '예: #LDH >= 20' : '식 (예: #H - #LDH)'}
                    onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} />
                  <label className="visible-toggle" title="설계 화면(모델링 선택 시)에 이 변수 노출" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                    <input type="checkbox" checked={!!v.expose}
                      onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, expose: e.target.checked } : x) }))} />노출
                  </label>
                  <button className="order-btn" title="변수 삭제" onClick={() => setForm((f) => ({ ...f, vars: f.vars.filter((_, j) => j !== i) }))}><TrashIcon size={12} /></button>
                </div>
              ))}
            </div>

            <div className="panel-head" style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: '0.92rem' }}>운영 항목</h2>
            </div>
            {renderOperationInfo()}

            {/* 구성/교체 — 모델링 교체 그룹 연결 */}
            <div className="panel-head" style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: '0.92rem' }}>구성/교체 (모델링 그룹)</h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>부위별 교체 그룹 연결</span>
            </div>
            {renderModelingSlots()}

            {/* 스타일 그룹 — 스타일 그룹 관리 연동 */}
            <div className="panel-head" style={{ marginTop: 18 }}>
              <h2 style={{ fontSize: '0.92rem' }}>스타일 그룹</h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>스타일 그룹 관리의 스타일 연결 — 선택 시 부위 일괄 교체</span>
            </div>
            {renderStyleLinks()}
            <p className="hint" style={{ marginTop: 12 }}>최종 수정: {editing.updatedAt} · {editing.updatedBy}</p>
          </section>
          )}

        </div>
      </main>
    );
  }


  return (
    <main className="main products-main">
      {/* 폴더 ⋯ 메뉴 공용 — 썸네일 파일 입력 + 외부 클릭 닫기 */}
      <input ref={thumbInputRef} type="file" accept="image/*" hidden
        onChange={(e) => { const file = e.target.files?.[0]; const id = thumbTargetRef.current; if (file && id) setFolderThumb(id, file); e.currentTarget.value = ''; thumbTargetRef.current = null; }} />
      {menuFolder && <div className="folder-menu-backdrop" onClick={() => setMenuFolder(null)} />}
      {bulkOpen && (
        <div className="modal-backdrop" onClick={() => setBulkOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="모델링 일괄등록" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
            <h2 className="modal-title">모델링 일괄등록</h2>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              모델링 파일을 최대 <b>{BULK_MAX}개</b>까지 올리고 각 <b>상품명</b>을 입력하세요. 등록 시 선택 폴더(<b>{folders.find((f) => f.id === activeFolder)?.name ?? '미분류'}</b>)에 신규 컨텐츠로 생성되고 <b>컨텐츠코드는 자동 생성</b>됩니다.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label className={`btn-ghost${bulkItems.length >= BULK_MAX ? ' disabled' : ''}`} style={{ display: 'inline-block', cursor: 'pointer' }}>
                + 모델 파일 선택 ({bulkItems.length}/{BULK_MAX})
                <input type="file" multiple accept=".glb,.gltf,.obj,.fbx,.bundle,.assetbundle" hidden
                  disabled={bulkItems.length >= BULK_MAX}
                  onChange={(e) => { onBulkFiles(e.target.files); e.currentTarget.value = ''; }} />
              </label>
              {bulkItems.length > 0 && <button className="btn-ghost" onClick={() => setBulkItems([])}>전체 비우기</button>}
            </div>

            {bulkItems.length > 0 && (
              <div className="bulk-grid">
                {bulkItems.map((it, i) => (
                  <div key={`${it.fileName}-${i}`} className="bulk-card">
                    <div className="bulk-prev"><AssetViewer asset={{ id: String(i), name: it.fileName, type: '모델링', url: it.dataUrl }} /></div>
                    <input className="inline-input full" value={it.name} placeholder="상품명 입력"
                      onChange={(e) => setBulkItems((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <div className="bulk-card-foot">
                      <span className="bulk-fname" title={it.fileName}>{it.fileName}</span>
                      <button className="tag-x" aria-label="제거" onClick={() => setBulkItems((prev) => prev.filter((_, j) => j !== i))}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <span className="hint" style={{ marginRight: 'auto' }}>상품명 입력 {bulkItems.filter((it) => it.name.trim()).length} / {bulkItems.length}</span>
              <button className="btn-ghost" onClick={() => setBulkOpen(false)}>취소</button>
              <button className="btn-primary" style={{ marginLeft: 0 }}
                disabled={bulkItems.filter((it) => it.name.trim()).length === 0}
                onClick={applyBulkModeling}>
                등록 ({bulkItems.filter((it) => it.name.trim()).length})
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="page-head">
        <h1>상품 관리</h1>
        <span className="date">전체 {products.length.toLocaleString()}개 컨텐츠</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && <span className="dirty-badge" title="저장되지 않은 변경사항">● 미저장 변경</span>}
          <button className="btn-ghost" title="삭제 되돌리기 (Ctrl+Z, 최대 10회)" disabled={undoRef.current.length === 0} onClick={undo}>↶ 되돌리기</button>
          <button className="btn-ghost" title="다시하기 (Ctrl+Shift+Z, 최대 10회)" disabled={redoRef.current.length === 0} onClick={redo}>↷ 다시하기</button>
          <button className="btn-primary" onClick={() => { setForm({ ...EMPTY_PRODUCT_FORM, folderId: activeFolder }); setPendingAsset(null); setPreviewAssetId(null); setShowRegister(true); }}>
            + 상품 등록
          </button>
          <button className="btn-ghost" title="여러 모델링 파일을 한 번에 상품에 매칭·등록" onClick={() => { setBulkItems([]); setBulkOpen(true); }}>
            모델링 일괄등록
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn-ghost" aria-haspopup="menu" title="기본정보 엑셀 다운로드·업로드" onClick={() => setCiOpen((v) => !v)}>
              컨텐츠정보 ▾
            </button>
            {ciOpen && (<>
              <div className="folder-menu-backdrop" onClick={() => setCiOpen(false)} />
              <div className="folder-menu" role="menu" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
                <button role="menuitem" onClick={() => { downloadExcelTemplate(); setCiOpen(false); }}>⬇ 다운로드 (엑셀 양식)</button>
                <button role="menuitem" onClick={() => { excelInputRef.current?.click(); }}>⬆ 업로드 (작성 엑셀 반영)</button>
                <input ref={excelInputRef} type="file" accept=".csv,text/csv" hidden
                  onChange={(e) => { onExcelUpload(e.target.files?.[0] ?? null); e.currentTarget.value = ''; setCiOpen(false); }} />
              </div>
            </>)}
          </div>
          <button className="btn-ghost" disabled={checked.size === 0}
            title={checked.size > 0 ? `선택한 ${checked.size}개 상품을 복사` : '복사할 상품을 체크하세요'}
            onClick={copySelected}>
            복사{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
          <button className="btn-primary" disabled={!dirty} onClick={saveAll}>
            저장
          </button>
        </div>
      </div>
      {confirmDialog}

      <div className="products-layout" style={{ gridTemplateColumns: `${folderWidth}px 6px 1fr` }}>
        {/* ---- 폴더 패널 (카테고리 설정 + 노출/비노출 2섹션) ---- */}
        <section className="panel folder-panel">
          {/* 상단 고정: 카테고리 설정 + 새 폴더 추가 (같은 줄) */}
          <div className="folder-cat-bar">
            <h2>카테고리 설정</h2>
            <button
              className="folder-add-btn"
              style={{ marginLeft: 'auto' }}
              title={activeFolderName ? `'${activeFolderName}' 하위에 새 폴더` : '미분류 하위에 새 폴더'}
              onClick={() => { setAddingUnder('root'); setNewName(''); }}
            >
              + 새 폴더
            </button>
          </div>
          {addingUnder === 'root' && (
            <div className="folder-new" style={{ margin: '8px 0' }}>
              <input
                autoFocus
                value={newName}
                placeholder={activeFolderName ? `'${activeFolderName}' 하위 폴더 이름` : '폴더 이름'}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createFolder();
                  if (e.key === 'Escape') setAddingUnder(null);
                }}
              />
              <button className="btn-mini" onClick={createFolder}>생성</button>
              <button className="btn-mini ghost" onClick={() => setAddingUnder(null)}>완료</button>
            </div>
          )}

          <div className="folder-sec-head">
            <h2>노출 폴더</h2>
            <span className="sel-info" style={{ marginLeft: 8 }}>설계 노출</span>
          </div>
          <ul className="tree">{renderTree(null, 0, ROOT_FOLDER_ID)}</ul>

          <div className="folder-sec-head int">
            <h2>비노출 폴더</h2>
            <span className="sel-info" style={{ marginLeft: 8 }}>부위 보관 · 그룹으로만 노출</span>
          </div>
          <ul className="tree">{renderTree(null, 0, INT_ROOT_ID)}</ul>
        </section>

        {/* ---- 너비 조절 핸들 ---- */}
        <div
          className="col-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="폴더 패널 너비 조절"
          onMouseDown={startResize}
        />

        {/* ---- 상품 패널 ---- */}
        <section className="panel product-panel">
          <div className="product-toolbar">
            <label className="search inset">
              <SearchIcon />
              <input
                type="search"
                placeholder="상품명, 컨텐츠 코드, 상품코드 검색"
                aria-label="상품 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="seg" role="tablist" aria-label="속성 구분 필터">
              <button
                role="tab"
                aria-selected={typeFilter === 'all'}
                className={`seg-item${typeFilter === 'all' ? ' active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                전체
              </button>
              {(['배치형', '설계형', '텍스쳐', '머터리얼'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={typeFilter === t}
                  className={`seg-item${typeFilter === t ? ' active' : ''}`}
                  onClick={() => setTypeFilter(t)}
                >
                  {t === '배치형' || t === '설계형' ? `${t} 모델링` : t} {typeCount.get(t) ?? 0}
                </button>
              ))}
            </div>
            <span className="sel-info" style={{ marginLeft: 'auto' }}>
              {checked.size > 0 ? `${checked.size}개 선택됨` : `${visible.length}개 컨텐츠`}
            </span>
            <div className="toolbar-actions" style={{ marginLeft: 0 }}>
              <select
                className="btn-ghost"
                aria-label="선택 상품을 폴더로 이동"
                disabled={checked.size === 0}
                value=""
                onChange={(e) => moveChecked(e.target.value)}
              >
                <option value="" disabled>폴더로 이동</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <button className="btn-ghost danger" disabled={checked.size === 0}
                onClick={() => confirm({ message: <>선택한 상품 {checked.size}개를 삭제할까요?</>, onConfirm: deleteChecked })}>
                삭제
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th className="w-check">
                  <input type="checkbox" aria-label="전체 선택" checked={allChecked} onChange={toggleAll} />
                </th>
                <ThSort label="상품명" k="name" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="브랜드" k="brand" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="상품군" k="productGroup" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="모델" k="modelKind" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="품목구분" k="productKind" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="견적그룹" k="quoteGroup" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="컨텐츠코드" k="contentCode" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="상품코드" k="productCode" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <th>노출여부</th>
                <ThSort label="배치위치" k="placement" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="사이즈" k="size" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="속성구분" k="attrType" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="수정일자" k="updatedAt" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <th style={{ width: 76 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((p) => (
                <tr key={p.contentCode}>
                  <td className="w-check">
                    <input
                      type="checkbox"
                      aria-label={`${p.name} 선택`}
                      checked={checked.has(p.contentCode)}
                      onChange={() => toggleOne(p.contentCode)}
                    />
                  </td>
                  <td>
                    <span
                      className={`thumb ${p.thumb}`.trim()}
                      style={p.thumbUrl ? { backgroundImage: `url(${p.thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    />
                    {p.name}
                    {p.permission !== '전체' && <span className="tag" style={{ marginLeft: 6 }}>{permissionName(p.permission)}</span>}
                  </td>
                  <td>{p.brand}</td>
                  <td>{p.productGroup}</td>
                  <td>{p.modelKind || <span style={{ color: 'var(--text-3)' }}>–</span>}</td>
                  <td>{p.productKind}</td>
                  <td>{p.quoteGroup}</td>
                  <td className="num">{p.contentCode}</td>
                  <td className="num">{p.productCode}</td>
                  <td>
                    <button
                      className={`switch${p.visible ? ' on' : ''}`}
                      role="switch"
                      aria-checked={p.visible}
                      aria-label={`${p.name} 노출여부`}
                      onClick={() => toggleVisible(p.contentCode)}
                    />
                  </td>
                  <td>{p.placement}{p.placeHeight > 0 ? ` (${p.placeHeight})` : ''}</td>
                  <td className="num">{sizeText(p)}</td>
                  <td>
                    <span className={`tag type-${p.attrType}`}>
                      {p.attrType === '모델링' ? `${p.modelingType ?? '배치형'} 모델링` : p.attrType}
                    </span>
                  </td>
                  <td className="num">{p.updatedAt}</td>
                  <td>
                    <span className="row-actions">
                      <button className="order-btn" aria-label={`${p.name} 수정`} title="수정" onClick={() => openEdit(p)}>
                        <PencilIcon size={12} />
                      </button>
                      <button
                        className="order-btn"
                        aria-label={`${p.name} 삭제`}
                        title="삭제"
                        onClick={() => { const next = products.filter((x) => x.contentCode !== p.contentCode); setProducts(next); persistWith({ products: next }); }}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={15} className="empty-row">
                    조건에 맞는 컨텐츠가 없습니다. 상단의 <b>+ 상품 등록</b>으로 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {sort.sorted.length > 0 && (
            <Pagination
              page={pg.page}
              pageCount={pg.pageCount}
              pageSize={pg.pageSize}
              total={sort.sorted.length}
              onPage={pg.setPage}
              onPageSize={pg.setPageSize}
            />
          )}
        </section>
      </div>

      {/* ---- 상품 등록 모달 ---- */}
      {showRegister && (
        <div className="modal-backdrop" onClick={() => setShowRegister(false)}>
          <div className={`modal field-manager${form.attrType === '모델링' && form.modelingType === '설계형' ? ' with-opinfo' : ''}`} role="dialog" aria-modal="true" aria-label="상품 등록" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">상품 등록</h2>

            <div className="reg-layout">
            {/* 왼쪽: 썸네일 · 에셋 (디테일과 동일) */}
            <div className="reg-media">
              <div className="reg-media-col">
                <span className="asset-list-title">썸네일 이미지</span>
                <div
                  className={`edit-thumb${form.thumbUrl ? '' : ' none'}`}
                  role="img"
                  aria-label={form.thumbUrl ? '썸네일 (400×400)' : '썸네일 이미지 없음'}
                  style={form.thumbUrl ? { backgroundImage: `url(${form.thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  {!form.thumbUrl && (
                    <span className="edit-thumb-empty">
                      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                      이미지 없음
                    </span>
                  )}
                  <span className="edit-thumb-size">400 × 400</span>
                </div>
                <input ref={thumbFileRef} type="file" accept="image/*" hidden onChange={onThumbFile} />
                <button className="btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => thumbFileRef.current?.click()}>이미지 교체</button>
                {form.thumbUrl && (
                  <button className="btn-ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setForm((f) => ({ ...f, thumbUrl: undefined }))}>이미지 제거</button>
                )}
              </div>
              <div className="reg-media-col">
                <span className="asset-list-title">업로드 에셋</span>
                <div className="asset-box">
                  <AssetViewer asset={pendingAsset ?? form.assets.find((a) => a.id === previewAssetId) ?? form.assets[0] ?? null} />
                </div>
                {pendingAsset && (
                  <div className="asset-pending">업로드 대기: <b>{pendingAsset.name}</b> <span className={`asset-type t-${pendingAsset.type}`}>{pendingAsset.type}</span> — 등록을 눌러 확정하세요.</div>
                )}
                {form.assets.length > 0 && (
                  <ul className="asset-items" style={{ marginTop: 8 }}>
                    {form.assets.map((a) => {
                      const sel = (previewAssetId ?? form.assets[0]?.id) === a.id;
                      return (
                        <li key={a.id} className={`asset-item${sel ? ' selected' : ''}`} onClick={() => setPreviewAssetId(a.id)}>
                          <span className={`asset-type t-${a.type}`}>{a.type}</span>
                          <span className="asset-name">{a.name}</span>
                          <button className="asset-btn danger" aria-label={`${a.name} 제거`} onClick={(e) => { e.stopPropagation(); removeAsset(a.id); }}>✕</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <input ref={assetRef} type="file" hidden onChange={onAssetUpload} />
                <div className="asset-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn-ghost" style={{ flex: 1 }} onClick={() => assetRef.current?.click()}>에셋 업로드</button>
                  <button className="btn-primary" disabled={!pendingAsset} onClick={commitAsset}>등록</button>
                  <button className="btn-ghost" disabled={!pendingAsset} onClick={cancelAsset}>취소</button>
                </div>
              </div>
            </div>

            {/* 오른쪽: 입력 정보 */}
            <div className="reg-right">
            <div className="form-grid two-col">
              <label className="form-field span-2">
                <span>상품명 *<HelpTip text={FIELD_HINTS.name} /></span>
                <input
                  autoFocus
                  className="inline-input full"
                  value={form.name}
                  placeholder="기준정보와 다르게 표기되는 상품명"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>브랜드<HelpTip text={FIELD_HINTS.brand} /></span>
                <input
                  className="inline-input full"
                  value={form.brand}
                  placeholder="한샘, 리바트, 이케아 등"
                  onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>견적그룹 *<HelpTip text={FIELD_HINTS.quoteGroup} /></span>
                <select
                  className="inline-input full"
                  value={form.quoteGroup}
                  onChange={(e) => setForm((f) => ({ ...f, quoteGroup: e.target.value }))}
                >
                  <option value="">선택</option>
                  {[...(quoteGroups[form.productGroup] ?? []), ...(quoteGroups[QUOTE_COMMON_KEY] ?? [])].map((q) => <option key={q.name} value={q.name}>{q.desc ? `${q.name} — ${q.desc}` : q.name}</option>)}
                </select>
              </label>
              <label className="form-field">
                <span>상품군 *<HelpTip text={FIELD_HINTS.productGroup} /></span>
                <select
                  className="inline-input full"
                  value={form.productGroup}
                  onChange={(e) => {
                    const g = e.target.value;
                    setForm((f) => ({
                      ...f,
                      productGroup: g,
                      productKind: (kindsByGroup[g] ?? []).includes(f.productKind) ? f.productKind : '',
                      modelKind: (modelsByGroup[g] ?? []).includes(f.modelKind) ? f.modelKind : '',
                    }));
                  }}
                >
                  <option value="" disabled>상품군 선택</option>
                  {groupOptions.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                  <option value="__new__">＋ 새 상품군 입력…</option>
                </select>
              </label>
              {form.productGroup === '__new__' ? (
                <label className="form-field">
                  <span>새 상품군 이름 *</span>
                  <input
                    className="inline-input full"
                    value={newGroup}
                    placeholder="예: 부엌, 바스, 수납, 도어"
                    onChange={(e) => setNewGroup(e.target.value)}
                  />
                </label>
              ) : (
                <label className="form-field">
                  <span>상품 구분 *<HelpTip text={FIELD_HINTS.productKind} /></span>
                  <select
                    className="inline-input full"
                    value={form.productKind}
                    onChange={(e) => setForm((f) => ({ ...f, productKind: e.target.value }))}
                  >
                    <option value="">{form.productGroup ? '품목 선택' : '상품군을 먼저 선택'}</option>
                    {(kindsByGroup[form.productGroup] ?? []).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </label>
              )}
              <label className="form-field">
                <span>모델 구분 <HelpTip text={FIELD_HINTS.modelKind} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(모델 구분 관리 등록)</small></span>
                <select className="inline-input full" value={form.modelKind}
                  onChange={(e) => setForm((f) => ({ ...f, modelKind: e.target.value }))}>
                  <option value="">{form.productGroup ? (modelsByGroup[form.productGroup] ?? []).length ? '모델 선택' : '모델 관리에서 등록 필요' : '상품군을 먼저 선택'}</option>
                  {(modelsByGroup[form.productGroup] ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>

              <div className="span-2 code-pair-grid">
                <label className="form-field">
                  <span>컨텐츠 코드 <HelpTip text={FIELD_HINTS.contentCode} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(자동 생성 · 수정 불가)</small></span>
                  <input className="inline-input full" value="등록 시 자동 생성됩니다" disabled readOnly />
                </label>
                <label className="form-field">
                  <span>상품코드 * <HelpTip text={FIELD_HINTS.productCode} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(등록 후 수정 불가)</small></span>
                  <input
                    className="inline-input full"
                    value={form.productCode}
                    placeholder="견적 가격을 갖고 있는 코드"
                    onChange={(e) => setForm((f) => ({ ...f, productCode: e.target.value }))}
                  />
                </label>
                <label className="form-field">
                  <span>모델코드<HelpTip text={FIELD_HINTS.modelCode} /></span>
                  <input className="inline-input full" value={form.modelCode} placeholder="모델 식별 코드"
                    onChange={(e) => setForm((f) => ({ ...f, modelCode: e.target.value }))} />
                </label>
                <label className="form-field">
                  <span>품목코드<HelpTip text={FIELD_HINTS.itemCode} /></span>
                  <input className="inline-input full" value={form.itemCode} placeholder="품목 식별 코드"
                    onChange={(e) => setForm((f) => ({ ...f, itemCode: e.target.value }))} />
                </label>
              </div>
              <label className="form-field">
                <span>사용자 그룹 <HelpTip text={FIELD_HINTS.permission} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(이 그룹 사용자에게 노출)</small></span>
                <select
                  className="inline-input full"
                  value={form.permission}
                  onChange={(e) => setForm((f) => ({ ...f, permission: e.target.value as ProductForm['permission'] }))}
                >
                  <option value="전체">전체</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>등록 폴더</span>
                <select
                  className="inline-input full"
                  value={form.folderId}
                  onChange={(e) => setForm((f) => ({ ...f, folderId: e.target.value }))}
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>

              {/* 속성 구분 */}
              {renderAttrSelector()}

              <div className="form-field span-2">
                <span>컨텐츠 크기 (mm) <HelpTip text={FIELD_HINTS.size} /> <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>(기본은 모델링 사이즈, 직접 입력 가능)</small></span>
                <div className="size-row">
                  <label className="size-cell"><span>W 폭<HelpTip text={FIELD_HINTS.w} /></span><input type="number" min="0" placeholder="0" value={form.w} aria-label="폭 W" onChange={(e) => setForm((f) => ({ ...f, w: e.target.value }))} /></label>
                  <label className="size-cell"><span>D 깊이<HelpTip text={FIELD_HINTS.d} /></span><input type="number" min="0" placeholder="0" value={form.d} aria-label="깊이 D" onChange={(e) => setForm((f) => ({ ...f, d: e.target.value }))} /></label>
                  <label className="size-cell"><span>H 높이<HelpTip text={FIELD_HINTS.h} /></span><input type="number" min="0" placeholder="0" value={form.h} aria-label="높이 H" onChange={(e) => setForm((f) => ({ ...f, h: e.target.value }))} /></label>
                </div>
              </div>
              <label className="form-field">
                <span>배치 위치<HelpTip text={FIELD_HINTS.placement} /></span>
                <select
                  className="inline-input full"
                  value={form.placement}
                  onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value as ProductForm['placement'] }))}
                >
                  <option value="바닥">바닥</option>
                  <option value="벽">벽</option>
                  <option value="천장">천장</option>
                </select>
              </label>
              <label className="form-field">
                <span>배치 높이 (mm)<HelpTip text={FIELD_HINTS.placeHeight} /></span>
                <input className="inline-input full" type="number" min="0" value={form.placeHeight} placeholder="바닥배치 기본 0" onChange={(e) => setForm((f) => ({ ...f, placeHeight: e.target.value }))} />
              </label>

              {renderUrlList('specUrls', '스펙 URL')}
              {renderUrlList('mallUrls', 'mall URL')}
            </div>

            {/* 필터 */}
            <div className="panel-head" style={{ margin: '16px 0 8px' }}>
              <h2 style={{ fontSize: '0.92rem' }}>필터</h2>
              <span className="sel-info" style={{ marginLeft: 12 }}>필터 추가로 분류</span>
            </div>
            {renderFilterPicker()}
            </div>

            {/* 컨텐츠 운영정보 — 설계형이면 기본정보 우측에 편집 화면과 동일 구성으로 노출 */}
            {form.attrType === '모델링' && form.modelingType === '설계형' && (
              <div className="reg-opinfo">
                <div className="panel-head">
                  <h2>컨텐츠 운영정보</h2>
                  <span className="sel-info" style={{ marginLeft: 12 }}>
                    {form.productGroup || '상품군'} · {form.productKind || '상품 구분'} 기준
                  </span>
                </div>

                <div className="panel-head" style={{ marginTop: 4 }}>
                  <h2 style={{ fontSize: '0.92rem' }}>{form.nonStandard ? '비규격 사이즈' : '운영 사이즈'}<HelpTip text={FIELD_HINTS.opSize} /></h2>
                  <span className="sel-info" style={{ marginLeft: 12 }}>MIN·MAX·GAP — 기본정보 사이즈 선택 범위</span>
                </div>
                {renderOpSize()}

                <div className="panel-head" style={{ marginTop: 14 }}>
                  <h2 style={{ fontSize: '0.92rem' }}>변수 정의<HelpTip text={FIELD_HINTS.vars} /></h2>
                  <span className="sel-info" style={{ marginLeft: 12 }}>#이름 참조 · 이름 W/D/H '수식' = 내보내기 치수 · '조건식'은 모두 TRUE일 때만 배치 · 노출☑ = 설계 화면에 표시</span>
                  <button className="btn-mini" style={{ marginLeft: 'auto' }}
                    onClick={() => setForm((f) => ({ ...f, vars: [...f.vars, { name: '', value: '', type: '고정값' as VarType }] }))}>+ 변수</button>
                </div>
                <div className="form-grid">
                  {form.vars.length === 0 && <p className="hint">필요하면 변수를 추가하세요. 예) 이름 <b>LDH</b>, 유형 <b>고정값</b>, 값 <b>20</b> → 수식에서 <b>#LDH</b> · 도어 치수는 이름 <b>W</b>/<b>H</b>의 수식 변수로.</p>}
                  {form.vars.map((v, i) => (
                    <div key={i} className="opsize-row" style={{ gridTemplateColumns: '1fr 92px 1.6fr 52px 28px' }}>
                      <input type="text" placeholder="이름 (예: LDH, W)" value={v.name}
                    title={`수식에서 #${v.name.trim() || '이름'} 으로 참조`}
                        onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
                      <select value={varTypeOf(v)} aria-label="값 유형"
                        onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, type: e.target.value as VarType } : x) }))}>
                        {VAR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="text" value={v.value}
                        placeholder={varTypeOf(v) === '고정값' ? '숫자 (예: 20)' : varTypeOf(v) === '조건식' ? '예: #LDH >= 20' : '식 (예: #H - #LDH)'}
                        onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))} />
                      <label className="visible-toggle" title="설계 화면(모델링 선택 시)에 이 변수 노출" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                        <input type="checkbox" checked={!!v.expose}
                          onChange={(e) => setForm((f) => ({ ...f, vars: f.vars.map((x, j) => j === i ? { ...x, expose: e.target.checked } : x) }))} />노출
                      </label>
                      <button className="order-btn" title="변수 삭제" onClick={() => setForm((f) => ({ ...f, vars: f.vars.filter((_, j) => j !== i) }))}><TrashIcon size={12} /></button>
                    </div>
                  ))}
                </div>

                <div className="panel-head" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: '0.92rem' }}>운영 항목</h2>
                </div>
                {renderOperationInfo()}

                <div className="panel-head" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: '0.92rem' }}>구성/교체 (모델링 그룹)</h2>
                  <span className="sel-info" style={{ marginLeft: 12 }}>부위별 교체 그룹 연결</span>
                </div>
                {renderModelingSlots()}

                <div className="panel-head" style={{ marginTop: 18 }}>
                  <h2 style={{ fontSize: '0.92rem' }}>스타일 그룹</h2>
                  <span className="sel-info" style={{ marginLeft: 12 }}>스타일 그룹 관리의 스타일 연결 — 선택 시 부위 일괄 교체</span>
                </div>
                {renderStyleLinks()}
              </div>
            )}
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowRegister(false)}>취소</button>
              <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!canSubmit} onClick={submitRegister}>
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- DB 필드 관리 모달 ---- */}
      {showFieldManager && (
        <div className="modal-backdrop" onClick={closeFieldManager}>
          <div className="modal field-manager" role="dialog" aria-modal="true" aria-label="DB 필드 관리" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head" style={{ marginTop: -6, marginBottom: 8 }}>
              <p className="hint" style={{ margin: 0 }}>
                컨텐츠 등록(가구) 공통 필드 정의입니다. 모든 필드의 이름·속성을 수정하고 추가·삭제할 수 있습니다.
              </p>
              <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={resetFields}>기본값으로 초기화</button>
            </div>

            <table>
              <thead>
                <tr>
                  <th>컬럼명</th>
                  <th style={{ width: 84 }}>직접입력</th>
                  <th style={{ width: 70 }}>필수</th>
                  <th style={{ width: 80 }}>수정가능</th>
                  <th>예시</th>
                  <th style={{ width: 46 }}></th>
                </tr>
              </thead>
              <tbody>
                {fieldDraft.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <input
                        className="inline-input"
                        style={{ width: 140 }}
                        value={f.label}
                        aria-label={`${f.label} 컬럼명`}
                        onChange={(e) => patchField(f.key, { label: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        className={`switch${f.manualInput ? ' on' : ''}`}
                        role="switch"
                        aria-checked={f.manualInput}
                        aria-label={`${f.label} 직접 입력 여부`}
                        onClick={() => patchField(f.key, { manualInput: !f.manualInput })}
                      />
                    </td>
                    <td>
                      <button
                        className={`switch${f.required ? ' on' : ''}`}
                        role="switch"
                        aria-checked={f.required}
                        aria-label={`${f.label} 필수 여부`}
                        onClick={() => patchField(f.key, { required: !f.required })}
                      />
                    </td>
                    <td>
                      <button
                        className={`switch${f.editable ? ' on' : ''}`}
                        role="switch"
                        aria-checked={f.editable}
                        aria-label={`${f.label} 수정 가능 여부`}
                        onClick={() => patchField(f.key, { editable: !f.editable })}
                      />
                    </td>
                    <td>
                      <input
                        className="inline-input"
                        style={{ width: '100%' }}
                        value={f.example}
                        aria-label={`${f.label} 예시`}
                        onChange={(e) => patchField(f.key, { example: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        className="order-btn"
                        aria-label={`${f.label} 필드 삭제`}
                        title="필드 삭제"
                        onClick={() => deleteField(f.key)}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="folder-new" style={{ marginTop: 14 }}>
              <input
                value={fieldInput}
                placeholder="새 필드 컬럼명"
                aria-label="새 필드 컬럼명"
                onChange={(e) => setFieldInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
              />
              <button className="btn-mini" onClick={addField}>필드 추가</button>
            </div>

            <div className="modal-actions">
              {fieldDirty && <span className="sel-info" style={{ marginRight: 'auto', color: 'var(--clay)' }}>저장하지 않은 변경사항</span>}
              <button className="btn-ghost" onClick={closeFieldManager}>취소</button>
              <button className="btn-primary" style={{ marginLeft: 0 }} onClick={saveFields}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 필터 관리 모달 ---- */}
      {showFilterManager && (
        <div className="modal-backdrop" onClick={closeFilterManager}>
          <div className="modal field-manager" role="dialog" aria-modal="true" aria-label="필터 관리" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">필터 관리</h2>
            <p className="hint" style={{ marginTop: -10, marginBottom: 12 }}>
              제목 그룹(예: 스타일)과 그 아래 선택 항목(예: 모던)으로 구성합니다. 상품 분류에 사용됩니다.
            </p>

            <div className="filter-mgr scroll">
              {/* 연동 필터 — 상품군·구분 관리, 모델 관리에서 가져옴 (여기선 수정 불가) */}
              {derivedFilterGroups.map((g) => (
                <div key={g.id} className="filter-group" style={{ opacity: 0.85 }}>
                  <div className="filter-group-head">
                    <b style={{ width: 160 }}>{g.name}</b>
                    <span className="sel-info" style={{ marginLeft: 8 }}>
                      연동 · {g.id === 'fg-kind' ? '상품군·구분 관리' : '모델 관리'}에서 수정
                    </span>
                  </div>
                  <div className="check-list" style={{ gap: '8px' }}>
                    {g.options.map((o) => <span key={o.id} className="tag">{o.name}</span>)}
                    {g.options.length === 0 && <span className="hint">항목 없음</span>}
                  </div>
                </div>
              ))}
              {filterGroups.map((g) => (
                <div key={g.id} className="filter-group">
                  <div className="filter-group-head">
                    <input
                      className="inline-input"
                      style={{ width: 160, fontWeight: 600 }}
                      value={g.name}
                      aria-label={`${g.name} 그룹명`}
                      onChange={(e) => renameFilterGroup(g.id, e.target.value)}
                    />
                    <button
                      className="order-btn"
                      aria-label={`${g.name} 그룹 삭제`}
                      title="그룹 삭제"
                      onClick={() => deleteFilterGroup(g.id)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                  <div className="check-list" style={{ gap: '8px' }}>
                    {g.options.map((o) => (
                      <span key={o.id} className="tag removable">
                        {o.name}
                        <button
                          className="tag-x"
                          aria-label={`${o.name} 항목 삭제`}
                          onClick={() => deleteFilterOption(g.id, o.id)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {g.options.length === 0 && <span className="hint" style={{ color: 'var(--clay)' }}>항목을 1개 이상 추가하세요</span>}
                  </div>
                  <div className="folder-new" style={{ marginTop: 8, maxWidth: 280 }}>
                    <input
                      value={optionInputs[g.id] ?? ''}
                      placeholder="선택 항목 추가"
                      aria-label={`${g.name} 선택 항목 추가`}
                      onChange={(e) => setOptionInputs((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') addFilterOption(g.id); }}
                    />
                    <button className="btn-mini" onClick={() => addFilterOption(g.id)}>추가</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="folder-new" style={{ marginTop: 14, maxWidth: 320 }}>
              <input
                value={newFilterGroup}
                placeholder="새 필터 그룹(제목) 이름"
                aria-label="새 필터 그룹 이름"
                onChange={(e) => setNewFilterGroup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addFilterGroup(); }}
              />
              <button className="btn-mini" onClick={addFilterGroup}>그룹 추가</button>
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" style={{ marginLeft: 0 }} onClick={closeFilterManager}>닫기</button>
              <button className="btn-primary" onClick={() => { saveAll(); closeFilterManager(); }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 상품구분 관리 모달 (상품군별 폴더 구조) ---- */}
      {showKindManager && (
        <div className="modal-backdrop" onClick={closeKindManager}>
          <div className="modal field-manager" role="dialog" aria-modal="true" aria-label="상품군·구분 관리" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">상품군·구분 관리</h2>
            <p className="hint" style={{ marginTop: -10, marginBottom: 12 }}>
              상품군(폴더)과 그 아래 상품 구분(품목)을 함께 관리합니다. 상품 등록 시 선택한 상품군의 품목 목록으로 사용됩니다.
            </p>
            <div className="folder-new" style={{ marginBottom: 12, maxWidth: 320 }}>
              <input
                value={groupInput}
                placeholder="새 상품군 이름"
                aria-label="새 상품군 이름"
                onChange={(e) => setGroupInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addGroup(); }}
              />
              <button className="btn-mini" onClick={addGroup}>상품군 추가</button>
            </div>
            <div className="filter-mgr scroll">
              {productGroups.map((g) => {
                const used = groupUsage.get(g) ?? 0;
                const hasKinds = (kindsByGroup[g] ?? []).length > 0;
                return (
                  <div key={g} className="filter-group">
                    <div className="filter-group-head">
                      <FolderIcon />
                      <input
                        className="inline-input"
                        style={{ width: 150, fontWeight: 600, marginLeft: 6 }}
                        defaultValue={g}
                        aria-label={`${g} 상품군 이름`}
                        onBlur={(e) => renameGroup(g, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                      <span className="sel-info" style={{ marginLeft: 8 }}>상품 {used}개</span>
                      <button
                        className="order-btn"
                        style={{ marginLeft: 'auto' }}
                        aria-label={`${g} 상품군 삭제`}
                        title={used > 0 || hasKinds ? '상품·품목이 있는 상품군은 삭제할 수 없습니다' : '상품군 삭제'}
                        disabled={used > 0 || hasKinds}
                        onClick={() => deleteGroup(g)}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                    <div className="check-list" style={{ gap: '8px' }}>
                      {(kindsByGroup[g] ?? []).map((k) => (
                        <span key={k} className="tag removable" style={{ paddingLeft: 4 }}>
                          <input
                            className="kind-edit"
                            defaultValue={k}
                            aria-label={`${k} 품목 이름`}
                            onBlur={(e) => renameKind(g, k, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          />
                          <button className="tag-x" aria-label={`${k} 삭제`} onClick={() => deleteKind(g, k)}>×</button>
                        </span>
                      ))}
                      {(kindsByGroup[g] ?? []).length === 0 && <span className="hint">등록된 품목이 없습니다</span>}
                    </div>
                    <div className="folder-new" style={{ marginTop: 8, maxWidth: 280 }}>
                      <input
                        value={kindInputs[g] ?? ''}
                        placeholder="상품 구분(품목) 추가"
                        aria-label={`${g} 품목 추가`}
                        onChange={(e) => setKindInputs((prev) => ({ ...prev, [g]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') addKind(g); }}
                      />
                      <button className="btn-mini" onClick={() => addKind(g)}>추가</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" style={{ marginLeft: 0 }} onClick={closeKindManager}>닫기</button>
              <button className="btn-primary" onClick={() => { saveAll(); closeKindManager(); }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {showQuoteManager && (
        <div className="modal-backdrop" onClick={closeQuoteManager}>
          <div className="modal field-manager" role="dialog" aria-modal="true" aria-label="견적그룹 관리" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">견적그룹 관리</h2>
            <p className="hint" style={{ marginTop: -10, marginBottom: 12 }}>
              견적그룹은 상품(컨텐츠) 등록 시 선택하는 견적 로직 구분입니다. 배치된 상품코드로 외부 견적 로직이 그룹별로 계산합니다.
            </p>
            <div className="filter-mgr scroll">
              {[QUOTE_COMMON_KEY, ...productGroups].map((g) => {
                const isCommon = g === QUOTE_COMMON_KEY;
                const list = quoteGroups[g] ?? [];
                return (
                  <div key={g} className="filter-group">
                    <div className="filter-group-head">
                      <FolderIcon />
                      <span style={{ fontWeight: 600, marginLeft: 6 }}>{isCommon ? '공통영역' : g}</span>
                      {isCommon && <span className="hint" style={{ marginLeft: 8 }}>모든 상품군에서 선택 가능</span>}
                      <span className="sel-info" style={{ marginLeft: 'auto' }}>{list.length}개</span>
                    </div>
                    <div className="quote-rows">
                      {list.map((q) => {
                        const used = products.filter((p) => p.quoteGroup === q.name).length;
                        return (
                          <div key={q.name} className="quote-row">
                            {quoteRenaming === quoteKey(g, q.name) ? (
                              <input
                                className="inline-input quote-name"
                                autoFocus
                                value={quoteRenameDraft}
                                aria-label={`${q.name} 견적그룹 이름`}
                                onChange={(e) => setQuoteRenameDraft(e.target.value)}
                                onBlur={commitQuoteRename}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitQuoteRename(); if (e.key === 'Escape') setQuoteRenaming(null); }}
                              />
                            ) : (
                              <span className="quote-name" role="button" title="이름 변경" style={{ cursor: 'pointer', fontWeight: 600 }} onClick={() => { setQuoteRenaming(quoteKey(g, q.name)); setQuoteRenameDraft(q.name); }}>{q.name}</span>
                            )}
                            <input
                              className="inline-input quote-desc"
                              value={q.desc}
                              placeholder="설명 (예: SSD 서라운딩 등 부엌 시공 일체)"
                              aria-label={`${q.name} 설명`}
                              onChange={(e) => setQuoteDesc(g, q.name, e.target.value)}
                            />
                            <button
                              className="order-btn"
                              aria-label={`${q.name} 삭제`}
                              title={used > 0 ? `사용 중인 상품 ${used}개 — 삭제 불가` : '견적그룹 삭제'}
                              disabled={used > 0}
                              onClick={() => { if (used === 0) deleteQuoteGroup(g, q.name); }}
                            >
                              <TrashIcon size={12} />
                            </button>
                          </div>
                        );
                      })}
                      {list.length === 0 && <span className="hint">등록된 견적그룹이 없습니다</span>}
                    </div>
                    <div className="folder-new" style={{ marginTop: 8, maxWidth: 280 }}>
                      <input
                        value={quoteInputs[g] ?? ''}
                        placeholder={isCommon ? '공통 견적그룹 추가' : `${g} 견적그룹 추가`}
                        aria-label={`${g} 견적그룹 추가`}
                        onChange={(e) => setQuoteInputs((prev) => ({ ...prev, [g]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') addQuoteGroup(g); }}
                      />
                      <button className="btn-mini" onClick={() => addQuoteGroup(g)}>추가</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" style={{ marginLeft: 0 }} onClick={closeQuoteManager}>닫기</button>
              <button className="btn-primary" onClick={() => { saveAll(); closeQuoteManager(); }}>저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 모델 관리 모달 (상품군별 폴더 구조) ---- */}
      {showModelManager && (
        <div className="modal-backdrop" onClick={closeModelManager}>
          <div className="modal field-manager" role="dialog" aria-modal="true" aria-label="모델 구분 관리" onClick={(e) => e.stopPropagation()}>
            <div className="modal-stickyhead">
              <h2 className="modal-title" style={{ margin: 0 }}>모델 구분 관리</h2>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button className="btn-ghost" onClick={closeModelManager}>닫기</button>
                <button className="btn-primary" onClick={() => { saveAll(); closeModelManager(); }}>저장</button>
              </div>
            </div>
            <p className="hint" style={{ marginBottom: 12 }}>
              상품군(폴더) 아래에 모델(시리즈)을 등록합니다. 상품 등록 시 선택한 상품군의 모델 목록으로 사용됩니다.
            </p>
            <div className="filter-mgr">
              {productGroups.map((g) => (
                <div key={g} className="filter-group">
                  <div className="filter-group-head"><FolderIcon /><b style={{ marginLeft: 6 }}>{g}</b></div>
                  <div className="check-list" style={{ gap: '8px' }}>
                    {(modelsByGroup[g] ?? []).map((m) => (
                      <span key={m} className="tag removable">
                        {m}
                        <button className="tag-x" aria-label={`${m} 삭제`} onClick={() => deleteModel(g, m)}>×</button>
                      </span>
                    ))}
                    {(modelsByGroup[g] ?? []).length === 0 && <span className="hint">등록된 모델이 없습니다</span>}
                  </div>
                  <div className="folder-new" style={{ marginTop: 8, maxWidth: 280 }}>
                    <input
                      value={modelInputs[g] ?? ''}
                      placeholder="모델 추가"
                      aria-label={`${g} 모델 추가`}
                      onChange={(e) => setModelInputs((prev) => ({ ...prev, [g]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') addModel(g); }}
                    />
                    <button className="btn-mini" onClick={() => addModel(g)}>추가</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}