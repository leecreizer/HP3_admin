import { createContext, useContext } from 'react';
import { fmt } from '../../pm/expr';
import type { Catalog, PmEval } from '../../pm/resolve';
import type { PmModel } from '../../pm/types';
import type { ProfileShape } from '../../data/contentLibrary';

/** 에디터 공통 — 속성 패널·대화상자가 모델 계산 결과와 수식 창을 함께 쓴다 */
export interface PmCtxValue {
  model: PmModel;
  ev: PmEval;
  catalog: Catalog;
  /** 수식 창 열기 — 확인하면 onSave */
  openFormula: (o: { title: string; value: string; onSave: (v: string) => void; hint?: string }) => void;
  toast: (msg: string) => void;
  /** 단면 그리기 결과를 몰딩 라이브러리 상품으로 — 새 상품 id (컨텐츠 라이브러리에서 연 에디터만) */
  addProfile?: (name: string, shape: ProfileShape) => string | undefined;
}
export const PmCtx = createContext<PmCtxValue | null>(null);
export function usePm(): PmCtxValue {
  const v = useContext(PmCtx);
  if (!v) throw new Error('PmCtx 없음');
  return v;
}

/** 계산값 미리보기 문자열 */
export function previewOf(ev: PmEval, expr: string | undefined): { text?: string; error?: string } {
  if (!expr || !expr.trim()) return {};
  const r = ev.try(expr);
  return r.error ? { error: r.error } : { text: fmt(r.value) };
}

export const UNV = '쿠지알러 화면에서 동작을 확인하지 못한 기능 — 지어내지 않고 비활성으로 둡니다';
