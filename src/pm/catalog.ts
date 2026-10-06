import { BIZ_TABS, type ContentState, type Item } from '../data/contentLibrary';
import type { ToolType } from './modelTypes';
import type { Catalog, V3 } from './resolve';
import { loadGlobals, loadModels } from './store';

/**
 * 새 에디터가 읽는 상품 — 컨텐츠 라이브러리(재질 · 몰딩 단면 · 3D 모델)와 새 에디터 모델 저장소.
 * 쿠지알러에서는 재질·윤곽·스타일 변수가 기업 상품 라이브러리 상품을 가리킨다. HP3 는 컨텐츠 라이브러리 상품 id.
 */

/** 도구 종류 → 컨텐츠 라이브러리 업무 탭 */
export const TOOL_TAB: Record<ToolType, string> = { cabinet: 'customcabinet', wardrobe: 'customwardrobe', doorwindow: 'customdoorwindow', arch: 'zhuduowei' };

const libsNamed = (tab: string | undefined, word: string) =>
  BIZ_TABS.filter((t) => !tab || t.key === tab || t.key === 'general').flatMap((t) => t.libs.filter((l) => l.name.includes(word)).map((l) => l.lib));

/** 재질 라이브러리 번호 (도구 종류 탭 + 모델/재질 탭) */
export const materialLibs = (tool?: ToolType) => libsNamed(tool ? TOOL_TAB[tool] : undefined, '재질');
/** 몰딩(단면) 라이브러리 번호 */
export const profileLibs = (tool?: ToolType) => [...libsNamed(tool ? TOOL_TAB[tool] : undefined, '몰딩'), 7];

export function allItems(s: ContentState | null): Item[] {
  if (!s) return [];
  return [...s.items, ...Object.values(s.extraItems).flat()].filter((i) => !i.deletedAt);
}

const sizeOf = (i: Item): V3 | undefined => {
  const m = /([\d.]+)\s*X\s*([\d.]+)\s*X\s*([\d.]+)/i.exec(i.modelSize || i.size || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

export function makeCatalog(content: ContentState | null): Catalog {
  const items = allItems(content);
  const byId = new Map(items.map((i) => [i.id, i]));
  const models = loadModels();
  const globals = loadGlobals();
  return {
    product: (id) => {
      const i = byId.get(id);
      if (!i) return undefined;
      // 사용자 정의 필드: 필드 id → 값. 수식에서는 필드 이름으로도 찾게 둘 다 넣는다
      const custom: Record<string, string> = { ...(i.custom ?? {}) };
      for (const f of content?.customFields ?? []) if (i.custom?.[f.id] != null) custom[f.name] = i.custom[f.id];
      return { name: i.name, code: i.code, model: i.model, customcode: custom.customcode ?? '', custom, texture: i.img?.startsWith('data:') ? i.img : undefined };
    },
    profile: (id) => {
      const i = byId.get(id);
      return i?.profile ? { name: i.name, w: i.profile.w, h: i.profile.h, points: i.profile.points } : undefined;
    },
    model: (id) => models.find((m) => m.id === id),
    mesh: (id) => {
      const i = byId.get(id);
      if (!i) return undefined;
      return { name: i.name, asset: i.model3d?.kind === 'glb' ? i.model3d.asset : i.model3d?.asset, size: sizeOf(i) };
    },
    globals: () => globals,
  };
}
