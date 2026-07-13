export type Vec2 = [number, number];

/** 단면의 꼭지점. r>0이면 그 모서리를 반지름 R로 라운드(필렛)한다. */
export interface Corner {
  pt: Vec2;
  /** 모서리 필렛 반지름(mm). 없거나 0이면 각진 모서리. */
  r?: number;
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

export interface Part {
  id: string;
  name: string;
  profile: Profile;
  method: 'extrude';
  extrude: { depth: number; bevel?: { size: number; thickness: number } };
  material?: { color: string; name?: string };
  bbox: { w: number; h: number; d: number };
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}