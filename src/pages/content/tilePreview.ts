import { PAVING } from '../../data/pavingData';
import { loadImage } from './decoUtil';

/**
 * 타일 상품 ‘효과 미리보기’ — 붙임 방식대로 타일을 깔아 본 그림.
 * 쿠지알러는 서버(deco_cms/api/tile/preview)에서 그리지만 HP3 는 브라우저 캔버스로 같은 정보를 그린다:
 * 타일 크기(mm)·줄눈 색·줄눈 폭(mm)·붙임 방식(일자·엇갈림·3·6·9·헤링본·바람개비·피시본 45/60°)·여러 면 이미지·맞춤 배열.
 */

export type PreviewOrder = { rows: number; cols: number; cells: (number | null)[] };
export type PreviewOpts = {
  L: number; W: number; gapColor: string; gapWidth: number; paving: number; angle?: 45 | 60;
  /** 맞춤 배열 — 행×열 칸마다 이미지 번호 (일자 붙임만) */
  order?: PreviewOrder | null;
};

const SEEDS = [0.13, 0.71, 0.42, 0.93, 0.27, 0.58, 0.05, 0.84, 0.36, 0.67];

/** 이미지 여러 장 → 미리보기 JPEG (정사각형 px) */
export async function pavingPreview(srcs: string[], o: PreviewOpts, px = 480): Promise<string> {
  const imgs = await Promise.all(srcs.map((s) => loadImage(s, !s.startsWith('data:')).catch(() => null)));
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  drawPaving(c.getContext('2d')!, px, imgs.filter((i): i is HTMLImageElement => !!i), o);
  return c.toDataURL('image/jpeg', 0.86);
}

/** 미리보기 범위(mm) — 타일이 가로로 4~5장쯤 보이게 */
export const previewArea = (L: number, W: number) => Math.min(25000, Math.max(600, Math.max(L, W) * 4.5));

export function drawPaving(g: CanvasRenderingContext2D, px: number, imgs: HTMLImageElement[], o: PreviewOpts) {
  const area = previewArea(o.L, o.W);
  const s = px / area; // px per mm
  const gap = Math.max(0, o.gapWidth) * s;
  const L = o.L * s, W = o.W * s;
  g.save();
  g.fillStyle = o.gapColor || '#999999';
  g.fillRect(0, 0, px, px);
  let n = 0;
  const pick = (i: number, j: number) => {
    if (!imgs.length) return null;
    if (o.order && o.paving === PAVING.STRAIGHT) {
      const { rows, cols, cells } = o.order;
      const k = cells[(((j % rows) + rows) % rows) * cols + (((i % cols) + cols) % cols)];
      return k == null ? null : imgs[k % imgs.length];
    }
    if (imgs.length === 1) return imgs[0];
    n++;
    return imgs[Math.floor(SEEDS[(n * 7 + i * 3 + j * 5) % SEEDS.length] * imgs.length) % imgs.length];
  };
  /** 직사각형 타일 하나 (회전 deg) — 줄눈만큼 안쪽으로 줄여 그린다 */
  const rect = (x: number, y: number, w: number, h: number, img: HTMLImageElement | null, rot = 0) => {
    const ix = x + gap / 2, iy = y + gap / 2, iw = Math.max(0.5, w - gap), ih = Math.max(0.5, h - gap);
    if (ix > px || iy > px || ix + iw < 0 || iy + ih < 0) return;
    g.save();
    g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
    if (img) {
      g.translate(ix + iw / 2, iy + ih / 2);
      g.rotate((rot * Math.PI) / 180);
      const sw = rot % 180 ? ih : iw, sh = rot % 180 ? iw : ih;
      g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
    } else { g.fillStyle = '#e6e6e6'; g.fillRect(ix, iy, iw, ih); }
    g.restore();
  };
  const pitchX = L + gap, pitchY = W + gap;
  switch (o.paving) {
    case PAVING.H:
    case PAVING.THREE: {
      const step = o.paving === PAVING.H ? 2 : 3;
      for (let j = 0; j * pitchY < px; j++) {
        const off = ((j % step) * pitchX) / step;
        for (let i = -1; i * pitchX - off < px; i++) rect(i * pitchX - off, j * pitchY, pitchX, pitchY, pick(i, j));
      }
      break;
    }
    case PAVING.ZIGZAG: {
      // 헤링본 — H(i,j) = (iW + jL, iW − jL), V(i,j) = H + (L, W − L)  (줄눈 포함 크기)
      const a = pitchX, b = pitchY;
      const R = Math.ceil(px / Math.min(a, b)) + 4;
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const hx = i * b + j * a, hy = i * b - j * a;
        rect(hx, hy, a, b, pick(i, j));
        rect(hx + a, hy + b - a, b, a, pick(j, i), 90);
      }
      break;
    }
    case PAVING.VORTEX: {
      // 바람개비 — 정사각형 2×2 마다 무늬를 0·90·270·180° 로 돌린다
      const rots = [0, 90, 270, 180];
      for (let j = 0; j * pitchY < px; j++) for (let i = 0; i * pitchX < px; i++) rect(i * pitchX, j * pitchY, pitchX, pitchY, pick(i, j), rots[(i % 2) + 2 * (j % 2)]);
      break;
    }
    case PAVING.FISHBONE: {
      // 피시본 — 긴 변이 기울기 angle 인 평행사변형을 열마다 좌우 반대로
      const ang = ((o.angle ?? 45) * Math.PI) / 180;
      const colW = pitchX * Math.cos(ang), stepY = pitchY / Math.cos(ang), rise = pitchX * Math.sin(ang);
      for (let c = 0; c * colW < px + colW; c++) {
        const dir = c % 2 ? -1 : 1;
        const x0 = c * colW;
        for (let k = -Math.ceil(rise / stepY) - 1; k * stepY < px + rise; k++) {
          const y0 = k * stepY;
          const img = pick(c, k);
          const pts: [number, number][] = dir > 0
            ? [[x0, y0 + rise], [x0 + colW, y0], [x0 + colW, y0 + stepY], [x0, y0 + rise + stepY]]
            : [[x0, y0], [x0 + colW, y0 + rise], [x0 + colW, y0 + rise + stepY], [x0, y0 + stepY]];
          g.save();
          g.beginPath(); pts.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
          g.clip();
          // 줄눈: 테두리를 줄눈 색으로 덧그림
          if (img) {
            // 평행사변형은 끝이 세로로 잘려 같은 폭의 직사각형보다 양 끝이 pitchY·tan 만큼 길다 — 그만큼 늘여 그리고 모양대로 자른다
            const ext = pitchX + 2 * pitchY * Math.tan(ang);
            g.translate(x0 + colW / 2, y0 + (rise + stepY) / 2);
            g.rotate(-dir * ang);
            g.drawImage(img, -ext / 2, -pitchY / 2, ext, pitchY);
          } else { g.fillStyle = '#e6e6e6'; g.fill(); }
          g.restore();
          if (gap > 0) { g.save(); g.strokeStyle = o.gapColor; g.lineWidth = gap; g.beginPath(); pts.forEach(([x, y], q) => (q ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); g.restore(); }
        }
      }
      break;
    }
    default:
      for (let j = 0; j * pitchY < px; j++) for (let i = 0; i * pitchX < px; i++) rect(i * pitchX, j * pitchY, pitchX, pitchY, pick(i, j));
  }
  g.restore();
}
