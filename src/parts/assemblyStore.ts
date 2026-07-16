/**
 * 조립 배치 상태 — localStorage 영속. 각 배치는 파츠 참조 + 위치/회전 수식.
 * 수식은 조립 변수·해당 파츠 치수(W/H/D)·인덱스(i)를 참조할 수 있다(문자열, 숫자도 허용).
 */
export interface Placement {
  id: string;
  partId: string;
  px: string; py: string; pz: string; // 위치(mm) 수식
  rx: string; ry: string; rz: string; // 회전(도) 수식
}

export interface Assembly {
  vars: { name: string; expr: string }[];
  items: Placement[];
}

const KEY = 'hp3-assembly';

export function loadAssembly(): Assembly {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (r && Array.isArray(r.items)) return { vars: r.vars ?? [], items: r.items };
  } catch { /* ignore */ }
  return { vars: [], items: [] };
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
  };
}