import materialCategories from '../../data/materialCategories.json';
import type { CascOption } from './decoWidgets';

/**
 * 쿠지알러 ‘실시간 재질 분류’(实时材质分类) — 대분류 18개 › 재질 289종 (타일·비정형 상품의 재질 고르기).
 * 재질마다 재질 공 아이콘 = 장면 렌더(sceneImage)를 26px 로 채워 자른 것 (쿠지알러 단계식 고르기와 같은 주소 규칙)
 */
type MatGroup = { name: string; zh: string; items: { id: string; name: string; zh: string; img?: string }[] };
export const MAT_GROUPS = materialCategories as MatGroup[];
const ball = (src?: string) => (src ? `${src}?x-oss-process=image/resize,m_fill,w_26,h_26/format,webp` : undefined);
export const MAT_OPTIONS: CascOption[] = MAT_GROUPS.map((g) => ({ value: g.zh, label: g.name, title: g.zh, children: g.items.map((m) => ({ value: m.id, label: m.name, title: m.zh, img: ball(m.img) })) }));

/** 재질 id → [대분류 원문, 재질 id] (실시간 재질 제작 도구에서 템플릿을 바꿨을 때) */
export function matPathOf(id: string): [string, string] | null {
  const g = MAT_GROUPS.find((x) => x.items.some((i) => i.id === id));
  return g ? [g.zh, id] : null;
}

/** [대분류, 재질] → ‘대분류/재질’ (없으면 빈 문자열) */
export function matPathName(mat: string[]): string {
  const g = MAT_GROUPS.find((x) => x.zh === mat[0]);
  const m = g?.items.find((x) => x.id === mat[1]);
  return g && m ? `${g.name}/${m.name}` : '';
}
