import { walkFolders, type Folder, type Item } from '../../data/contentLibrary';

/**
 * 쿠지알러 꾸밈 소재 업로드 화면(decoration-cms 의 혼합 재질·타일 등) 공통 규칙.
 * 문구·범위는 쿠지알러 화면 번들(PageDataValidator·SizeInput)을 그대로 옮긴 것.
 */

export const MB = 1024 * 1024;

/** 크기 칸 입력 중 검사 — 빈 칸은 넘어가고, 숫자가 아니거나 범위 밖이면 칸 아래 문구 */
export function liveSizeMsg(vals: string[], min = 10, max = 5000): string {
  for (const v of vals) {
    const t = v.trim();
    if (!t) continue;
    if (Number.isNaN(Number(t))) return '숫자를 입력하세요';
    const n = parseInt(t, 10);
    if (n > max || n < min) return `설정한 길이·폭은 ${min}-${max} 안이어야 합니다`;
  }
  return '';
}

/** 제출 때 크기 검사 — 둘 다 비면 ‘소재 크기를 입력하세요’, 하나라도 틀리면 범위 안내 */
export function submitSizeMsg(vals: string[], min = 10, max = 5000): string {
  if (vals.every((v) => !v.trim())) return '소재 크기를 입력하세요';
  const bad = vals.some((v) => { const n = parseInt(v.trim(), 10); return Number.isNaN(n) || Number.isNaN(Number(v.trim())) || n < min || n > max; });
  return bad ? `크기 길이·폭은 ${min}-${max}mm 사이여야 합니다` : '';
}

/** 소재 이름 검사 (쿠지알러: 비면 안 되고 128자 이하) */
export function nameMsg(name: string): string {
  if (!name.trim()) return '소재 이름을 입력하세요';
  if (name.length > 128) return '소재 이름은 128자를 넘을 수 없습니다';
  return '';
}

/** 폴더 id → 이름 경로 ‘상위/하위’ */
export function folderPathName(tree: Folder[], id: string): string {
  let out = '';
  walkFolders(tree, (f, path) => { if (f.id === id) out = [...path, f].map((x) => x.name).join('/'); });
  return out;
}

/** 폴더와 그 하위 폴더 id 모두 */
export function subtreeIds(tree: Folder[], id: string): Set<string> {
  const ids = new Set<string>();
  walkFolders(tree, (f, path) => { if (f.id === id || path.some((p) => p.id === id)) ids.add(f.id); });
  return ids;
}

/** 상품의 길이·폭(mm) — 모델 크기 ‘L X W X H mm’ 또는 상품 크기에서 앞의 두 수 */
export function itemLW(i: Pick<Item, 'modelSize' | 'size'>): [number, number] | null {
  const m = (i.modelSize || i.size || '').match(/(\d+(?:\.\d+)?)\s*[Xx×*]\s*(\d+(?:\.\d+)?)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** 파일 → 이미지 요소 (크기 확인·합성용) */
export function loadImage(src: string, cors = false): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다'));
    img.src = src;
  });
}

export function readDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(new Error('파일을 읽을 수 없습니다')); r.readAsDataURL(f); });
}

/**
 * 혼합 재질 미리보기 — 마스크를 길이×폭 비율로 늘이고, 어두운 곳은 검은 영역 재질, 밝은 곳은 흰 영역 재질로 채운다.
 * 재질 이미지는 그 재질의 실제 크기(mm)만큼 한 장이 되도록 반복한다 (크기를 모르면 화면 전체에 한 장).
 */
export async function mixPreview(maskSrc: string, sizeMm: [number, number], parts: { img: string; mm: [number, number] | null }[], maxPx = 480): Promise<string> {
  const [L, W] = sizeMm;
  const scale = maxPx / Math.max(L, W);
  const cw = Math.max(1, Math.round(L * scale)), ch = Math.max(1, Math.round(W * scale));
  const layer = async (p: { img: string; mm: [number, number] | null }) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ccc'; g.fillRect(0, 0, cw, ch);
    if (p.img) {
      try {
        const im = await loadImage(p.img, true);
        const tw = p.mm ? p.mm[0] * scale : cw, th = p.mm ? p.mm[1] * scale : ch;
        for (let y = 0; y < ch; y += th) for (let x = 0; x < cw; x += tw) g.drawImage(im, x, y, tw, th);
      } catch { /* 재질 이미지를 못 읽으면 회색 */ }
    }
    return g.getImageData(0, 0, cw, ch);
  };
  const [dark, light] = await Promise.all(parts.map(layer));
  const mc = document.createElement('canvas'); mc.width = cw; mc.height = ch;
  const mg = mc.getContext('2d')!;
  mg.drawImage(await loadImage(maskSrc), 0, 0, cw, ch);
  const mask = mg.getImageData(0, 0, cw, ch);
  const out = mg.createImageData(cw, ch);
  for (let i = 0; i < out.data.length; i += 4) {
    const lum = mask.data[i] * 0.299 + mask.data[i + 1] * 0.587 + mask.data[i + 2] * 0.114;
    const src = lum < 128 ? dark : light;
    out.data[i] = src.data[i]; out.data[i + 1] = src.data[i + 1]; out.data[i + 2] = src.data[i + 2]; out.data[i + 3] = 255;
  }
  mg.putImageData(out, 0, 0);
  return mc.toDataURL('image/jpeg', 0.86);
}
