# 파츠 모델러 (PartEditor) MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 어드민에서 2D 단면을 스케치하고 두께를 줘(익스트루드) 판재 파츠를 정의·저장하는 독립 에디터 페이지를 만든다.

**Architecture:** 순수 형상 로직(`partGeometry.ts`)과 영속 상태(`partStore.ts`)를 UI에서 분리한다. `PartEditor` 페이지가 좌측 SVG 스케처(`SketchCanvas`)와 우측 R3F 3D 미리보기(`ExtrudePreview`)를 조합한다. 저장은 기존 어드민 패턴대로 localStorage.

**Tech Stack:** React 19, TypeScript, three 0.184(기존), 신규 `@react-three/fiber` + `@react-three/drei`, 테스트용 신규 `vitest`. SVG 스케처는 외부 라이브러리 없이 자체 구현.

## Global Constraints

- 대상 저장소: `c:\workspace\HP3_admin` — 모든 명령은 `cd /c/workspace/HP3_admin` 후 실행.
- `src/pages/Products.tsx`는 **수정하지 않는다**.
- 단위: mm. 파츠 저장 키: localStorage `hp3-parts`.
- 데이터 구조는 향후 확장 대비 `method: 'extrude'` 필드 유지(리볼브/로프트 대비).
- 커밋 메시지 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- 마지막 통합 태스크에서만 package.json/package-lock.json 버전 0.0.1 증가.
- 커밋은 각 태스크에서 수행하되, **원격 push는 사용자가 "커밋 푸시"라고 지시할 때만**.

---

## File Structure

- Create: `src/parts/types.ts` — Part/Profile/Contour/Segment 타입.
- Create: `src/parts/partGeometry.ts` — profile→THREE.Shape 변환, bbox 계산, 검증.
- Create: `src/parts/partGeometry.test.ts` — 형상 로직 단위 테스트.
- Create: `src/parts/partStore.ts` — 파츠 라이브러리 상태 + localStorage 영속.
- Create: `src/parts/partStore.test.ts` — 저장/로드 단위 테스트.
- Create: `src/parts/ExtrudePreview.tsx` — R3F 3D 미리보기.
- Create: `src/parts/SketchCanvas.tsx` — SVG 2D 단면 편집기.
- Create: `src/pages/PartEditor.tsx` — 페이지 셸(툴바+좌우 분할+라이브러리 CRUD).
- Create: `vitest.config.ts` — 테스트 설정.
- Modify: `src/config.ts` — `parts` 메뉴 키 + 하위메뉴 추가.
- Modify: `src/App.tsx` — `parts` 라우팅 분기.
- Modify: `package.json`, `package-lock.json` — 의존성 + 버전.

---

### Task 1: 형상 로직 코어 (types + partGeometry) + 테스트 인프라

**Files:**
- Create: `vitest.config.ts`
- Create: `src/parts/types.ts`
- Create: `src/parts/partGeometry.ts`
- Test: `src/parts/partGeometry.test.ts`
- Modify: `package.json` (devDependency: vitest, script: test)

**Interfaces:**
- Produces:
  - `types.ts`: `Part`, `Profile`, `Contour`, `Segment`, `Vec2 = [number, number]`.
  - `partGeometry.ts`:
    - `buildShape(profile: Profile): import('three').Shape` — 외곽 컨투어→Shape, 이후 컨투어→holes.
    - `computeBBox(profile: Profile, depth: number): { w: number; h: number; d: number }` — 외곽 점들의 min/max로 w(가로)·h(세로), d=depth.
    - `validateProfile(profile: Profile): string[]` — 오류 메시지 배열(빈 배열=정상). 규칙: 외곽 컨투어 점 3개 미만, 미폐합.

- [ ] **Step 1: vitest 설치**

Run:
```bash
cd /c/workspace/HP3_admin && npm install -D vitest@^3.2.0
```
Expected: `added` 로그, package.json devDependencies에 vitest 추가.

- [ ] **Step 2: test 스크립트 + vitest 설정 추가**

`package.json` scripts에 추가(기존 `"lint"` 줄 뒤):
```json
    "test": "vitest run",
```

`vitest.config.ts` 생성:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: 타입 정의 작성**

