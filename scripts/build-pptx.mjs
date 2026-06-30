import pptxgenjs from 'pptxgenjs';

const CAP = 'c:/workspace/HP3_admin/docs/captures';
const INK = '1E2A3A', GRAY = 'ECEEF1', DARK = '3B4655', LINE = 'C7CDD4', RED = 'E8543A', TEXT = '2A3646', MUTE = '5D6C7E', OKG = '2E7D52';
const FF = 'Malgun Gothic';
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑬⑭⑮⑯⑰⑱⑲⑳';

const pres = new pptxgenjs();
pres.defineLayout({ name: 'DEF', width: 13.3, height: 7.5 });
pres.layout = 'DEF';
pres.author = 'HomePlanner3 Admin';
pres.title = 'HomePlanner3 어드민 상세기획서';

let pageNo = 0;
const newSlide = () => { pageNo += 1; const s = pres.addSlide(); s.background = { color: 'FFFFFF' }; return s; };
const cell = (s, x, y, w, h, text, o = {}) => {
  s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: o.fill ?? 'FFFFFF' }, line: { color: LINE, width: 1 } });
  s.addText(text, { x: x + 0.05, y, w: w - 0.1, h, margin: 0, valign: o.valign ?? 'middle', align: o.align ?? 'left', fontSize: o.fs ?? 11, bold: !!o.bold, color: o.color ?? TEXT, fontFace: FF });
};
const sectionTitle = (label) => {
  const s = newSlide();
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: 'F1F3F5' } });
  s.addText(label, { x: 0, y: 3.0, w: 13.3, h: 1.2, align: 'center', bold: true, fontSize: 40, color: INK, fontFace: FF });
};

/* ===== 표지 ===== */
{
  const s = newSlide();
  s.addText('HomePlanner3 어드민', { x: 1, y: 2.3, w: 11.3, h: 0.8, align: 'center', bold: true, fontSize: 40, color: INK, fontFace: FF });
  s.addText('상세 기획서 (화면정의서)', { x: 1, y: 3.5, w: 11.3, h: 0.8, align: 'center', bold: true, fontSize: 30, color: INK, fontFace: FF });
  const meta = [['팀 명', '서비스기획팀'], ['업무 구분', '프로젝트'], ['화면 용도', '관리자'], ['문서 버전', 'v1.1'], ['최종 수정일', '2026.06.17']]
    .map((r) => [{ text: r[0], options: { fill: { color: GRAY }, bold: true, color: INK, align: 'center', fontFace: FF } }, { text: r[1], options: { align: 'left', color: TEXT, fontFace: FF } }]);
  s.addTable(meta, { x: 8.7, y: 5.4, w: 4.0, colW: [1.6, 2.4], rowH: 0.32, fontSize: 11, border: { pt: 1, color: LINE } });
}

/* ===== 개정 내역 ===== */
{
  const s = newSlide();
  s.addText('개정 내역', { x: 0.4, y: 0.25, w: 11, h: 0.5, bold: true, fontSize: 18, color: INK, fontFace: FF });
  const rows = [
    [['버전', 'h'], ['개정 내역', 'h'], ['작성일', 'h'], ['작성자', 'h']],
    [['v1.0', 'c'], ['상세기획서 초안 (화면 10종)', 'l'], ['2026.06.17', 'c'], ['서비스기획팀', 'c']],
    [['v1.1', 'c'], ['전 화면 기능 전수 상세화 (공통 UI·버튼·컬럼·필드·상태·하위메뉴·모달 포함)', 'l'], ['2026.06.17', 'c'], ['서비스기획팀', 'c']],
  ].map((r) => r.map(([t, k]) => ({ text: t, options: { fill: k === 'h' ? { color: DARK } : { color: 'FFFFFF' }, color: k === 'h' ? 'FFFFFF' : TEXT, bold: k === 'h', align: k === 'l' ? 'left' : 'center', fontFace: FF, valign: 'middle' } })));
  s.addTable(rows, { x: 0.4, y: 0.9, w: 12.5, colW: [1.2, 7.9, 1.9, 1.5], rowH: [0.4, 0.5, 0.6], fontSize: 11, border: { pt: 1, color: LINE } });
}

