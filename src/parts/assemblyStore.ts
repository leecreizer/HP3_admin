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

/** 변수 유형 — 상품관리 변수정의와 동일. */
export type VarType = '고정값' | '수식' | '조건식' | '선택';
/** 설계 변수 — 상품관리 변수정의와 동일 필드(노출이름·변수명·유형·값·노출). 기준 W/D/H도 이 형식. */
export interface DesignVar {
  name: string;        // 변수명 (#name으로 참조)
  label?: string;      // 노출이름
  value: string;       // 값(고정값·수식·조건식·선택값)
  type: VarType;       // 유형
  expose?: boolean;    // 노출여부
  options?: string;    // 선택 유형 옵션(JSON)
}

export interface Assembly {
  /** 설계 변수(상품관리 변수정의 형식). 기준 치수 W/D/H를 포함. */
  vars: DesignVar[];
  items: Placement[];
}

const KEY = 'hp3-assembly';

const baseName = (n: string) => n.replace(/^#/, '').trim();

/** 설계 변수 목록에 기준 치수 W/D/H를 항상 앞에 보장. 구버전({name,expr}·dims) 마이그레이션. */
function normalizeVars(rawVars: unknown, dims: { w?: string; d?: string; h?: string } = {}): DesignVar[] {
  const arr = Array.isArray(rawVars) ? rawVars : [];
  const vars: DesignVar[] = arr.map((v: Record<string, unknown>) => (
    'type' in v
      ? { name: String(v.name ?? ''), label: v.label as string | undefined, value: String(v.value ?? ''), type: (v.type as VarType) ?? '고정값', expose: !!v.expose, options: v.options as string | undefined }
      : { name: String(v.name ?? ''), value: String(v.expr ?? '0'), type: '수식', expose: false } // 구버전 {name,expr}
  ));
  const ensure = (nm: string, lb: string, dv?: string): DesignVar =>
    vars.find((v) => baseName(v.name) === nm) ?? { name: nm, label: lb, value: dv ?? '', type: '고정값', expose: true };
  const whd = [ensure('W', '폭', dims.w), ensure('D', '깊이', dims.d), ensure('H', '높이', dims.h)];
  const others = vars.filter((v) => !['W', 'D', 'H'].includes(baseName(v.name)));
  return [...whd, ...others];
}

export function loadAssembly(): Assembly {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (r && Array.isArray(r.items)) {
      const items: Placement[] = r.items.map((it: Placement) => ({
        ...it, w: it.w ?? '', h: it.h ?? '', d: it.d ?? '',
      }));
      return { vars: normalizeVars(r.vars, r.dims ?? {}), items };
    }
  } catch { /* ignore */ }
  return { vars: normalizeVars([]), items: [] };
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