import type { ToolType } from '../pm/modelTypes';

/**
 * 컨텐츠 제작(쿠지알러 创建素材) 카드 — 쿠지알러 bgs/dynamic-config 의 업무 탭별 uploadPortals 를 그대로 옮긴 것.
 * HANSSEM 계정 화면에 보이는 카드만(권한 없는 ‘参数化轮廓’·‘参数化模型(rfa)’·‘填充图片/纹理’·‘墙裙配置’ 제외), 쿠지알러 순서대로.
 *
 * kind = 카드를 누르면 열리는 쿠지알러 화면 종류
 *  paramModel   파라메트릭 모델 에디터 (/vc/modeleditor/new?tooltype=) — ‘모델 유형 선택’부터
 *  material     재질 텍스처 일괄 만들기 (brandgoods/material/upload?tooltype=)
 *  model3d      3D 모델 업로드 (brandgoods/model/upload?bztype=)
 *  profile      몰딩 프로파일 업로드 — DXF (customized-cms/{tool}/upload-profile)
 *  modelCutting 3D 모델 분할 도구 (/vc/modelcutting?tooltype=)
 *  virtualModel 가상 모델 업로드 — 이미지 (customized-cms/upload-virtualmodel)
 *  pattern      프린트 패턴 업로드 (customized-cms/upload-pattern)
 *  hybrid       혼합 재질 업로드 (vc/commodity/upload/hybridmaterial) — 흑백 마스크 + 영역별 재질
 *  tile         타일 상품 업로드 (vc/commodity/upload/tile) — 타일 상품·다면 타일 상품
 *  border       보더 패턴 업로드 (vc/commodity/upload/tileboundrystyle) — 보더 타일 + 코너 타일
 *  tilePattern  타일 배열 패턴 업로드 (vc/commodity/upload/tilepattern) — 붙임 방식 템플릿 + 칸별 타일
 *  waterjet     워터젯 패턴 업로드 (decoration-cms/upload/medallion) — DXF 영역 + 영역별 재질
 *  shaped       비정형 상품 업로드 (vc/commodity/upload/shapedtile) — 이미지 + 형상(육각형·별·둥근 사각·CAD)으로 자르기
 *  paving       파라메트릭 편집기 (/cloud/tool/h5/decoration-param-editor) — 타일·포설 방식·매개변수로 방안 만들기
 *  unverified   쿠지알러 화면을 아직 열어 보지 않은 카드 — 생성 조건을 지어내지 않고 안내만 한다
 */
export type CreateKind = 'paramModel' | 'material' | 'model3d' | 'profile' | 'modelCutting' | 'virtualModel' | 'pattern' | 'hybrid' | 'tile' | 'border' | 'tilePattern' | 'waterjet' | 'shaped' | 'paving' | 'unverified';

export type CreatePortal = {
  /** 쿠지알러 uploadPortals id */
  id: number;
  title: string;
  /** 쿠지알러 원문 카드 이름 */
  origin: string;
  /** 쿠지알러 카드 설명(번역) */
  desc: string;
  kind: CreateKind;
  /** 파라메트릭 모델·모델 분할의 도구 종류 */
  tooltype?: ToolType;
  /** 쿠지알러 링크 파라미터 (재질 tooltype · 3D 모델 bztype) */
  bz?: string;
  /** 만든 소재가 들어가는 소재 라이브러리 (모델 분할은 상품을 고르는 반제품 라이브러리) */
  lib?: number;
  /** 쿠지알러 원래 경로 (참고) */
  link: string;
};

const P = (p: CreatePortal) => p;