/* ===== 정책 ===== */
sectionTitle('정책');
{
  const s = newSlide();
  s.addText('[정책] 어드민 권한 · 데이터 관리', { x: 0.4, y: 0.25, w: 12, h: 0.5, bold: true, fontSize: 16, color: INK, fontFace: FF });
  const data = [
    ['1', '접근', '어드민 접근은 운영자 등급만 가능. 일반/B2B 등 서비스 사용자는 접근 불가'],
    ['2', '메뉴 노출', '등급별 메뉴 노출 매트릭스를 단일 기준(SSOT)으로 함. 화면/코드 별도 하드코딩 금지'],
    ['3', '최소 권한', '신규 등급 기본값 = 홈 대시보드만 허용. 필요한 메뉴만 추가 부여'],
    ['4', '고정 권한', '최고관리자 = 전체 메뉴 고정(수정 불가), 홈 대시보드 = 전 등급 항상 허용'],
    ['5', '즉시 반영', '등급 권한 변경 시 사이드바 노출·페이지 접근 즉시 적용. 권한 없는 페이지 진입 차단'],
    ['6', '단일 출처', '브랜드/그룹·상품군/품목/모델은 화면 간 동일 데이터 공유(중복 정의 금지)'],
    ['7', '식별자', '상품 contentCode=PK(배치키), productCode=가격코드(수정불가), 사용자=사번 식별'],
    ['8', 'Cascade', '브랜드 삭제 → 하위 그룹 삭제 + 사용자 소속 해제 / 폴더 삭제 → 상품 상위 폴더 이동'],
    ['9', '영속', '실서비스는 서버 저장 원칙(localStorage는 캐시·UI 상태). 스키마 변경 시 버전 무효화'],
  ];
  const head = ['No', '구분', '정책'].map((t) => ({ text: t, options: { fill: { color: DARK }, color: 'FFFFFF', bold: true, align: 'center', fontFace: FF, valign: 'middle' } }));
  const body = data.map((r) => [
    { text: r[0], options: { align: 'center', fontFace: FF, valign: 'middle' } },
    { text: r[1], options: { align: 'center', bold: true, color: INK, fontFace: FF, valign: 'middle' } },
    { text: r[2], options: { align: 'left', color: TEXT, fontFace: FF, valign: 'middle' } },
  ]);
  s.addTable([head, ...body], { x: 0.4, y: 0.9, w: 12.5, colW: [0.7, 1.7, 10.1], rowH: 0.55, fontSize: 11, border: { pt: 1, color: LINE } });
}
{
  const s = newSlide();
  s.addText('[정책] 등급별 메뉴 노출 기준', { x: 0.4, y: 0.25, w: 12, h: 0.5, bold: true, fontSize: 16, color: INK, fontFace: FF });
  const cols = ['등급', '홈 대시보드', '사용자 관리', '브랜드 관리', '도면 관리', '상품 관리', '통계 분석', '설정'];
  const head = cols.map((t, i) => ({ text: t, options: { fill: { color: DARK }, color: 'FFFFFF', bold: true, align: i === 0 ? 'left' : 'center', fontFace: FF, valign: 'middle', fontSize: 10.5 } }));
  const mk = (name, arr) => [{ text: name, options: { bold: true, color: INK, align: 'left', fontFace: FF, valign: 'middle' } }, ...arr.map((v) => ({ text: v ? '●' : '–', options: { align: 'center', color: v ? OKG : MUTE, bold: v, fontFace: FF, valign: 'middle' } }))];
  s.addTable([head, mk('최고관리자', [1, 1, 1, 1, 1, 1, 1]), mk('운영자', [1, 0, 0, 1, 1, 1, 0]), mk('뷰어', [1, 0, 0, 1, 0, 1, 0])], { x: 0.4, y: 0.9, w: 12.5, colW: [2.1, 1.49, 1.49, 1.49, 1.49, 1.49, 1.49, 1.46], rowH: 0.6, fontSize: 11, border: { pt: 1, color: LINE } });
  s.addText([{ text: '● 접근 허용 · – 미노출    ', options: { color: TEXT } }, { text: '홈 대시보드는 전 등급 허용, 최고관리자는 전체 고정.', options: { color: RED, bold: true } }], { x: 0.4, y: 3.7, w: 12.5, h: 0.4, fontSize: 11, fontFace: FF });
  s.addText('※ 등급은 [사용자 관리 > 등급·노출 관리]에서 추가/이름변경/삭제 및 메뉴 체크로 관리한다.', { x: 0.4, y: 4.1, w: 12.5, h: 0.4, fontSize: 10.5, color: MUTE, fontFace: FF });
}
{
  const s = newSlide();
  s.addText('[정책] 개인정보 마스킹 규칙', { x: 0.4, y: 0.25, w: 12, h: 0.5, bold: true, fontSize: 16, color: INK, fontFace: FF });
  const head = ['화면/항목', '보호 조치'].map((t) => ({ text: t, options: { fill: { color: DARK }, color: 'FFFFFF', bold: true, align: 'center', fontFace: FF, valign: 'middle' } }));
  const data = [['사용자 관리 목록', '이메일·사번 마스킹 표기'], ['대시보드 렌더 큐 / 최근 렌더', '사용자 계정(이메일) 마스킹'], ['상품 권한(그룹) 표기', '마스킹 불필요'], ['감사 로그 / 다운로드', '다운로드 사유 입력 + 파일 비밀번호(예정)']];
  const body = data.map((r) => [{ text: r[0], options: { align: 'left', color: INK, fontFace: FF, valign: 'middle' } }, { text: r[1], options: { align: 'left', color: r[1].includes('마스킹') && !r[1].includes('불필요') ? RED : TEXT, bold: r[1].includes('마스킹') && !r[1].includes('불필요'), fontFace: FF, valign: 'middle' } }]);
  s.addTable([head, ...body], { x: 0.4, y: 0.9, w: 6.6, colW: [3.1, 3.5], rowH: 0.6, fontSize: 11, border: { pt: 1, color: LINE } });
  s.addText('[마스킹 규칙 참고]', { x: 7.4, y: 0.9, w: 5.5, h: 0.4, bold: true, color: INK, fontSize: 12, fontFace: FF });
  s.addText([{ text: '이메일 : 아이디 일부 마스킹 (kim**@hanssem.com)', options: { breakLine: true } }, { text: '사번 : 뒤 4자리 마스킹 (2017****)', options: { breakLine: true } }, { text: '이름 : 첫·끝 외 마스킹 (홍*동)', options: { breakLine: true } }, { text: '휴대폰 : 마지막 4자리 (010-1234-****)', options: { breakLine: true } }], { x: 7.4, y: 1.4, w: 5.5, h: 2.5, fontSize: 11, color: TEXT, fontFace: FF, lineSpacingMultiple: 1.2 });
}

