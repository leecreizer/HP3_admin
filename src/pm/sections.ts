import type { ProfileShape } from '../data/contentLibrary';
import { parseLinePath, stringifyLinePath } from './path';
import { polyOf } from './geometry';
import { PmEval } from './resolve';
import { newModel } from './store';
import type { PathLine, PathPoint, PmModel, PmNode, PmPath } from './types';

/**
 * 단면 그리기 — CAD(DXF) 없이 몰딩 단면을 바로 만든다.
 * 윤곽 편집기(2D 윤곽 편집)로 닫힌 경로를 그리고, 저장하면 꺾은선(원호·둥근 모서리·모따기 펼침)을 왼쪽 아래 (0,0) 기준 mm 단면으로 바꾼다.
 * 단면 템플릿은 몰딩에서 흔한 모양을 숫자(mm)로 바로 그린다 — HP3 기능(쿠지알러 线条轮廓 업로드는 DXF 만 받음).
 */

export type SectionField = { k: string; label: string; v: number };
export type SectionTpl = { key: string; name: string; desc: string; fields: SectionField[]; build: (f: Record<string, number>) => PmPath };

const n = (v: number) => String(Math.round(v * 100) / 100);
const pt = (x: number, y: number, extra?: Partial<PathPoint>): PathPoint => ({ x: n(x), y: n(y), type: 0, ...extra });
const straight: PathLine = { type: 0 };
const closedPath = (points: PathPoint[], lines?: PathLine[]): PmPath => ({ points, lines: lines ?? points.map(() => straight), closed: true });

export const SECTION_TEMPLATES: SectionTpl[] = [
  { key: 'rect', name: '사각형', desc: '폭 × 높이 각재', fields: [{ k: 'W', label: '폭', v: 30 }, { k: 'H', label: '높이', v: 20 }],
    build: ({ W, H }) => closedPath([pt(0, 0), pt(W, 0), pt(W, H), pt(0, H)]) },
  { key: 'skirt', name: '걸레받이', desc: '두께 × 높이, 윗모서리 둥글게', fields: [{ k: 'W', label: '두께', v: 15 }, { k: 'H', label: '높이', v: 80 }, { k: 'R', label: '윗모서리 반지름', v: 5 }],
    build: ({ W, H, R }) => closedPath([pt(0, 0), pt(W, 0), pt(W, H, R > 0 ? { type: 1, radius: n(R) } : undefined), pt(0, H)]) },
  { key: 'chamfer', name: '모따기 판', desc: '두께 × 높이, 윗모서리 모따기', fields: [{ k: 'W', label: '두께', v: 18 }, { k: 'H', label: '높이', v: 60 }, { k: 'C', label: '모따기', v: 6 }],
    build: ({ W, H, C }) => closedPath([pt(0, 0), pt(W, 0), pt(W, H, C > 0 ? { type: 2, chamferA: n(C), chamferB: n(C) } : undefined), pt(0, H)]) },
  { key: 'angle', name: 'L자 몰딩', desc: '가로 × 세로, 두께', fields: [{ k: 'W', label: '가로', v: 30 }, { k: 'H', label: '세로', v: 30 }, { k: 'T', label: '두께', v: 6 }],
    build: ({ W, H, T }) => closedPath([pt(0, 0), pt(W, 0), pt(W, T), pt(T, T), pt(T, H), pt(0, H)]) },
  { key: 'step', name: '계단형 몰딩', desc: '폭 × 높이를 두 단으로', fields: [{ k: 'W', label: '폭', v: 40 }, { k: 'H', label: '높이', v: 40 }],
    build: ({ W, H }) => closedPath([pt(0, 0), pt(W, 0), pt(W, H / 2), pt(W / 2, H / 2), pt(W / 2, H), pt(0, H)]) },
  { key: 'quarter', name: '사분원 몰딩', desc: '반지름 R 의 1/4 원', fields: [{ k: 'R', label: '반지름', v: 20 }],
    build: ({ R }) => closedPath([pt(0, 0), pt(R, 0), pt(0, R)], [straight, { type: 1, radius: n(R), clockwise: false, minor: true }, straight]) },
  { key: 'cove', name: '오목 몰딩(코브)', desc: '폭 × 높이, 바깥을 오목하게 깎은 천장 몰딩', fields: [{ k: 'W', label: '폭', v: 60 }, { k: 'H', label: '높이', v: 60 }, { k: 'T', label: '남김 두께', v: 10 }],
    build: ({ W, H, T }) => {
      const c = Math.hypot(W - T, H - T);
      return closedPath([pt(0, 0), pt(W, 0), pt(W, T), pt(T, H), pt(0, H)], [straight, straight, { type: 1, radius: n(c / Math.SQRT2), clockwise: true, minor: true }, straight, straight]);
    } },
];

/** 단면 그리기용 빈 모델·노드 — 윤곽 편집기가 쓰는 계산기(PmEval)를 그대로 쓰려고 */
export function sectionContext(path: string): { model: PmModel; node: PmNode; ev: PmEval } {
  const node: PmNode = { id: 'section', def: 'PrimitiveModel.lofting', name: '단면', params: { section: path } };
  const model: PmModel = { ...newModel({ tooltype: 'cabinet', library: '', category: '', name: '단면 그리기' }), nodes: [node] };
  return { model, node, ev: new PmEval(model) };
}

/** 단면 경로의 시작값 — 그린 경로가 있으면 그대로, DXF 단면이면 점을 직선으로 이어서, 없으면 사각형 30×20 */
export function sectionStartPath(init?: { path?: string; points?: [number, number][] }): string {
  if (init?.path) return init.path;
  if (init?.points?.length) return stringifyLinePath(closedPath(init.points.map(([x, y]) => pt(x, y))));
  return stringifyLinePath(SECTION_TEMPLATES[0].build({ W: 30, H: 20 }));
}

const area = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

/** 그린 경로 → 몰딩 단면 (왼쪽 아래 (0,0), 반시계, 0.01 mm). 점이 3개 미만이거나 넓이가 없으면 오류 */
export function sectionShape(path: string): ProfileShape {
  const { node, ev } = sectionContext(path);
  const p = parseLinePath(path, true);
  if (!p.closed) throw new Error('단면은 닫힌 경로여야 합니다');
  const poly = polyOf(ev.numPath(node, p, '단면'));
  if (poly.length < 3 || poly.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) throw new Error('단면 점을 계산하지 못했습니다 — 좌표가 숫자인지, 원호·둥근 모서리가 들어갈 길이가 되는지 확인하세요');
  let pts = poly.map(([x, y]) => [x, y] as [number, number]);
  if (Math.abs(area(pts)) < 1e-6) throw new Error('단면 넓이가 0 입니다 — 점을 세 개 이상 다른 자리에 두세요');
  if (area(pts) < 0) pts = pts.reverse();
  const minX = Math.min(...pts.map((q) => q[0])), minY = Math.min(...pts.map((q) => q[1]));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const points = pts.map(([x, y]) => [r2(x - minX), r2(y - minY)] as [number, number]);
  return { w: r2(Math.max(...points.map((q) => q[0]))), h: r2(Math.max(...points.map((q) => q[1]))), points, path };
}
