import type { Part } from './types';
import type { Placement, DesignVar } from './assemblyStore';

/**
 * 저장된 조립 모델 — 상품 모델링(교체 그룹)에 연계되는 단위.
 * SwapGroup(hp3-swap-groups)과 같은 id로 등록되어 상품 모델링 슬롯에서 선택된다.
 * 자체 완결성을 위해 사용된 파츠 정의(parts)를 함께 임베드한다.
 */
export interface AssemblyModel {
  id: string;
  name: string;
  kind: string;            // 상품구분(품목) 슬롯 = SwapGroup.kind
  items: Placement[];      // 배치
  parts: Part[];           // 배치가 참조하는 파츠 정의(임베드)
  vars?: DesignVar[];      // 설계 변수(기준 W/D/H 포함)
  createdAt: number;
  updatedAt: number;
}

const KEY = 'hp3-assembly-models';

export function loadAssemblyModels(): AssemblyModel[] {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(r) ? (r as AssemblyModel[]) : [];
  } catch { return []; }
}

export function saveAssemblyModel(m: AssemblyModel): AssemblyModel[] {
  const all = loadAssemblyModels();
  const next = { ...m, updatedAt: Date.now() };
  const i = all.findIndex((x) => x.id === m.id);
  if (i >= 0) all[i] = next; else all.push(next);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}