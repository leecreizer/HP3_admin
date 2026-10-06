import type { ParamType, PmVar, ValueType } from '../../pm/types';

export const PARAM_TYPE_LABEL: Record<ParamType, string> = {
  float: '실수', int: '정수', string: '문자', boolean: '예·아니오', multiBoolean: '다중 예·아니오', material: '재질', style: '스타일', profile: '윤곽',
};
export const VALUE_TYPE_LABEL: Record<ValueType, string> = {
  range: '구간', options: '선택', free: '무제한', formula: '수식', composite: '복합 수식', fixed: '고정값',
};
/** 변수 형식별 값 유형 — 문서 1.1.6 · 3.1.28 (재질·스타일: 무제한/선택/복합 수식/수식/고정값, 윤곽: 무제한/선택/고정값) */
export const VALUE_TYPES_FOR: Record<ParamType, ValueType[]> = {
  float: ['range', 'options', 'free', 'formula', 'composite', 'fixed'],
  int: ['range', 'options', 'free', 'formula', 'composite', 'fixed'],
  string: ['options', 'free', 'formula', 'composite', 'fixed'],
  boolean: ['free', 'formula', 'composite', 'fixed'],
  multiBoolean: ['free', 'formula', 'fixed'],
  material: ['free', 'options', 'composite', 'formula', 'fixed'],
  style: ['free', 'options', 'composite', 'formula', 'fixed'],
  profile: ['free', 'options', 'fixed'],
};
/** 변수가 수식으로 값을 정하는지 */
export const isFormulaVar = (v: PmVar, state?: 'value' | 'formula') =>
  v.scope === 'middle' || v.scope === 'report' || v.valueType === 'formula' || (v.valueType === 'composite' && (state ?? v.state) === 'formula');

