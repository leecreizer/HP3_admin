import type { Part, Profile } from './types';
import { computeBBox } from './partGeometry';

const KEY = 'hp3-parts';

export function loadParts(): Part[] {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(r) ? (r as Part[]) : [];
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
      start: [0, 0],
      segments: [
        { type: 'line', to: [w, 0] },
        { type: 'line', to: [w, h] },
        { type: 'line', to: [0, h] },
        { type: 'line', to: [0, 0] },
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
    extrude: { depth },
    material: { color: '#d8c5a8' },
    bbox: computeBBox(profile, depth),
    createdAt: now,
    updatedAt: now,
  };
}
