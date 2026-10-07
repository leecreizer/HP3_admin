import type { Item } from '../../../data/contentLibrary';
import { PV_TYPES, type PvScheme, type PvSprite } from '../../../data/paving';
import { itemLW } from '../decoUtil';
import { schemeScope, type V2 } from './pavingGeom';

/** 편집기 저장 결과 */
export type PavingSave = { scheme: PvScheme; name: string; folder: string; thumb: string; asNew: boolean; id?: string };

/** 저장 결과 → 상품 필드 (모델 크기 = 캔버스, 렌더 분류 = 방안 유형) */
export function pavingItemPatch(r: PavingSave): Partial<Item> {
  const sc = schemeScope(r.scheme);
  const t = PV_TYPES.find((x) => x.v === r.scheme.type)!;
  return { name: r.name, img: r.thumb, paving: r.scheme, modelSize: `${sc.BBW}x${sc.BBH}(mm)`, renderCat: `파라메트릭 방안(${t.name})`, ...(r.folder ? { folder: r.folder } : {}) };
}

/** 상품 → 소재 (크기 mm 가 있는 것만) */
export function toSprite(i: Item, weight = 1): PvSprite | null {
  const lw = itemLW(i);
  return lw ? { id: i.id, name: i.name, img: i.img, w: lw[0], h: lw[1], weight } : null;
}

/** 시스템·함수 이름 — 매개변수 참조명으로 못 씀 */
export const RESERVED = ['BBW', 'BBH', 'POSX', 'POSY', 'INF', 'sin', 'cos', 'tan', 'sqrt', 'abs', 'round', 'floor', 'ceil', 'pow', 'min', 'max'];

/** 선분 교차 (끝점 접촉 제외) */
function segX(a: V2, b: V2, c: V2, d: V2) {
  const o = (p: V2, q: V2, r: V2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** 사용자 정의 모양 검사 — 쿠지알러: 3점 미만·두 점 겹침·윤곽 교차 불가 */
export function validateShape(pts: V2[]): string | null {
  if (pts.length < 3) return '점이 세 개보다 적어 모양을 만들 수 없습니다 — 다시 편집하세요';
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 1e-6) return '두 점이 겹칩니다 — 다시 편집하세요';
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segX(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return '윤곽선이 서로 교차합니다 — 다시 편집하세요'; }
  return null;
}
