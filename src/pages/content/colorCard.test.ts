import { describe, expect, it } from 'vitest';
import {
  CC_TEMPLATE, cardHex, cardValid, chipFileError, csvRows, csvToText, decodeCsv, normRgb, parseCcText, previewColor, rgbError, type CcCard,
} from './colorCard';

const card = (r: string, g: string, b: string, name: string): CcCard => ({ id: 'x', r, g, b, name, folders: [] });

describe('컬러칩 — 칸 검사 · 정리', () => {
  it('R·G·B 는 0~255 정수만, 입력은 숫자로 시작하지 않으면 이전 값 (쿠지알러 normalize)', () => {
    expect(['', '-1', '256', 'a'].map(rgbError)).toEqual(['0-255', '0-255', '0-255', '0-255']);
    expect(['0', '255', '12'].map(rgbError)).toEqual(['', '', '']);
    expect(normRgb('', '5')).toBe('');
    expect(normRgb('a', '5')).toBe('5');
    expect(normRgb('12a', '')).toBe('12');
    expect(normRgb('-3', '')).toBe('-3');
  });

  it('올릴 수 있는 줄 · 색 값 · 미리보기', () => {
    expect(cardValid(card('218', '41', '28', 'PANTONE 485 C'))).toBe(true);
    expect(cardValid(card('218', '41', '28', '   '))).toBe(false);
    expect(cardValid(card('300', '41', '28', 'A'))).toBe(false);
    expect(cardHex(card('218', '41', '28', ''))).toBe('#da291c');
    expect(cardHex(card('0', '5', '255', ''))).toBe('#0005ff');
    expect(previewColor(card('300', '1', '2', ''))).toBe('rgb(300, 1, 2)');
    expect(previewColor(card('1', '', '2', ''))).toBe('');
  });
});

describe('컬러칩 — 가져오기', () => {
  it('글상자 줄 → 컬러칩 (쉼표·전각 쉼표, 이름 50자, 빈 줄은 건너뜀, 분류 복사)', () => {
    const list = parseCcText(`218,41,28,PANTONE 485 C\n214，105，101，PANTONE 2031 C\r\n300,1,2,범위밖\n,,,\n\n12, 34,x,${'X'.repeat(60)}`, ['F1']);
    expect(list.map((c) => [c.r, c.g, c.b, c.name])).toEqual([
      ['218', '41', '28', 'PANTONE 485 C'],
      ['214', '105', '101', 'PANTONE 2031 C'],
      ['300', '1', '2', '범위밖'],
      ['', '', '', ''],
      ['12', '34', '', 'X'.repeat(50)],
    ]);
    expect(list.every((c) => c.folders.length === 1 && c.folders[0] === 'F1')).toBe(true);
    expect(new Set(list.map((c) => c.id)).size).toBe(5);
  });

  it('CSV — 따옴표 칸, 첫 줄(머리) 건너뛰기, 빈 줄 빼기', () => {
    expect(csvRows('a,"b, c"\r\n"say ""hi""",d\n')).toEqual([['a', 'b, c'], ['say "hi"', 'd']]);
    expect(csvToText('R,G,B,이름\r\n1,2,3,"a, b"\r\n\r\n4,5,6,c')).toBe('1,2,3,a, b\n4,5,6,c');
  });

  it('CSV 글자 — UTF-8(BOM 있든 없든), 아니면 CP949(한국어 엑셀)', () => {
    const enc = new TextEncoder();
    expect(decodeCsv(enc.encode(CC_TEMPLATE))).toBe(CC_TEMPLATE.slice(1));
    expect(decodeCsv(enc.encode('1,2,3,한글'))).toBe('1,2,3,한글');
    expect(decodeCsv(new Uint8Array([0x31, 0x2c, 0xc7, 0xd1, 0xb1, 0xdb]))).toBe('1,한글');
    // 템플릿 → 예시 3줄
    expect(csvToText(decodeCsv(enc.encode(CC_TEMPLATE))).split('\n')).toEqual(['218,41,28,PANTONE 485 C', '214,105,101,PANTONE 2031 C', '236,236,231,시그널 화이트']);
  });

  it('컬러칩 사진 검사 — png·jpg 만(쿠지알러 그대로 jpeg 는 안 됨), 5MB 이하', () => {
    expect(chipFileError({ name: 'a.png', size: 1024 })).toBe('');
    expect(chipFileError({ name: 'b.JPG', size: 1024 })).toBe('');
    expect(chipFileError({ name: 'anim.gif', size: 10 })).toBe('지원하지 않는 형식, anim');
    expect(chipFileError({ name: 'c.jpeg', size: 10 })).toBe('지원하지 않는 형식, c');
    expect(chipFileError({ name: 'big.png', size: 6 * 1024 * 1024 })).toBe('파일이 너무 큽니다, big');
  });
});