/* ===== 화면 리스트 ===== */
{
  const s = newSlide();
  s.addText('화면 리스트', { x: 0.4, y: 0.25, w: 12, h: 0.5, bold: true, fontSize: 18, color: INK, fontFace: FF });
  const head = ['No', '시스템', '화면 경로', '주요 기능', '구분'].map((t) => ({ text: t, options: { fill: { color: DARK }, color: 'FFFFFF', bold: true, align: 'center', fontFace: FF, valign: 'middle' } }));
  const data = [
    ['0', '어드민', '공통 (사이드바·상단바)', '네비게이션·등급 노출·공통 인터랙션', '공통'],
    ['1', '어드민', '대시보드', '운영 지표·렌더 큐 모니터링', '신규'],
    ['2', '어드민', '도면 관리 > 목록', '도면 조회·검색·상태 필터', '신규'],
    ['3', '어드민', '도면 관리 > 상세', '도면별 렌더 이미지 갤러리', '신규'],
    ['4', '어드민', '사용자 관리 > 목록', '사용자·그룹 관리·추가/수정/삭제', '신규'],
    ['5', '어드민', '사용자 관리 > 등급·노출 관리', '등급별 메뉴 접근 권한', '신규'],
    ['6', '어드민', '브랜드 관리', '브랜드·그룹 관리(cascade)', '신규'],
    ['7', '어드민', '상품 관리 > 목록', '폴더·상품 관리·일괄 작업', '신규'],
    ['8', '어드민', '상품 관리 > 등록(모달)', '신규 상품 등록', '신규'],
    ['9', '어드민', '상품 관리 > 편집', '기본정보·운영정보·에셋', '신규'],
    ['10', '어드민', '상품 관리 > 상품군·구분', '상품군·품목 분류', '신규'],
    ['11', '어드민', '상품 관리 > 모델 관리', '상품군별 모델(시리즈)', '신규'],
    ['12', '어드민', '상품 관리 > 노출 필드 관리', 'DB 노출 필드 정의', '신규'],
    ['13', '어드민', '상품 관리 > 필터 관리', '필터 그룹·옵션', '신규'],
    ['14', '어드민', '설정', '좌측메뉴·상부메뉴 구성', '신규'],
  ];
  const body = data.map((r) => r.map((t, i) => ({ text: t, options: { align: i === 2 || i === 3 ? 'left' : 'center', color: i === 4 ? (t === '공통' ? MUTE : RED) : TEXT, bold: i === 4, fontFace: FF, valign: 'middle', fontSize: 10 } })));
  s.addTable([head, ...body], { x: 0.4, y: 0.9, w: 12.5, colW: [0.6, 1.1, 3.7, 5.3, 1.8], rowH: 0.36, fontSize: 9.5, border: { pt: 1, color: LINE } });
}

/* ===== 화면 기획서 ===== */
sectionTitle('화면 기획서');