const customPortals = (tool: 'cabinet' | 'wardrobe' | 'doorwindow', ids: number[], libs: { material: number; uncategorized: number; profile: number; interim: number; virtual: number; pattern: number }, matType: string): CreatePortal[] => {
  const [param, material, model, profile, cutting, virtual, pattern] = ids;
  return [
    P({ id: param, title: '파라메트릭 모델', origin: '参数化模型库', desc: '하부장·상부장·로마 기둥 등 파라메트릭 모델 업로드', kind: 'paramModel', tooltype: tool, link: `/pub/tool/cpm/modeleditor/new?tooltype=${tool}` }),
    P({ id: material, title: '재질 텍스처', origin: '材质贴图', desc: '도어 재질·서랍 전면 재질·혼합 재질 등 평면 소재', kind: 'material', bz: matType, lib: libs.material, link: `/pub/saas/brandgoods/material/uploader?tooltype=${matType}` }),
    P({ id: model, title: '3D 모델', origin: '3D模型', desc: '후드·싱크·손잡이·경첩 등 가전·하드웨어 소재', kind: 'model3d', bz: tool, lib: libs.uncategorized, link: `/pub/saas/brandgoods/model/uploader?bztype=${tool}` }),
    P({ id: profile, title: '몰딩 프로파일', origin: '线条轮廓', desc: '걸레받이·천장 몰딩·조명 몰딩·상판 물막이 등 스윕 소재', kind: 'profile', lib: libs.profile, link: `/pub/saas/customized-cms/${tool}/upload-profile` }),
    P({ id: cutting, title: '3D 모델 분할', origin: '3d模型切割', desc: '모델을 작은 모듈로 잘라 파라메트릭 모델링에 사용', kind: 'modelCutting', tooltype: tool, lib: libs.interim, link: `/pub/tool/cpm/modelcutting?tooltype=${tool}` }),
    P({ id: virtual, title: '가상 모델', origin: '虚拟模型', desc: '레일·경첩·나사 등 모델 업로드가 필요 없는 하드웨어', kind: 'virtualModel', lib: libs.virtual, link: `/pub/saas/customized-cms/upload-virtualmodel?toolType=${tool}` }),
    P({ id: pattern, title: '프린트 패턴', origin: '印花图案', desc: '분사 인쇄용 패턴', kind: 'pattern', lib: libs.pattern, link: `/pub/saas/customized-cms/upload-pattern?tooltype=${tool}` }),
  ];
};

const unverified = (id: number, title: string, origin: string, desc: string, link: string) => P({ id, title, origin, desc, kind: 'unverified', link });

