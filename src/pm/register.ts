import { putAsset } from '../data/assetStore';
import { findModelItem, libName, loadContentState, newId, saveContentState, upsertModelItem } from '../data/contentLibrary';
import type { ModelResult } from './link';

/**
 * 저장 후 입고(에디터 메뉴에서 직접 연 경우) — 컨텐츠 라이브러리 저장본에 상품을 만들거나 갱신한다.
 * 모델 유형 선택에서 고른 소재 라이브러리의 ‘미분류’ 폴더로, 이미 입고한 모델이면 이미지·크기·3D 만 갱신.
 * 컨텐츠 라이브러리 화면에서 연 경우에는 그 화면이 직접 반영한다(onRegister).
 */
export async function registerToLibrary(r: ModelResult, userName: string): Promise<string> {
  if (r.lib == null) throw new Error('모델 유형(소속 라이브러리)이 없습니다 — 모델 속성에서 ‘변경’으로 고르세요');
  const loaded = await loadContentState();
  const s = { ...loaded, activeLibrary: 'main' };
  const ex = findModelItem(s, r.id);
  const asset = r.glb ? (ex?.model3d?.asset ?? newId('GLB')) : ex?.model3d?.asset;
  if (r.glb && asset) await putAsset(asset, r.glb);
  const res = upsertModelItem(s, { id: r.id, name: r.name, lib: r.lib, categoryId: r.categoryId, category: r.category, thumb: r.thumb, bbox: r.bbox, asset }, userName);
  saveContentState({ ...res.state, activeLibrary: loaded.activeLibrary });
  return res.created
    ? `‘${r.name}’을(를) 컨텐츠 라이브러리 › ${libName(r.lib)} › 미분류에 입고했습니다`
    : `컨텐츠 라이브러리의 ‘${res.item.name}’ 상품을 갱신했습니다`;
}
