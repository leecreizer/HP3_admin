import { loadImage } from './decoUtil';

/**
 * 비정형 상품(쿠지알러 异型产品上传) 형상 — 쿠지알러 형상 창의 겹침 그림(AllotypetileCropper·StarMask·RadiusMask) 공식을 그대로 옮겼다.
 * 좌표는 mm, 왼쪽 위 원점·아래 +y.
 *  hexagon 정육각형(좌우가 뾰족) — 길이 L = 꼭짓점 사이, 폭은 L·√3/2 로 정해진다
 *  star    네 꼭지 별 — 길이 L = 꼭지 사이 변 길이(마름모 한 변), 상자는 L·√2 정사각형.
 *          변마다 꼭지에서 ‘직선 변’만큼 곧게 나간 뒤 가운데는 ‘호 높이’만큼 안으로 오목한 호
 *  radius  둥근 모서리 사각 — 길이 L 정사각형에서 네 모서리를 ‘짝 맞는 작은 타일’(변 길이 s 의 네 꼭지 별) 몫만큼 깎는다.
 *          깎인 선은 끝마다 직선 변, 가운데는 모서리 쪽으로 볼록한 호(작은 별의 오목한 변과 맞물림)
 *  custom  CAD(DXF) 단일 닫힌 영역 (선·원호)
 */

export type Pt = [number, number];
export type ShapeKind = 'hexagon' | 'star' | 'radius' | 'custom';
/** 형상 매개변수 (mm) — straight 직선 변 · arc 호 높이 · side 짝 맞는 작은 타일 변 길이(둥근 사각만) */
export type ShapeParams = { straight: number; arc: number; side: number };

export const SHAPE_NAME: Record<ShapeKind, string> = { hexagon: '육각형', star: '네 꼭지 별', radius: '둥근 모서리 사각', custom: '사용자 정의' };

/** 현 P→Q 를 C 쪽(toward)으로 sagitta h 만큼 휜 원호 — P 제외·Q 포함 */
function sagArc(P: Pt, Q: Pt, C: Pt, h: number, n = 18): Pt[] {
  const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
  const half = Math.hypot(Q[0] - P[0], Q[1] - P[1]) / 2;
  if (h <= 1e-9 || half <= 1e-9) return [Q];
  let nx = C[0] - mx, ny = C[1] - my;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len; ny /= len;
  // 반지름 r = half²/2h + h/2 (쿠지알러 R*R/2/A + A/2), 원 중심은 휜 쪽의 반대편
  const r = (half * half) / (2 * h) + h / 2;
  const cx = mx - nx * (r - h), cy = my - ny * (r - h);
  const a0 = Math.atan2(P[1] - cy, P[0] - cx), a1 = Math.atan2(Q[1] - cy, Q[0] - cx), am = Math.atan2(ny, nx);
  // 호의 가운데(am)를 지나는 쪽으로 돈다 — 호 높이가 현의 절반보다 크면 반원보다 긴 호(쿠지알러 large-arc)
  const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= Math.PI * 2;
  return Array.from({ length: n }, (_, k) => { const t = a0 + (sweep * (k + 1)) / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as Pt; });
}

/** 실제 상품 크기 (쿠지알러 calcuSize) — 육각형 폭 = L·√3/2, 별 = L·√2 정사각형, 둥근 사각 = L 정사각형, 사용자 정의 = 입력값(또는 CAD 원래 크기) */
export function shapedSize(kind: ShapeKind, L: number, W: number): [number, number] {
  if (kind === 'hexagon') return [L, (L * Math.sqrt(3)) / 2];
  if (kind === 'star') return [L * Math.SQRT2, L * Math.SQRT2];
  if (kind === 'radius') return [L, L];
  return [L, W];
}

/** 형상 윤곽 (mm, 상자 shapedSize 안). custom 은 0–1 로 맞춘 CAD 윤곽(위 원점)을 상자에 늘인다 */
export function shapeOutline(kind: ShapeKind, L: number, W: number, p: ShapeParams, custom?: Pt[]): Pt[] {
  const [bw, bh] = shapedSize(kind, L, W);
  if (kind === 'hexagon') return [[0, bh / 2], [bw / 4, 0], [(3 * bw) / 4, 0], [bw, bh / 2], [(3 * bw) / 4, bh], [bw / 4, bh]];
  if (kind === 'star') {
    const B = bw, I = B / 2, J = p.straight / Math.SQRT2, C: Pt = [I, I];
    const tips: Pt[] = [[I, 0], [B, I], [I, B], [0, I]];
    const out: Pt[] = [];
    tips.forEach((t, i) => {
      const n = tips[(i + 1) % 4];
      const ux = Math.sign(n[0] - t[0]), uy = Math.sign(n[1] - t[1]);
      const a: Pt = [t[0] + ux * J, t[1] + uy * J], b: Pt = [n[0] - ux * J, n[1] - uy * J];
      out.push(t, a, ...sagArc(a, b, C, p.arc).slice(0, -1), b);
    });
    return out;
  }
  if (kind === 'radius') {
    const A = p.side / Math.SQRT2, U = p.straight / Math.SQRT2;
    // 모서리마다 [모서리 점, 변 위 두 끝]: 위→오른쪽→아래→왼쪽 순서로 돈다
    const corners: { c: Pt; a: Pt; b: Pt; ia: Pt; ib: Pt }[] = [
      { c: [L, 0], a: [L - A, 0], b: [L, A], ia: [L - A + U, U], ib: [L - U, A - U] },
      { c: [L, L], a: [L, L - A], b: [L - A, L], ia: [L - U, L - A + U], ib: [L - A + U, L - U] },
      { c: [0, L], a: [A, L], b: [0, L - A], ia: [A - U, L - U], ib: [U, L - A + U] },
      { c: [0, 0], a: [0, A], b: [A, 0], ia: [U, A - U], ib: [A - U, U] },
    ];
    const out: Pt[] = [];
    for (const k of corners) out.push(k.a, k.ia, ...sagArc(k.ia, k.ib, k.c, p.arc).slice(0, -1), k.ib, k.b);
    return out;
  }
  if (custom?.length) return custom.map(([x, y]) => [x * bw, y * bh] as Pt);
  return [[0, 0], [bw, 0], [bw, bh], [0, bh]];
}

