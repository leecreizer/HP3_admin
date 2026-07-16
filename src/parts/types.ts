export type Vec2 = [number, number];

/** 단면의 꼭지점. r>0이면 그 모서리를 반지름 R로 라운드(필렛)한다. */
export interface Corner {
  /** 확정 좌표(mm). xExpr/yExpr가 있으면 그 평가값으로 덮인다. */
  pt: Vec2;
  /** 모서리 필렛 반지름(mm). 없거나 0이면 각진 모서리. */
  r?: number;
  /** X 좌표 수식(변수·연산 사용). 없으면 pt[0] 리터럴 사용. */
  xExpr?: string;
  /** Y 좌표 수식. 없으면 pt[1] 리터럴 사용. */
  yExpr?: string;
}

/** 파츠 변수 — 이름과 수식(리터럴 숫자 포함). 점 좌표 수식에서 참조. */
export interface PartVar {
  name: string;
  expr: string;
}

export interface Contour {
  closed: boolean;
  /** 꼭지점 목록(순서대로 다각형). 필렛은 buildShape에서 전개된다. */
  corners: Corner[];
}

export interface Profile {
  units: 'mm';
  /** [0]=외곽, 이후=구멍(holes) */
  contours: Contour[];
}

/** 2D 단면이 놓이는 작업 평면. 압출은 이 평면의 수직축으로 진행. */
export type WorkPlane = 'XY' | 'XZ' | 'YZ';

export interface Part {
  id: string;
  name: string;
  profile: Profile;
  method: 'extrude';
  /** (구버전) 작업 평면. rot이 있으면 무시. */
  plane?: WorkPlane;
  /** 파츠 회전값(도) [x,y,z]. 압출 형상의 방향. */
  rot?: [number, number, number];
  /** 파츠 변수 — 점 좌표 수식에서 참조(#W, #H 등). */
  vars?: PartVar[];
  extrude: { depth: number; bevel?: { size: number; thickness: number } };
  material?: { color: string; name?: string };
  bbox: { w: number; h: number; d: number };
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}