`src/parts/types.ts`:
```ts
export type Vec2 = [number, number];

export type Segment =
  | { type: 'line'; to: Vec2 }
  | { type: 'arc'; to: Vec2; radius: number; ccw?: boolean };

export interface Contour {
  closed: boolean;
  /** 시작점. 이후 segments가 이 점에서 이어진다. */
  start: Vec2;
  segments: Segment[];
}

export interface Profile {
  units: 'mm';
  /** [0]=외곽, 이후=구멍(holes) */
  contours: Contour[];
}

export interface Part {
  id: string;
  name: string;
  profile: Profile;
  method: 'extrude';
  extrude: { depth: number; bevel?: { size: number; thickness: number } };
  material?: { color: string; name?: string };
  bbox: { w: number; h: number; d: number };
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`src/parts/partGeometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildShape, computeBBox, validateProfile } from './partGeometry';
import type { Profile } from './types';

const rect = (w: number, h: number): Profile => ({
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
});

describe('validateProfile', () => {
  it('정상 사각형은 오류 없음', () => {
    expect(validateProfile(rect(600, 720))).toEqual([]);
  });
  it('점 3개 미만이면 오류', () => {
    const p: Profile = { units: 'mm', contours: [{ closed: true, start: [0, 0], segments: [{ type: 'line', to: [10, 0] }] }] };
    expect(validateProfile(p).length).toBeGreaterThan(0);
  });
  it('컨투어가 없으면 오류', () => {
    expect(validateProfile({ units: 'mm', contours: [] }).length).toBeGreaterThan(0);
  });
});

describe('computeBBox', () => {
  it('사각형 600x720, 두께 18 → w600 h720 d18', () => {
    expect(computeBBox(rect(600, 720), 18)).toEqual({ w: 600, h: 720, d: 18 });
  });
});

