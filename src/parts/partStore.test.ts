import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadParts, saveParts, upsertPart, deletePart, newPart } from './partStore';

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});

describe('partStore', () => {
  it('초기 로드는 빈 배열', () => {
    expect(loadParts()).toEqual([]);
  });
  it('newPart는 기본 사각형 파츠 생성', () => {
    const p = newPart('좌측판');
    expect(p.name).toBe('좌측판');
    expect(p.bbox).toEqual({ w: 600, h: 720, d: 18 });
    expect(p.method).toBe('extrude');
  });
  it('upsert 후 load하면 저장됨', () => {
    const p = newPart('선반');
    upsertPart(p);
    expect(loadParts().length).toBe(1);
  });
  it('같은 id upsert는 갱신(중복 아님)', () => {
    const p = newPart('선반');
    upsertPart(p);
    upsertPart({ ...p, name: '선반2' });
    const all = loadParts();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('선반2');
  });
  it('delete는 제거', () => {
    const p = newPart('선반');
    upsertPart(p);
    const rest = deletePart(p.id);
    expect(rest.length).toBe(0);
  });
});