/** 업무 탭 key → 카드 (쿠지알러 sort 순) */
export const CREATE_PORTALS: Record<string, CreatePortal[]> = {
  general: [
    P({ id: 1, title: '3D 모델', origin: '3D模型', desc: '3DsMax·SketchUp 파일 업로드', kind: 'model3d', bz: '', lib: 1, link: '/pub/saas/brandgoods/model/uploader' }),
    P({ id: 2, title: '재질 텍스처', origin: '材质贴图', desc: '재질·텍스처 이미지 컨텐츠 제작', kind: 'material', bz: 'materiallib', lib: 39, link: '/pub/saas/brandgoods/material/uploader?tooltype=materiallib' }),
    P({ id: 4, title: '혼합 재질', origin: '混合材质', desc: '몰딩/벽판의 혼합 재질 — 혼합형 재질 업로드', kind: 'hybrid', lib: 39, link: '/vc/commodity/upload/hybridmaterial' }),
  ],
  paving: [
    P({ id: 5, title: '천장판 모델', origin: '扣板模型', desc: '천장판·전기 모듈 등 시공 상품', kind: 'model3d', bz: 'ceiling', lib: 4, link: '/pub/saas/brandgoods/model/uploader?bztype=ceiling' }),
    P({ id: 6, title: '천장판 텍스처', origin: '扣板贴图', desc: '이미지형 천장판', kind: 'material', bz: 'ceiling', lib: 4, link: '/pub/saas/brandgoods/material/uploader?tooltype=ceiling' }),
    P({ id: 7, title: '타일 상품', origin: '铺贴产品', desc: '타일·대리석·마루 등 시공 상품', kind: 'tile', lib: 4, link: '/vc/commodity/upload/tile' }),
    P({ id: 8, title: '보더 패턴', origin: '波打线样式', desc: '타일·대리석 보더(波打线) 패턴', kind: 'border', lib: 4, link: '/vc/commodity/upload/tileboundrystyle' }),
    P({ id: 9, title: '타일 배열 패턴', origin: '拼砖样式', desc: '타일·대리석 배열(拼砖) 패턴', kind: 'tilePattern', lib: 4, link: '/vc/commodity/upload/tilepattern' }),
    P({ id: 10, title: '워터젯 패턴', origin: '水刀拼花', desc: '워터젯 인레이 상품', kind: 'waterjet', lib: 4, link: '/pub/saas/decoration-cms/upload/medallion' }),
    P({ id: 11, title: '비정형 상품', origin: '异型产品', desc: '직사각형이 아닌 타일·마루', kind: 'shaped', lib: 4, link: '/vc/commodity/upload/shapedtile' }),
    P({ id: 12, title: '파라메트릭 편집기', origin: '参数化编辑器', desc: '다중 타일 조합·띠 조합·보더·아트월 방안 업로드', kind: 'paving', lib: 5, link: '/cloud/tool/h5/decoration-param-editor' }),
  ],
  linewallboard: [
    unverified(13, '몰딩/벽판', '线条/墙板', '몰딩·일체형 벽판 업로드', '/vc/commodity/upload/fdprofile'),
  ],
  diatommud: [
    unverified(14, '컬러칩', '色卡', '도료 조색용 컬러칩', '/vc/commodity/upload/colorCard'),
    unverified(15, '벽면 패턴', '墙面图案', '규조토 패턴·벽화 등 벽면 상품', '/pub/saas/decoration-cms/upload/wallPattern'),
    unverified(16, '도료 상품', '涂料商品', '도료·규조토 — 요철 질감 표현 지원', '/pub/saas/decoration-cms/vc/commodity/upload/diatomMud'),
  ],
  customcabinet: customPortals('cabinet', [17, 18, 19, 20, 21, 22, 23], { material: 13, uncategorized: 12, profile: 14, interim: 20, virtual: 21, pattern: 43 }, 'cupboard'),
  customwardrobe: customPortals('wardrobe', [24, 25, 26, 27, 28, 29, 30], { material: 23, uncategorized: 22, profile: 24, interim: 30, virtual: 31, pattern: 44 }, 'wardrobe'),
  // 창호 맞춤은 쿠지알러 순서가 다름: … 몰딩 프로파일 → 프린트 패턴 → 3D 모델 분할 → 가상 모델
  customdoorwindow: (() => {
    const l = customPortals('doorwindow', [31, 32, 33, 34, 36, 37, 35], { material: 33, uncategorized: 32, profile: 34, interim: 37, virtual: 45, pattern: 79 }, 'doorwindow');
    return [l[0], l[1], l[2], l[3], l[6], l[4], l[5]];
  })(),
  zhuduowei: [
    P({ id: 43, title: '3D 모델', origin: '3D模型', desc: '3DsMax·SketchUp 파일 업로드', kind: 'model3d', bz: 'quark_arch', lib: 81, link: '/pub/saas/brandgoods/model/uploader?bztype=quark_arch' }),
    P({ id: 44, title: '재질 텍스처', origin: '材质贴图', desc: '재질·텍스처 이미지 컨텐츠 제작', kind: 'material', bz: 'quark_arch', lib: 82, link: '/pub/saas/brandgoods/material/uploader?tooltype=quark_arch' }),
    unverified(45, '몰딩 프로파일', '线条轮廓', '처마·징두리·허리 몰딩 등 단면 프로파일', '/pub/bim/arch/cms-update-molding'),
    P({ id: 46, title: '파라메트릭 모델', origin: '参数化模型', desc: '로마 기둥·문틀 몰딩 등 파라메트릭 모델', kind: 'paramModel', tooltype: 'arch', link: '/vc/modeleditor/new?tooltype=arch' }),
  ],
  planedesign: [
    unverified(72, '배치 소재', '布置素材', 'DXF/DWG/SVG 범례 업로드', '/pub/saas/brandgoods/furniturelegend/uploader'),
  ],
  kudashi: [
    unverified(75, '모델', '3D模型', '쿠다스 모델 목록의 모델 가져오기', '/pub/tool/geom-modeling/kds-model-uploader'),
    P({ id: 76, title: '재질 텍스처', origin: '材质贴图', desc: '재질·텍스처 이미지 컨텐츠 제작', kind: 'material', bz: 'kudashi', lib: 92, link: '/pub/saas/brandgoods/material/uploader?tooltype=kudashi' }),
  ],
};

/** 재질 일괄 만들기의 렌더 분류 — 맞춤(定制) 탭은 ‘全屋定制材质’ 고정(주방·욕실 화면에서 확인), 나머지는 미확인 */
export const MATERIAL_RENDER_CAT: Record<string, string> = { cupboard: '맞춤가구 재질', wardrobe: '맞춤가구 재질', doorwindow: '맞춤가구 재질' };

/** 혼합 재질의 렌더 분류 (쿠지알러 渲染分类 4종, 화면 순서) */
export const HYBRID_RENDER_CATS: { value: string; zh: string }[] = [
  { value: '천장 몰딩 재질', zh: '角线材质' },
  { value: '걸레받이 재질', zh: '踢脚线材质' },
  { value: '장식 몰딩 재질', zh: '装饰线材质' },
  { value: '일체형 벽판 재질', zh: '集成墙板材质' },
];
