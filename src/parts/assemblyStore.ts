/**
 * 조립 배치 상태 — localStorage 영속. 각 배치는 파츠 참조 + 위치/회전 수식.
 * 수식은 조립 변수·해당 파츠 치수(W/H/D)·인덱스(i)를 참조할 수 있다(문자열, 숫자도 허용).
 */
export interface Placement {
  id: string;
  partId: string;
  px: string; py: string; pz: string; // 위치(mm) 수식
  rx: string; ry: string; rz: string; // 회전(도) 수식
  w: string; h: string; d: string;    // 실제 크기(mm) 수식 — 폭·높이·두께. 빈값=파츠 원본
  hidden?: boolean;                    // true면 3D에서 숨김
  ref?: string;                        // 정의 변수/이름 — 다른 배치가 ref.W/.H/.D 로 참조
  vars?: { name: string; expr: string }[]; // 이 배치 전용 변수(위치/회전/크기 수식에서 #이름 참조)
}

export interface Assembly {
  vars: { name: string; expr: string }[];
  items: Placement[];
  /** 전체 모델링 기준 치수(mm) — 배치 수식에서 #W/#D/#H로 참조, 등록 상품 크기 기준. 빈값=배치 bbox 자동 */
  dims?: { w: string; d: string; h: string };
}

const KEY = 'hp3-assembly';

export function loadAssembly(): Assembly {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (r && Array.isArray(r.items)) {
      const items: Placement[] = r.items.map((it: Placement) => ({
        ...it, w: it.w ?? '', h: it.h ?? '', d: it.d ?? '', // 구버전 배치: 크기 빈값(=원본)
      }));
      return { vars: r.vars ?? [], items, dims: r.dims ?? { w: '', d: '', h: '' } };
    }
  } catch { /* ignore */ }
  return { vars: [], items: [], dims: { w: '', d: '', h: '' } };
}

export function saveAssembly(a: Assembly): void {
  localStorage.setItem(KEY, JSON.stringify(a));
}

let _seq = 0;
export function newPlacement(partId: string): Placement {
  return {
    id: `pl-${Date.now()}-${_seq++}`,
    partId,
    px: '0', py: '0', pz: '0',
    rx: '0', ry: '0', rz: '0',
    w: '', h: '', d: '',
    vars: [],
  };
}