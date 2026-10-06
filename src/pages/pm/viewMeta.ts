/** 2D 6방향(T 위 · B 아래 · L 왼 · R 오른 · F 앞 · K 뒤) + 3D(V) — 쿠지알러 단축키 */
export type ViewMode = '3d' | 'T' | 'B' | 'L' | 'R' | 'F' | 'K';
/** 표시 — 재질(Ctrl+1) · 재질+와이어프레임(Ctrl+2) · 투명(Ctrl+3) · 흰색(Ctrl+4) */
export type ShadeMode = 'mat' | 'wire' | 'trans' | 'white';
export const VIEW_LABEL: Record<ViewMode, string> = { '3d': '3D', T: '위', B: '아래', L: '왼쪽', R: '오른쪽', F: '앞', K: '뒤' };
export const SHADE_LABEL: Record<ShadeMode, string> = { mat: '재질', wire: '재질+와이어프레임', trans: '투명', white: '흰색' };