/**
 * 매개변수 입력 검사 — 쿠지알러 그대로: 범위를 넘으면 알림 뒤 값을 고친다.
 *  별: 직선 변·호 높이 ≥ L/2 → ceil(L/2−1)  ·  작은 타일 변 > L/√2 → int(L/2·√2)  ·  둥근 사각 직선 변·호 높이 ≥ 작은 타일 변/2 → ceil(변/2−1)
 * 쿠지알러는 둥근 사각의 호 높이를 넘겨도 ‘직선 변은…’ 문구를 띄운다(같게 옮김).
 */
const half = (v: number, len: number) => (v >= len / 2 ? Math.ceil(len / 2 > 1 ? len / 2 - 1 : 0) : v);
export const fixStar = (v: number, L: number) => half(v, L);
export const fixSide = (v: number, L: number) => (v > L / Math.SQRT2 ? parseInt(String((L / 2) * Math.SQRT2), 10) : v);
export const fixSmall = (v: number, side: number) => half(v, side);
/** 처음 값 — 별 직선 5·호 10, 둥근 사각 작은 타일 68·직선 5·호 10 을 L 에 맞춰 고친 값 */
export function defaultParams(L: number): { star: ShapeParams; radius: ShapeParams } {
  const side = fixSide(68, L);
  return { star: { straight: fixStar(5, L), arc: fixStar(10, L), side }, radius: { straight: fixSmall(5, side), arc: fixSmall(10, side), side } };
}

/** 효과 미리보기 — 형상 타일을 줄눈 간격으로 깔아 본다(육각형 벌집, 나머지 격자). 쿠지알러는 서버 렌더라 HP3 는 캔버스로 그린다 */
export async function shapedPreview(faces: string[], outline: Pt[], size: [number, number], gapColor: string, gap: number, kind: ShapeKind, px = 480): Promise<string> {
  const imgs = (await Promise.all(faces.map((f) => loadImage(f).catch(() => null)))).filter((i): i is HTMLImageElement => !!i);
  const [bw, bh] = size;
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  const g = c.getContext('2d')!;
  g.fillStyle = gapColor; g.fillRect(0, 0, px, px);
  const k = px / (Math.max(bw, bh) * 3.2);
  const path = new Path2D();
  outline.forEach(([x, y], i) => (i ? path.lineTo(x * k, y * k) : path.moveTo(x * k, y * k)));
  path.closePath();
  const tile = (x: number, y: number, n: number) => {
    g.save();
    g.translate(x, y);
    g.clip(path);
    const im = imgs.length ? imgs[n % imgs.length] : null;
    if (im) g.drawImage(im, 0, 0, bw * k, bh * k); else { g.fillStyle = '#e6e6e6'; g.fill(path); }
    g.restore();
  };
  let n = 0;
  if (kind === 'hexagon') {
    // 이웃 육각형 사이 줄눈 폭이 gap 이 되도록: 열 간격 3L/4 + gap·√3/2, 행 간격 W + gap
    const sx = ((3 * bw) / 4 + (gap * Math.sqrt(3)) / 2) * k, sy = (bh + gap) * k;
    for (let col = -1; col * sx < px; col++) for (let row = -1; row * sy < px + sy; row++) tile(col * sx, row * sy + (Math.abs(col) % 2 ? sy / 2 : 0), n++);
  } else {
    const sx = (bw + gap) * k, sy = (bh + gap) * k;
    const ox = (px - Math.ceil(px / sx) * sx) / 2, oy = (px - Math.ceil(px / sy) * sy) / 2;
    for (let row = -1; oy + row * sy < px; row++) for (let col = -1; ox + col * sx < px; col++) tile(ox + col * sx, oy + row * sy, n++);
  }
  return c.toDataURL('image/png');
}

/** 형상 상자 비율(가로/세로) — 쿠지알러 자르기 틀: 육각형 2:√3, 별·둥근 사각 1:1, 사용자 정의는 CAD 상자 */
export function boxAspect(kind: ShapeKind, cad?: { w: number; h: number }): number {
  if (kind === 'hexagon') return 2 / Math.sqrt(3);
  if (kind === 'custom' && cad && cad.w > 0 && cad.h > 0) return cad.w / cad.h;
  return 1;
}
