/** 모델링 라이브러리 공유 데이터 — 모델링 라이브러리 화면과 상품 편집(구성/교체 슬롯 연결)에서 공유 */

export type Slot = string; // 역할/슬롯 (도어·몸통·손잡이·스타일 … 고정 + 자유 추가)
export type Group = { id: string; name: string; slot: Slot };
export type Modeling = {
  id: string;
  name: string;
  slot: Slot;
  /** 소속 교체 그룹(다중) */
  groupIds: string[];
  w: number; d: number; h: number;
  tone: 1 | 2 | 3 | 4; // 썸네일 톤(프로토타입)
  updatedAt: string;
};

export const FIXED_SLOTS: Slot[] = ['도어', '몸통', '손잡이', '스타일', '받침'];
export const SLOT_TONE: Record<string, 1 | 2 | 3 | 4> = { 도어: 1, 몸통: 2, 손잡이: 3, 스타일: 4, 받침: 2 };

const INITIAL_SLOTS: Slot[] = [...FIXED_SLOTS];
const INITIAL_GROUPS: Group[] = [
  { id: 'g-door-a', name: '스윙 도어 그룹', slot: '도어' },
  { id: 'g-door-b', name: '슬라이딩 도어 그룹', slot: '도어' },
  { id: 'g-body', name: '기본 몸통 그룹', slot: '몸통' },
  { id: 'g-handle', name: '손잡이 그룹', slot: '손잡이' },
  { id: 'g-style', name: '스타일 교체 그룹', slot: '스타일' },
];
let seq = 0;
const mk = (name: string, slot: Slot, groupIds: string[], w: number, d: number, h: number): Modeling =>
  ({ id: `m-${++seq}`, name, slot, groupIds, w, d, h, tone: SLOT_TONE[slot] ?? 1, updatedAt: '2026-06-24' });
const INITIAL_MODELINGS: Modeling[] = [
  mk('스윙 도어 600 화이트', '도어', ['g-door-a'], 600, 20, 2350),
  mk('스윙 도어 600 우드', '도어', ['g-door-a'], 600, 20, 2350),
  mk('슬라이딩 도어 900 미러', '도어', ['g-door-b'], 900, 30, 2350),
  mk('몸통 600 3단', '몸통', ['g-body'], 600, 580, 2350),
  mk('몸통 800 4단', '몸통', ['g-body'], 800, 580, 2350),
  mk('바 손잡이 256', '손잡이', ['g-handle'], 256, 30, 30),
  mk('히든 손잡이', '손잡이', ['g-handle'], 0, 0, 0),
  mk('모던 화이트 스타일', '스타일', ['g-style'], 0, 0, 0),
  mk('내추럴 우드 스타일', '스타일', ['g-style'], 0, 0, 0),
  mk('미분류 받침 100', '받침', [], 600, 580, 100),
];

const STORE = 'hp3-modeling-state';

export type ModelingSnapshot = { slots: Slot[]; groups: Group[]; modelings: Modeling[] };

export function loadModelingState(): ModelingSnapshot {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<ModelingSnapshot> & { modelings?: any[] };
    const slots = raw.slots ?? INITIAL_SLOTS;
    const groups = raw.groups ?? INITIAL_GROUPS;
    // 구버전(groupId 단일) → groupIds 마이그레이션
    const modelings: Modeling[] = (raw.modelings ?? INITIAL_MODELINGS).map((m: any) => ({
      ...m,
      groupIds: Array.isArray(m.groupIds) ? m.groupIds : (m.groupId ? [m.groupId] : []),
      tone: m.tone ?? SLOT_TONE[m.slot] ?? 1,
    }));
    return { slots, groups, modelings };
  } catch {
    return { slots: INITIAL_SLOTS, groups: INITIAL_GROUPS, modelings: INITIAL_MODELINGS };
  }
}

export function saveModelingState(s: ModelingSnapshot) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* ignore */ }
}