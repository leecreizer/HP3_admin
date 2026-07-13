export type Vec2 = [number, number];

export type Segment =
  | { type: 'line'; to: Vec2 }
  | { type: 'arc'; to: Vec2; radius: number; ccw?: boolean };

export interface Contour {
  closed: boolean;
  /** 시작점. 이후 segments가 이 점에서 이어진다. */
  start: Vec2;
  segments: Segment[];
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