function pushRuns(runs, it, ctx) {
  if (it && it.h) {
    ctx.n += 1;
    runs.push({ text: CIRCLED[ctx.n - 1] + ' ', options: { bold: true, color: RED, fontSize: 10.5, breakLine: false, fontFace: FF } });
    runs.push({ text: it.h, options: { bold: true, color: INK, fontSize: 10.5, breakLine: true, fontFace: FF } });
  } else if (it && it.cond) {
    runs.push({ text: '→ ' + it.cond, options: { color: RED, bold: true, fontSize: 9, breakLine: true, fontFace: FF } });
  } else if (it && it.pol) {
    if (!ctx.polDone) {
      ctx.polDone = true;
      runs.push({ text: '■ 페이지 정책', options: { bold: true, color: RED, fontSize: 9.5, breakLine: true, fontFace: FF } });
    }
    runs.push({ text: '· ' + it.pol.replace(/^\[정책\]\s*/, ''), options: { color: RED, fontSize: 9, breakLine: true, fontFace: FF } });
  } else {
    runs.push({ text: '· ' + it, options: { color: TEXT, fontSize: 9, breakLine: true, fontFace: FF } });
  }
}
const weight = (it) => { const t = it && (it.h || it.cond || it.pol) ? (it.h || it.cond || it.pol) : it; return String(t).length > 26 ? 2 : 1; };
function splitDesc(desc, budget) {
  const chunks = []; let cur = []; let w = 0;
  for (let i = 0; i < desc.length; i++) {
    const it = desc[i]; const ww = weight(it) + (it && it.h ? 0.4 : 0);
    if (cur.length && (w + ww > budget) && (it && it.h || w >= budget + 3)) { chunks.push(cur); cur = []; w = 0; }
    cur.push(it); w += ww;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function renderScreen(p) {
  const chunks = splitDesc(p.desc, 22);
  const ctx = { n: 0 };
  chunks.forEach((chunk, ci) => {
    const s = newSlide();
    const hy = 0.25, hh = 0.62;
    const cont = ci > 0 ? ` (${ci + 1}/${chunks.length})` : (chunks.length > 1 ? ` (1/${chunks.length})` : '');
    cell(s, 0.30, hy, 1.25, hh, '화면명/위치', { fill: GRAY, bold: true, color: INK, align: 'center' });
    cell(s, 1.55, hy, 2.20, hh, 'HomePlanner3 어드민', { bold: true, color: INK, fs: 11 });
    cell(s, 3.75, hy, 0.65, hh, '상세', { fill: GRAY, bold: true, color: INK, align: 'center' });
    cell(s, 4.40, hy, 3.30, hh, p.path, { color: MUTE, fs: 10 });
    cell(s, 7.70, hy, 0.65, hh, '구분', { fill: GRAY, bold: true, color: INK, align: 'center' });
    cell(s, 8.35, hy, 0.90, hh, p.gubun, { color: RED, bold: true, align: 'center' });
    cell(s, 9.45, hy, 3.05, hh, 'Description' + cont, { bold: true, color: INK, align: 'center', fs: 12 });
    cell(s, 12.50, hy, 0.50, hh, String(pageNo).padStart(2, '0'), { bold: true, color: INK, align: 'center' });

    // 좌측 화면 (캡처 또는 플레이스홀더)
    const ix = 0.35, iy = 1.15, iw = 8.85, ih = iw * (900 / 1440);
    s.addShape(pres.shapes.RECTANGLE, { x: ix - 0.05, y: iy - 0.05, w: iw + 0.1, h: ih + 0.1, fill: { color: p.img ? 'FFFFFF' : 'F4F6F8' }, line: { color: RED, width: 1.5, dashType: 'dash' } });
    if (p.img) s.addImage({ path: `${CAP}/${p.img}`, x: ix, y: iy, w: iw, h: ih });
    else s.addText(`${p.name}\n(화면 캡처 별도 첨부)`, { x: ix, y: iy, w: iw, h: ih, align: 'center', valign: 'middle', color: MUTE, fontSize: 16, bold: true, fontFace: FF });
    s.addShape(pres.shapes.RECTANGLE, { x: ix - 0.12, y: iy - 0.12, w: 0.3, h: 0.3, fill: { color: RED } });
    s.addText('1', { x: ix - 0.12, y: iy - 0.12, w: 0.3, h: 0.3, margin: 0, align: 'center', valign: 'middle', color: 'FFFFFF', bold: true, fontSize: 13, fontFace: FF });

    // 우측 Description
    const runs = [];
    chunk.forEach((it) => pushRuns(runs, it, ctx));
    s.addText(runs, { x: 9.45, y: 1.12, w: 3.55, h: 6.1, margin: 0, valign: 'top', align: 'left', fontFace: FF, lineSpacingMultiple: 1.04 });
    s.addText('HomePlanner3 어드민 · 상세기획서 v1.1', { x: 0.35, y: 7.22, w: 9, h: 0.25, margin: 0, fontSize: 9, color: MUTE, fontFace: FF });
  });
}

import { SCREENS } from './screens-data.mjs';

SCREENS.forEach(renderScreen);

await pres.writeFile({ fileName: 'c:/workspace/HP3_admin/docs/상세기획서_화면정의.pptx' });
console.log('wrote docs/상세기획서_화면정의.pptx  (slides:', pageNo, ')');
