import type { Part, Profile } from './types';
import { computeBBox } from './partGeometry';

const KEY = 'hp3-parts';

/** 구버전(변/segment 기반) 프로필을 꼭지점(corners) 모델로 마이그레이션. */
function migrate(part: Part): Part {
  const cts = part.profile?.contours;
  if (!Array.isArray(cts)) return part;
  let changed = false;
  const contours = cts.map((c) => {
    const legacy = c as unknown as { start?: [number, number]; segments?: { to: [number, number] }[]; corners?: unknown };
    if (!c.corners && legacy.start && Array.isArray(legacy.segments)) {
      changed = true;
      const pts = [legacy.start, ...legacy.segments.map((s) => s.to)];
      // 닫힘 중복점 제거
      if (pts.length > 1) {
        const last = pts[pts.length - 1];
        if (last[0] === legacy.start[0] && last[1] === legacy.start[1]) pts.pop();
      }
      return { closed: true, corners: pts.map((pt) => ({ pt })) };
    }
    return c;
  });
  return changed ? { ...part, profile: { ...part.profile, contours } } : part;
}

export function loadParts(): Part[] {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(r) ? (r as Part[]).map(migrate) : [];
  } catch { return []; }
}

export function saveParts(parts: Part[]): void {
  localStorage.setItem(KEY, JSON.stringify(parts));
}

export function upsertPart(part: Part): Part[] {
  const next = { ...part, updatedAt: Date.now() };
  const all = loadParts();
  const idx = all.findIndex((p) => p.id === part.id);
  if (idx >= 0) all[idx] = next; else all.push(next);
  saveParts(all);
  return all;
}

export function deletePart(id: string): Part[] {
  const all = loadParts().filter((p) => p.id !== id);
  saveParts(all);
  return all;
}

function rectProfile(w: number, h: number): Profile {
  return {
    units: 'mm',
    contours: [{
      closed: true,
      corners: [
        { pt: [0, 0] },
        { pt: [w, 0] },
        { pt: [w, h] },
        { pt: [0, h] },
      ],
    }],
  };
}

export function newPart(name: string): Part {
  const profile = rectProfile(600, 720);
  const depth = 18;
  const now = Date.now();
  return {
    id: `part-${now}-${Math.floor(Math.random() * 1e4)}`,
    name,
    profile,
    method: 'extrude',
    rot: [0, 0, 0],
    extrude: { depth },
    material: { color: '#d8c5a8' },
    bbox: computeBBox(profile, depth),
    createdAt: now,
    updatedAt: now,
  };
}
