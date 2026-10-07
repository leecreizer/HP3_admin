import { newId } from '../../data/contentLibrary';
import { loadImage, MB } from './decoUtil';

/**
 * 컬러칩 업로드 (쿠지알러 色卡上传 · /vc/commodity/upload/colorCard) — 2026-10-07 화면·번들 규칙.
 * 표의 한 줄 = 컬러칩 상품 하나(R·G·B·이름·분류). 글상자·CSV·컬러칩 사진으로 여러 줄을 한꺼번에 넣는다.
 */

/** 표 전체 상한 (쿠지알러 MAX_CARDS_NUM) */
export const CC_MAX = 200;
/** 한 쪽 줄 수 */
export const CC_PAGE = 8;
/** 이름 입력 최대 · 가져온 이름 자르기 */
export const CC_NAME_MAX = 128;
export const CC_IMPORT_NAME = 50;
/** 사진 한 번에 인식 상한 · 한 장 크기 상한(MB) */
export const CC_IMG_MAX = 200;
export const CC_IMG_MB = 5;

export type CcField = 'r' | 'g' | 'b' | 'name';
export type CcCard = { id: string; r: string; g: string; b: string; name: string; folders: string[] };

export const emptyCard = (): CcCard => ({ id: newId('CC'), r: '', g: '', b: '', name: '', folders: [] });
export const cardFilled = (c: CcCard) => !!(c.r || c.g || c.b || c.name.trim() || c.folders.length);

/** R·G·B 칸 검사 — 0~255 정수가 아니면 ‘0-255’ */
export const rgbError = (v: string): string => { const n = parseInt(v, 10); return Number.isNaN(n) || n < 0 || n > 255 ? '0-255' : ''; };
/** R·G·B 칸 입력 정리 (쿠지알러 normalize) — 빈칸은 빈칸, 숫자로 시작하지 않으면 이전 값, 아니면 정수만 */
export const normRgb = (v: string, prev: string): string => (v === '' ? '' : Number.isNaN(parseInt(v, 10)) ? prev : String(parseInt(v, 10)));
export const nameError = (v: string): string => (v.trim() ? '' : '이름을 입력하세요');
export const fieldError = (c: CcCard, f: CcField): string => (f === 'name' ? nameError(c.name) : rgbError(c[f]));
/** 올릴 수 있는 줄 — R·G·B 가 0~255 이고 이름이 있음 */
export const cardValid = (c: CcCard) => !rgbError(c.r) && !rgbError(c.g) && !rgbError(c.b) && !nameError(c.name);

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
export const cardHex = (c: Pick<CcCard, 'r' | 'g' | 'b'>) => `#${hex2(parseInt(c.r, 10))}${hex2(parseInt(c.g, 10))}${hex2(parseInt(c.b, 10))}`;
/** 미리보기 색 — 세 칸이 모두 숫자면 rgb(…)(범위 밖은 브라우저가 잘라 그림), 아니면 없음 */
export function previewColor(c: Pick<CcCard, 'r' | 'g' | 'b'>): string {
  const v = [c.r, c.g, c.b].map((x) => parseInt(x, 10));
  return v.some(Number.isNaN) ? '' : `rgb(${v.join(', ')})`;
}
/** 상품 이미지 — 컬러칩 색 정사각형 */
export const swatchImg = (hex: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${hex}"/></svg>`)}`;

/* ───────────────────────── 가져오기 ───────────────────────── */

export const CC_PLACEHOLDER = '여기에 컬러칩 정보를 입력하세요\nRGB 값과 이름을 ‘,’로 구분하고, 줄을 바꿔 여러 개 넣습니다. 예:\n123,233,222,90GG-8001\n123,233,222,90GG-8001\n123,233,222,90GG-8001';

/**
 * 글상자 → 줄 (쿠지알러 导入) — 줄마다 ‘,’ 또는 ‘，’로 나눠 R,G,B(정수가 아니면 빈칸)·이름(4번째 칸, 50자에서 자름).
 * 비어 있는 줄은 건너뛴다. 분류는 그 탭에서 고른 것.
 */
export function parseCcText(text: string, folders: string[]): CcCard[] {
  const num = (s?: string) => { const n = parseInt(s ?? '', 10); return Number.isNaN(n) ? '' : String(n); };
  return text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').map((l) => {
    const p = l.split(/,|，/);
    return { id: newId('CC'), r: num(p[0]), g: num(p[1]), b: num(p[2]), name: (p[3] ?? '').slice(0, CC_IMPORT_NAME), folders: [...folders] };
  });
}

/**
 * CSV 파일 바이트 → 글. UTF-8(BOM 있든 없든)이 아니면 CP949(한국어 엑셀이 저장하는 CSV).
 * 쿠지알러는 BOM 이 없으면 GBK(중국어 엑셀)로 읽는다 — 그 자리를 한국어로.
 */
export function decodeCsv(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('euc-kr').decode(b); }
}

/** CSV 글 → 칸 배열 (따옴표 칸 안의 쉼표·줄바꿈·"" 처리) */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
    } else if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** CSV → 글상자 내용 (쿠지알러: 첫 줄은 머리라 건너뛰고, 줄마다 칸을 ‘,’로 이음). 빈 줄은 뺀다 */
export const csvToText = (text: string) => csvRows(text).slice(1).filter((r) => r.some((c) => c.trim() !== '')).map((r) => r.join(',')).join('\n');

/** 표 템플릿 (쿠지알러 表格模板.csv — UTF-8 BOM, 머리 + 예시 3줄) */
export const CC_TEMPLATE = '﻿R,G,B,컬러칩 이름\r\n218,41,28,PANTONE 485 C\r\n214,105,101,PANTONE 2031 C\r\n236,236,231,시그널 화이트\r\n';
export const CC_TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(CC_TEMPLATE)}`;

/* ───────────────────────── 컬러칩 사진 ───────────────────────── */

/** 확장자 뺀 파일 이름 */
export const baseName = (n: string) => n.split('.').slice(0, -1).join('.') || n;

/** 사진 검사 (쿠지알러 그대로 — 확장자 png·jpg 만, 5MB 이하). 문제가 없으면 '' */
export function chipFileError(f: { name: string; size: number }): string {
  const ext = f.name.split('.').slice(-1)[0].toLowerCase();
  if (ext !== 'png' && ext !== 'jpg') return `지원하지 않는 형식, ${baseName(f.name)}`;
  if (f.size / MB > CC_IMG_MB) return `파일이 너무 큽니다, ${baseName(f.name)}`;
  return '';
}

/**
 * 컬러칩 사진 → 가운데 한 점의 색 줄 ‘r,g,b,파일 이름’.
 * 쿠지알러는 (가로/2, 가로/2) 점을 읽어 가로로 긴 사진은 그림 밖(검정)이 된다 — HP3 는 가운데 (가로/2, 세로/2).
 */
export async function chipLine(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await loadImage(url);
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2), 1, 1, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]},${baseName(f.name)}`;
  } catch {
    throw new Error(`인식 오류, ${baseName(f.name)}`);
  } finally { URL.revokeObjectURL(url); }
}