describe('buildShape', () => {
  it('사각형은 THREE.Shape를 반환하고 곡선점이 4개 이상', () => {
    const shape = buildShape(rect(600, 720));
    const pts = shape.getPoints();
    expect(pts.length).toBeGreaterThanOrEqual(4);
  });
  it('구멍이 있으면 holes에 반영', () => {
    const p = rect(600, 720);
    p.contours.push({ closed: true, start: [100, 100], segments: [
      { type: 'line', to: [200, 100] }, { type: 'line', to: [200, 200] },
      { type: 'line', to: [100, 200] }, { type: 'line', to: [100, 100] },
    ]});
    const shape = buildShape(p);
    expect(shape.holes.length).toBe(1);
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `cd /c/workspace/HP3_admin && npm test`
Expected: FAIL — `partGeometry` 모듈/함수 없음.

- [ ] **Step 6: partGeometry 구현**

`src/parts/partGeometry.ts`:
```ts
import { Shape, Path } from 'three';
import type { Profile, Contour, Vec2 } from './types';

/** 컨투어의 모든 정점(시작점 + 각 세그먼트 도착점). arc도 근사 위해 도착점 사용. */
function contourPoints(c: Contour): Vec2[] {
  return [c.start, ...c.segments.map((s) => s.to)];
}

function applyContour(target: Shape | Path, c: Contour): void {
  target.moveTo(c.start[0], c.start[1]);
  for (const seg of c.segments) {
    if (seg.type === 'line') {
      target.lineTo(seg.to[0], seg.to[1]);
    } else {
      // arc: 현재점→to, 반경 radius. absarc 근사(중심 계산 생략, 부드러운 근사).
      target.quadraticCurveTo(
        (target.currentPoint.x + seg.to[0]) / 2 + (seg.ccw ? -seg.radius : seg.radius) * 0.2,
        (target.currentPoint.y + seg.to[1]) / 2 + (seg.ccw ? -seg.radius : seg.radius) * 0.2,
        seg.to[0], seg.to[1],
      );
    }
  }
  if (c.closed) target.closePath();
}

export function buildShape(profile: Profile): Shape {
  const [outer, ...holes] = profile.contours;
  const shape = new Shape();
  applyContour(shape, outer);
  for (const h of holes) {
    const path = new Path();
    applyContour(path, h);
    shape.holes.push(path);
  }
  return shape;
}

export function computeBBox(profile: Profile, depth: number): { w: number; h: number; d: number } {
  const pts = contourPoints(profile.contours[0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    w: Math.round(Math.max(...xs) - Math.min(...xs)),
    h: Math.round(Math.max(...ys) - Math.min(...ys)),
    d: Math.round(depth),
  };
}

export function validateProfile(profile: Profile): string[] {
  const errs: string[] = [];
  const outer = profile.contours[0];
  if (!outer) { errs.push('외곽 단면이 없습니다.'); return errs; }
  const ptCount = 1 + outer.segments.length;
  if (ptCount < 3) errs.push('외곽 단면은 점이 3개 이상이어야 합니다.');
  if (!outer.closed) errs.push('외곽 단면이 닫히지 않았습니다.');
  return errs;
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd /c/workspace/HP3_admin && npm test`
Expected: PASS (7 tests).

- [ ] **Step 8: 커밋**

```bash
cd /c/workspace/HP3_admin && git add vitest.config.ts src/parts/types.ts src/parts/partGeometry.ts src/parts/partGeometry.test.ts package.json package-lock.json
git commit -m "feat(parts): 파츠 형상 로직 코어(buildShape/computeBBox/validateProfile) + vitest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 파츠 라이브러리 스토어 (localStorage 영속)

**Files:**
- Create: `src/parts/partStore.ts`
- Test: `src/parts/partStore.test.ts`

**Interfaces:**
- Consumes: `Part` from `./types`.
- Produces:
  - `loadParts(): Part[]` — localStorage `hp3-parts`에서 로드(없으면 []).
  - `saveParts(parts: Part[]): void` — 전체 저장.
  - `upsertPart(part: Part): Part[]` — id 기준 갱신/추가, 저장 후 목록 반환. `updatedAt` 갱신.
  - `deletePart(id: string): Part[]` — 삭제 후 목록 반환.
  - `newPart(name: string): Part` — 기본 사각형(600×720×18) 파츠 생성(id=`part-${timestamp}-${rand}`).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/parts/partStore.test.ts`:
```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd /c/workspace/HP3_admin && npm test src/parts/partStore.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: partStore 구현**

`src/parts/partStore.ts`:
```ts
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd /c/workspace/HP3_admin && npm test src/parts/partStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
cd /c/workspace/HP3_admin && git add src/parts/partStore.ts src/parts/partStore.test.ts
git commit -m "feat(parts): 파츠 라이브러리 스토어(localStorage CRUD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 3D 익스트루드 미리보기 (R3F)

**Files:**
- Create: `src/parts/ExtrudePreview.tsx`
- Modify: `package.json`, `package-lock.json` (deps: @react-three/fiber, @react-three/drei)

**Interfaces:**
- Consumes: `buildShape` from `./partGeometry`, `Profile` from `./types`.
- Produces: `ExtrudePreview` React 컴포넌트.
  - Props: `{ profile: Profile; depth: number; color?: string }`.
  - 동작: `buildShape(profile)`로 Shape 생성 → `ExtrudeGeometry(shape, { depth, bevelEnabled: false })` 렌더. OrbitControls로 회전/줌. 조명 포함.

- [ ] **Step 1: 의존성 설치**

Run:
```bash
cd /c/workspace/HP3_admin && npm install @react-three/fiber@^9.0.0 @react-three/drei@^10.0.0
```
Expected: `added` 로그. (three 0.184는 이미 설치됨 → peer 충돌 없어야 함. 충돌 시 `--legacy-peer-deps` 재시도.)

- [ ] **Step 2: ExtrudePreview 구현**

`src/parts/ExtrudePreview.tsx`:
```tsx
import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ExtrudeGeometry } from 'three';
import { buildShape } from './partGeometry';
import type { Profile } from './types';

function Mesh({ profile, depth, color }: { profile: Profile; depth: number; color: string }) {
  const geom = useMemo(() => {
    const shape = buildShape(profile);
    const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.center();
    return g;
  }, [profile, depth]);
  return (
    <mesh geometry={geom} scale={0.001 /* mm→m */}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

export function ExtrudePreview({ profile, depth, color = '#d8c5a8' }: { profile: Profile; depth: number; color?: string }) {
  return (
    <Canvas camera={{ position: [0.8, 0.8, 0.8], fov: 45 }} style={{ width: '100%', height: '100%', background: '#1a1c20' }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 3, 2]} intensity={1} />
      <Mesh profile={profile} depth={depth} color={color} />
      <OrbitControls makeDefault />
      <gridHelper args={[2, 20, '#444', '#2a2a2a']} />
    </Canvas>
  );
}
```

- [ ] **Step 3: 타입체크 통과 확인**

Run: `cd /c/workspace/HP3_admin && npx tsc --noEmit`
Expected: PASS(신규 파일 관련 에러 없음).

- [ ] **Step 4: 커밋**

```bash
cd /c/workspace/HP3_admin && git add src/parts/ExtrudePreview.tsx package.json package-lock.json
git commit -m "feat(parts): R3F 익스트루드 3D 미리보기 컴포넌트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 2D 단면 스케처 (SVG)

**Files:**
- Create: `src/parts/SketchCanvas.tsx`

**Interfaces:**
- Consumes: `Profile`, `Vec2`, `Contour` from `./types`.
- Produces: `SketchCanvas` React 컴포넌트.
  - Props: `{ profile: Profile; onChange: (p: Profile) => void; }`.
  - 동작: 외곽 컨투어의 정점(start + segment.to)을 SVG 원으로 표시, 드래그로 이동. 빈 곳 클릭 시 마지막 세그먼트 뒤에 점 추가(line). 점 우클릭/삭제 버튼으로 제거. 그리드 10mm 스냅. mm↔px 스케일(1px=1mm 기준, viewBox로 fit). 하단에 선택 점의 x/y 수치 입력 필드.
  - 좌표계: SVG y축은 아래로 증가하므로, 표시 시 y를 반전(수학 좌표=위로 +y).

- [ ] **Step 1: SketchCanvas 구현**

`src/parts/SketchCanvas.tsx`:
```tsx
import { useState } from 'react';
import type { Profile, Vec2 } from './types';

const SNAP = 10; // mm
const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** 외곽 컨투어의 정점 목록(start + 각 segment.to). 마지막이 start와 같으면(closePath 중복) 표시에서 제외. */
function outerPoints(profile: Profile): Vec2[] {
  const c = profile.contours[0];
  if (!c) return [];
  const pts: Vec2[] = [c.start, ...c.segments.map((s) => s.to)];
  // 닫힌 사각형의 마지막 반복점 제거(표시용)
  if (pts.length > 1) {
    const last = pts[pts.length - 1];
    if (last[0] === c.start[0] && last[1] === c.start[1]) pts.pop();
  }
  return pts;
}

/** 정점 목록으로 외곽 컨투어 재구성(항상 closed line 폴리곤). */
function rebuild(profile: Profile, pts: Vec2[]): Profile {
  const contour = {
    closed: true,
    start: pts[0],
    segments: [
      ...pts.slice(1).map((p) => ({ type: 'line' as const, to: p })),
      { type: 'line' as const, to: pts[0] },
    ],
  };
  return { ...profile, contours: [contour, ...profile.contours.slice(1)] };
}

export function SketchCanvas({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const pts = outerPoints(profile);
  const [sel, setSel] = useState<number | null>(null);

  const W = 800, H = 600, PAD = 40;
  // fit: 점 범위를 뷰에 맞춤
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(0, ...xs), maxX = Math.max(100, ...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(100, ...ys);
  const sx = (W - PAD * 2) / Math.max(1, maxX - minX);
  const sy = (H - PAD * 2) / Math.max(1, maxY - minY);
  const s = Math.min(sx, sy);
  const toPx = (p: Vec2): [number, number] => [PAD + (p[0] - minX) * s, H - PAD - (p[1] - minY) * s];
  const toMm = (px: number, py: number): Vec2 => [snap((px - PAD) / s + minX), snap((H - PAD - py) / s + minY)];

  const [drag, setDrag] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (drag == null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const m = toMm(e.clientX - rect.left, e.clientY - rect.top);
    const next = pts.map((p, i) => (i === drag ? m : p));
    onChange(rebuild(profile, next));
  };

  const addPoint = () => {
    // 마지막 점과 첫 점 중간에 추가
    const a = pts[pts.length - 1]; const b = pts[0];
    const mid: Vec2 = [snap((a[0] + b[0]) / 2), snap((a[1] + b[1]) / 2)];
    onChange(rebuild(profile, [...pts, mid]));
  };
  const delPoint = () => {
    if (sel == null || pts.length <= 3) return;
    onChange(rebuild(profile, pts.filter((_, i) => i !== sel)));
    setSel(null);
  };
  const editCoord = (axis: 0 | 1, v: number) => {
    if (sel == null) return;
    const next = pts.map((p, i) => (i === sel ? (axis === 0 ? [v, p[1]] : [p[0], v]) as Vec2 : p));
    onChange(rebuild(profile, next));
  };

  const poly = pts.map(toPx).map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <svg
        width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#f5f5f2', border: '1px solid #ccc', flex: 1 }}
        onMouseMove={onMove} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}
      >
        <polygon points={poly} fill="rgba(120,160,220,0.25)" stroke="#3a6" strokeWidth={2} />
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          return (
            <circle
              key={i} cx={x} cy={y} r={7}
              fill={sel === i ? '#e06' : '#36c'}
              onMouseDown={() => { setSel(i); setDrag(i); }}
              style={{ cursor: 'grab' }}
            />
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
        <button onClick={addPoint}>+ 점 추가</button>
        <button onClick={delPoint} disabled={sel == null || pts.length <= 3}>점 삭제</button>
        {sel != null && (
          <>
            <span>선택점 X(mm)</span>
            <input type="number" value={pts[sel][0]} style={{ width: 70 }}
              onChange={(e) => editCoord(0, Number(e.target.value))} />
            <span>Y(mm)</span>
            <input type="number" value={pts[sel][1]} style={{ width: 70 }}
              onChange={(e) => editCoord(1, Number(e.target.value))} />
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#888' }}>스냅 {SNAP}mm</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `cd /c/workspace/HP3_admin && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
cd /c/workspace/HP3_admin && git add src/parts/SketchCanvas.tsx
git commit -m "feat(parts): SVG 2D 단면 스케처(점 추가/이동/삭제, 그리드 스냅)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: PartEditor 페이지 셸 (툴바 + 좌우 조합 + 라이브러리 CRUD)

**Files:**
- Create: `src/pages/PartEditor.tsx`

**Interfaces:**
- Consumes: `SketchCanvas`, `ExtrudePreview`, `partStore`(loadParts/upsertPart/deletePart/newPart), `partGeometry`(computeBBox/validateProfile), `Part`/`Profile` types.
- Produces: `PartEditor` 기본 export 컴포넌트(props 없음).
  - 상단 툴바: 새 파츠 / 저장 / 이름 입력 / 파츠 목록(선택·복제·삭제).
  - 좌: SketchCanvas(profile 편집). 우: ExtrudePreview + 두께 입력 + 색상.
  - 저장 시 validateProfile로 검증, 오류 있으면 저장 차단 + 메시지. computeBBox로 bbox 갱신 후 upsertPart.

- [ ] **Step 1: PartEditor 구현**

`src/pages/PartEditor.tsx`:
```tsx
import { useState } from 'react';
import { SketchCanvas } from '../parts/SketchCanvas';
import { ExtrudePreview } from '../parts/ExtrudePreview';
import { loadParts, upsertPart, deletePart, newPart } from '../parts/partStore';
import { computeBBox, validateProfile } from '../parts/partGeometry';
import type { Part } from '../parts/types';

export function PartEditor() {
  const [parts, setParts] = useState<Part[]>(loadParts);
  const [cur, setCur] = useState<Part>(() => loadParts()[0] ?? newPart('새 파츠'));
  const [msg, setMsg] = useState<string>('');

  const patch = (p: Partial<Part>) => setCur((c) => ({ ...c, ...p }));

  const onNew = () => { const p = newPart('새 파츠'); setCur(p); setMsg(''); };
  const onSelect = (id: string) => { const p = parts.find((x) => x.id === id); if (p) { setCur(p); setMsg(''); } };
  const onSave = () => {
    const errs = validateProfile(cur.profile);
    if (errs.length) { setMsg('저장 불가: ' + errs.join(' ')); return; }
    const saved = { ...cur, bbox: computeBBox(cur.profile, cur.extrude.depth) };
    setParts(upsertPart(saved));
    setCur(saved);
    setMsg('저장됨');
  };
  const onDup = () => {
    const copy = { ...newPart(cur.name + ' 복제'), profile: cur.profile, extrude: cur.extrude, material: cur.material };
    setCur(copy);
  };
  const onDel = (id: string) => { setParts(deletePart(id)); if (cur.id === id) onNew(); };

  const errs = validateProfile(cur.profile);

  return (
    <main className="main">
      <div className="page-head"><h1>파츠 모델러</h1></div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 툴바 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onNew}>새 파츠</button>
          <input value={cur.name} onChange={(e) => patch({ name: e.target.value })} placeholder="파츠 이름" style={{ width: 160 }} />
          <button onClick={onSave}>저장</button>
          <button onClick={onDup}>복제</button>
          {msg && <span style={{ color: errs.length ? '#c33' : '#292', fontSize: '0.85rem' }}>{msg}</span>}
          <select onChange={(e) => e.target.value && onSelect(e.target.value)} value="" style={{ marginLeft: 'auto' }}>
            <option value="">— 저장된 파츠 불러오기 —</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.bbox.w}×{p.bbox.h}×{p.bbox.d})</option>)}
          </select>
        </div>

        {/* 좌우 분할 */}
        <div style={{ display: 'flex', gap: 12, minHeight: 620 }}>
          <div style={{ flex: 1 }}>
            <SketchCanvas profile={cur.profile} onChange={(profile) => patch({ profile })} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
              <span>두께(mm)</span>
              <input type="number" value={cur.extrude.depth} style={{ width: 80 }}
                onChange={(e) => patch({ extrude: { ...cur.extrude, depth: Number(e.target.value) } })} />
              <span>색상</span>
              <input type="color" value={cur.material?.color ?? '#d8c5a8'}
                onChange={(e) => patch({ material: { ...cur.material, color: e.target.value } })} />
              <span style={{ marginLeft: 'auto', color: '#888' }}>
                크기 {computeBBox(cur.profile, cur.extrude.depth).w}×{computeBBox(cur.profile, cur.extrude.depth).h}×{cur.extrude.depth}
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 560 }}>
              {errs.length === 0
                ? <ExtrudePreview profile={cur.profile} depth={cur.extrude.depth} color={cur.material?.color} />
                : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#c33' }}>{errs.join(' / ')}</div>}
            </div>
          </div>
        </div>

        {/* 라이브러리 삭제 목록 */}
        {parts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem' }}>
            {parts.map((p) => (
              <span key={p.id} style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 8px', display: 'inline-flex', gap: 6 }}>
                {p.name}
                <button onClick={() => onDel(p.id)} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
              </span>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 타입체크 통과 확인**

Run: `cd /c/workspace/HP3_admin && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: 커밋**

```bash
cd /c/workspace/HP3_admin && git add src/pages/PartEditor.tsx
git commit -m "feat(parts): PartEditor 페이지 셸(스케처+미리보기+라이브러리 CRUD)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 메뉴/라우팅 통합 + 버전 증가 + 수동 검증

**Files:**
- Modify: `src/config.ts`
- Modify: `src/App.tsx`
- Modify: `package.json`, `package-lock.json` (version)

**Interfaces:**
- Consumes: `PartEditor` from `../pages/PartEditor`.

- [ ] **Step 1: config.ts에 parts 메뉴 키 추가**

`src/config.ts`의 `ALL_ADMIN_MENU_KEYS` 배열에 `'parts'` 추가:
```ts
export const ALL_ADMIN_MENU_KEYS: MenuKey[] = [
  'dashboard', 'users', 'content-users', 'content', 'brands', 'drawings', 'floorplans', 'products', 'parts', 'design', 'settings',
];
```

`DEFAULT_SUBMENUS.content` 배열의 `...DEFAULT_PRODUCT_SUBMENUS` 뒤에 파츠 모델러 항목 추가:
```ts
  content: [
    { key: 'products', label: '상품 관리', visible: true },
    ...DEFAULT_PRODUCT_SUBMENUS,
    { key: 'parts', label: '파츠 모델러', visible: true },
  ],
```

`DEFAULT_ROLES`의 `role-operator` menus 배열에 `'parts'` 추가:
```ts
  { id: 'role-operator', name: '운영자', scope: 'admin', menus: ['dashboard', 'drawings', 'floorplans', 'content', 'products', 'parts', 'design'], builtin: true },
```

- [ ] **Step 2: App.tsx에 라우팅 분기 추가**

`src/App.tsx` import 구역에 추가:
```ts
import { PartEditor } from './pages/PartEditor';
```

switch 문 `case 'products':` 블록 뒤에 추가:
```ts
    case 'parts':
      content = <PartEditor />;
      break;
```

- [ ] **Step 3: 버전 0.0.1 증가**

`package.json`의 `"version"`을 현재값에서 patch +1 (예: 0.0.32 → 0.0.33). `package-lock.json`의 최상위 `"version"`과 `packages[""].version`도 동일하게 수정.

- [ ] **Step 4: 타입체크 + 테스트 + 빌드 확인**

Run:
```bash
cd /c/workspace/HP3_admin && npm test && npx tsc --noEmit && npm run build
```
Expected: 테스트 PASS(12), tsc PASS, build 성공.

- [ ] **Step 5: 수동 검증 (개발 서버)**

Run: `cd /c/workspace/HP3_admin && npm run dev:solo` (백그라운드)
확인:
1. 좌측 메뉴 "컨텐츠 관리 > 파츠 모델러" 노출.
2. 클릭 → PartEditor 표시, 기본 600×720 사각형 우측 3D에 렌더.
3. 스케처에서 점 드래그/추가/삭제 → 3D 실시간 반영.
4. 두께 변경 → 3D 두께 반영.
5. 이름 입력 후 저장 → 목록에 추가, 새로고침 후에도 유지(localStorage).
6. 열린 단면 만들면 저장 차단 메시지.
서버 종료.

- [ ] **Step 6: 커밋**

```bash
cd /c/workspace/HP3_admin && git add src/config.ts src/App.tsx package.json package-lock.json
git commit -m "feat(parts): 파츠 모델러 메뉴/라우팅 통합 + 버전 증가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 위치/렌더/저장(설계 1) → Task 3(R3F), Task 2(localStorage), Task 6(메뉴). ✓
- 데이터 모델(설계 2) → Task 1(types, method 필드 포함). ✓
- 화면 구성(설계 3) → Task 5(툴바+좌우). ✓
- 데이터 흐름 → Task 5(profile→geometry→bbox→저장). ✓
- 에러 처리(열린/점부족 차단) → Task 1(validateProfile) + Task 5(저장 차단·경고). ✓
- 테스트(node 단위) → Task 1·2(vitest). ✓
- 확장 훅(method 필드, export) → Task 1 타입. ✓ (조립 export 인터페이스는 후속 단계이므로 MVP 미포함 — 스펙과 일치.)

**미포함(스펙에서 후속으로 명시):** 원호 정밀 렌더(현재 근사), 구멍 UI 편집(데이터는 지원, SketchCanvas는 외곽만 편집 — 스펙 "구멍 추가" 언급 대비 부분 미달). → 보완: MVP는 외곽 편집 우선, 구멍 UI는 후속. 스펙의 "구멍 추가"는 데이터/렌더는 지원되나 UI 편집은 다음 단계로 명시.

**Placeholder scan:** 없음(모든 스텝 실제 코드 포함).

**Type consistency:** `Contour`에 `start: Vec2` 필드 사용 — types.ts 정의와 partGeometry/partStore/SketchCanvas 전부 일치. `buildShape`/`computeBBox`/`validateProfile` 시그니처 Task 1 정의와 이후 사용 일치. `newPart`/`upsertPart`/`deletePart`/`loadParts` 시그니처 Task 2 정의와 Task 5 사용 일치.