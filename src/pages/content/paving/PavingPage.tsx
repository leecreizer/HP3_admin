import { itemsOf } from '../../../data/contentLibrary';
import type { PageProps } from '../createTypes';
import { PavingEditor } from './PavingEditor';
import { pavingItemPatch } from './pavingUtil';

/** 타일·바닥 › 파라메트릭 편집기 카드 — 새 방안. 첫 저장은 새 상품, 그다음 저장은 그 상품을 고친다 */
export function PavingPage({ st, portal, onClose, onCreate, onUpdate }: PageProps) {
  const lib = portal.lib ?? 5;
  const trees = st.trees[st.activeLibrary] ?? {};
  const items = itemsOf(st).filter((i) => i.lib === 4 && !i.deletedAt);
  return (
    <PavingEditor tiles={{ tree: trees[4] ?? [], items }} saveTree={trees[lib] ?? []} onClose={onClose}
      onSave={(r) => {
        const patch = pavingItemPatch(r);
        if (r.id && !r.asNew && onUpdate) { onUpdate(r.id, patch, '파라메트릭 편집기: 방안 저장'); return r.id; }
        return onCreate([{ ...patch, name: r.name, lib }], `‘${r.name}’ 파라메트릭 방안을 만들었습니다`, { keep: true })[0];
      }} />
  );
}
