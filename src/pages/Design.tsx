import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadFolders, loadProducts, folderSubtree, loadFilterGroups, loadSwapState, expandMembers, folderRepThumb } from '../data/groups';
import { opSizeOptions, evalFormula, varTypeOf, type OpSize, type VarType } from './Products';
import { getAssets } from '../data/assetStore';

/**
 * 설계 미리보기 (확인용) — stg 홈플래너 상품 라이브러리 구조
 * - 최초: 설계형/배치형/재질형 영역 타이틀 + 그 아래 상품군 폴더 목록 (상품 미노출)
 * - 상품군(폴더) 선택 시: 그 폴더의 하위 폴더 + 상품만 표시 (브레드크럼으로 상위 이동)
 * - 중앙: HomePlanner3 three.js 캔버스 / 우측: 상품 기본정보
 */
const EXT_ROOT = 'f-root';
const NAV = ['도면 레이아웃', '상품 라이브러리', '내 보관함', '기본공사'];
// 웹플래너(R3F) iframe URL 해석 — 우선순위:
//  1) ?planer=<url> 쿼리(터널 주소 주입, localStorage에 저장)
//  2) localStorage 'hp3-webplaner-url'
//  3) 현재 접속 호스트:5190 (LAN 직접 접속)
function resolveThreeUrl(): string {
  const withSlash = (u: string) => (u.endsWith('/') ? u : u + '/');
  try {
    const q = new URLSearchParams(window.location.search).get('planer');
    if (q) { localStorage.setItem('hp3-webplaner-url', q); return withSlash(q); }
    const saved = localStorage.getItem('hp3-webplaner-url');
    if (saved) return withSlash(saved);
  } catch { /* ignore */ }
  // GitHub Pages 배포본은 함께 배포된 웹플래너 Pages를 기본 사용
  if (window.location.hostname.endsWith('github.io')) return 'https://leecreizer.github.io/Webplaner/';
  return `${window.location.protocol}//${window.location.hostname}:5190/`;
}
const THREE_URL = resolveThreeUrl();
const PAGE_SIZE = 20;

type LibProduct = ReturnType<typeof loadProducts>[number] & {
  thumbUrl?: string; placement?: string; placeHeight?: number; w?: number; d?: number; h?: number;
  modelKind?: string;
  filterValues?: string[];
  specUrls?: { name: string; url: string }[];
  mallUrls?: { name: string; url: string }[];
  modelingSlots?: { slot: string; groupId: string; defaultModelingId?: string; rules?: { condition: string; groupId: string }[] }[];
  modelUrl?: string;
  assets?: { id: string; name: string; type: string; url?: string }[];
  opSize?: OpSize;
  permission?: string;
  visible?: boolean;
  /** 비규격(맞춤) 여부 — true면 opSize Min/Max/Gap 범위 안에서 자유 입력, false면 GAP 단계 선택. */
  nonStandard?: boolean;
  modelCode?: string;
  itemCode?: string;
  dp?: string;
  pos?: string;
  /** 모델(마감) 표시 컬러 — 웹플래너 박스 렌더 색 */
  color?: string;
  price?: number;
  quoteGroup?: string;
  attrType?: string;
  formula?: { w?: string; d?: string; h?: string };
  vars?: { name: string; value: string; type?: VarType; expose?: boolean }[];
  condition?: string;
};

type DesignUser = { id: string; name: string; email: string; groupIds: string[] };
type DesignProps = {
  /** 사용자 관리 전체 사용자 — '보는 사용자' 선택용 */
  users?: DesignUser[];
  /** 로그인 사용자 id */
  currentUserId?: string | null;
  /** 로그인 사용자가 소속된 사용자 그룹 id 목록 (복수) */
  myGroupIds?: string[];
  /** 관리자면 전체 컨텐츠 열람 가능 */
  isAdmin?: boolean;
  userName?: string;
};

export function Design({ users = [], currentUserId = null, isAdmin = false }: DesignProps) {
  // 상품관리에서 편집·저장한 최신 데이터를 반영하기 위해 상태로 보관, 창 포커스 시 재로딩
  const [folders, setFolders] = useState(() => loadFolders());
  const [allProducts, setAllProducts] = useState(() => loadProducts() as LibProduct[]);
  /** 모델 에셋 바이너리는 IDB 보관 → contentCode → modelUrl 하이드레이트 맵 */
  const [modelUrls, setModelUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    // 각 상품의 '모델링' 에셋 url을 IDB에서 불러와 맵 구성
    const tasks = allProducts.map(async (p) => {
      const inline = p.modelUrl || p.assets?.find((a) => a.type === '모델링' && a.url)?.url;
      if (inline) return [p.contentCode, inline] as const;
      const ids = (p.assets ?? []).filter((a) => a.type === '모델링').map((a) => a.id);
      if (!ids.length) return null;
      const map = await getAssets(ids);
      const url = ids.map((id) => map[id]).find(Boolean);
      return url ? ([p.contentCode, url] as const) : null;
    });
    Promise.all(tasks).then((pairs) => {
      const next: Record<string, string> = {};
      for (const pr of pairs) if (pr) next[pr[0]] = pr[1];
      setModelUrls(next);
    });
  }, [allProducts]);
  useEffect(() => {
    const reload = () => { setFolders(loadFolders()); setAllProducts(loadProducts() as LibProduct[]); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, []);
  /** 보는 사용자 — 기본 로그인 사용자, '__all__'=전체(관리자 열람). 선택 사용자의 사용자 그룹 기준으로 컨텐츠 노출 */
  const [viewUserId, setViewUserId] = useState<string>(() => currentUserId ?? (isAdmin ? '__all__' : (users[0]?.id ?? '__all__')));
  // 상단바에서 로그인 사용자를 바꾸면 보는 사용자도 그 사용자로 동기화
  useEffect(() => { if (currentUserId) setViewUserId(currentUserId); }, [currentUserId]);
  const viewUser = users.find((u) => u.id === viewUserId) ?? null;
  // 노출여부는 항상 적용 → 비노출 제외. 컨텐츠 사용자 그룹: '전체' 공개 + 보는 사용자가 속한 그룹과 같은 컨텐츠만
  const products = useMemo(() => {
    const visibleOnly = allProducts.filter((p) => p.visible !== false);
    if (viewUserId === '__all__') return visibleOnly; // 관리자 전체 열람
    const allow = viewUser?.groupIds ?? [];
    return visibleOnly.filter((p) => p.permission === '전체' || allow.includes(p.permission ?? ''));
  }, [allProducts, viewUserId, viewUser]);
  // 설계 노출 폴더 = 외부(비-internal) + 숨김 아님 + 숨김 폴더의 하위도 제외
  const extFolders = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const hiddenUp = (f: typeof folders[number]): boolean => {
      let cur: typeof folders[number] | undefined = f;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) { if (cur.hidden) return true; seen.add(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
      return false;
    };
    return folders.filter((f) => f.kind !== 'internal' && !hiddenUp(f));
  }, [folders]);
  const filterGroups = useMemo(() => loadFilterGroups(), []);
  /** 상품 라이브러리 검색어 — 이름·코드·필터로 전체 상품 검색 */
  const [libQuery, setLibQuery] = useState('');
  /** 라이브러리 필터 — 선택 옵션으로 상품 거르기(그룹 AND · 옵션 OR) */
  const [libFilterOpen, setLibFilterOpen] = useState(false);
  const [libFilterPos, setLibFilterPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [libFilters, setLibFilters] = useState<Set<string>>(new Set());
  /** 옵션 id → 표시명 (필터 칩) */
  const filterLabel = (oid: string) => { for (const g of filterGroups) { const o = g.options.find((x) => x.id === oid); if (o) return o.name; } return oid; };
  /** 선택 필터 매칭 — 옵션이 선택된 그룹마다 1개 이상 보유해야 통과 */
  const matchFilters = (p: LibProduct) => {
    if (libFilters.size === 0) return true;
    const pv = new Set(p.filterValues ?? []);
    for (const g of filterGroups) {
      const sel = g.options.filter((o) => libFilters.has(o.id)).map((o) => o.id);
      if (sel.length && !sel.some((id) => pv.has(id))) return false;
    }
    return true;
  };
  /** 라이브러리 결과 — 검색어 또는 선택 필터가 있으면 매칭 상품만(전체에서) 추출 */
  const searchResults = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    if (!q && libFilters.size === 0) return [];
    return products.filter((p) => {
      if (!matchFilters(p as LibProduct)) return false;
      if (!q) return true;
      const fl = (p.filterValues ?? []).map((id) => filterLabel(id)).join(' ');
      return `${p.name} ${p.productCode} ${p.contentCode} ${fl}`.toLowerCase().includes(q);
    }).slice(0, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, libQuery, filterGroups, libFilters]);
  // 구성(조립) 그룹 — 그룹 관리에서 등록한 모델 그룹 + 멤버
  const swapState = useMemo(() => loadSwapState(), []);
  const memberMap = useMemo(() => expandMembers(swapState, folders, products as never), [swapState, folders, products]);
  const areas = useMemo(() => extFolders.filter((f) => f.parentId === EXT_ROOT), [extFolders]);

  const [current, setCurrent] = useState<string>(EXT_ROOT); // EXT_ROOT = 영역 목록, 그 외 = 진입한 상품군 폴더
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [navTab, setNavTab] = useState('상품 라이브러리');
  const [page, setPage] = useState(0);
  /** 상품별 치수/배치높이 편집 오버라이드 (contentCode → {w,d,h,lift}) */
  const [dimOverrides, setDimOverrides] = useState<Record<string, { w?: number; d?: number; h?: number; lift?: number }>>({});
  const [attrTab, setAttrTab] = useState<'속성설정' | '스타일 설정'>('속성설정');
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapGroupId, setSwapGroupId] = useState<string | null>(null);
  /** 그룹 플라이아웃 내 폴더 진입(드릴) — null이면 그룹에 연결된 폴더 목록 */
  const [swapFolderId, setSwapFolderId] = useState<string | null>(null);
  const [swapQuery, setSwapQuery] = useState('');
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null);
  const popDrag = useRef<{ dx: number; dy: number } | null>(null);
  const [popDragging, setPopDragging] = useState(false);
  const onPopDragStart = (e: React.PointerEvent) => {
    const el = (e.currentTarget as HTMLElement).closest('.swap-filter-pop') as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pw = r.width, ph = r.height;
    popDrag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setPopDragging(true);
    const grip = e.currentTarget as HTMLElement;
    // iframe 위에서도 포인터 이벤트가 끊기지 않도록 캡처(이벤트는 window로도 전파됨)
    try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      if (!popDrag.current) return;
      const x = Math.max(8, Math.min(window.innerWidth - pw - 8, ev.clientX - popDrag.current.dx));
      const y = Math.max(8, Math.min(window.innerHeight - ph - 8, ev.clientY - popDrag.current.dy));
      setPopPos({ x, y });
    };
    const up = () => {
      popDrag.current = null;
      setPopDragging(false);
      try { grip.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** 선택된 필터 옵션 id 집합 */
  const [swapFilters, setSwapFilters] = useState<Set<string>>(new Set());
  const toggleSwapFilter = (id: string) => setSwapFilters((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [priceOv, setPriceOv] = useState<Record<string, string>>({});
  /** 노출 변수 값 오버라이드 — contentCode → 변수명 → 값. 설계 화면에서 조정한 값이 수식 평가에 우선 적용 */
  const [varOv, setVarOv] = useState<Record<string, Record<string, number>>>({});
  const [placedCount, setPlacedCount] = useState(0);
  /** webplaner가 보낸 배치 목록 — 견적보기에서 사용 */
  type PlacedItem = { id: string; code?: string; name: string; w: number; d: number; h: number; lift: number };
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const goFolder = (id: string) => { setCurrent(id); setActiveCode(null); setPage(0); };

  /** 모델(GLB)에서 읽은 몸통 DP 타입 맵 (productCode → ["X","HD"]). webplaner가 hp3:model-dp로 전달. */
  const modelDpRef = useRef<Record<string, string[]>>({});
  /**
   * 모델(GLB) hotspot의 DL/DR(+짝 마커)로 계산한 도어 슬롯 맵 (productCode → slots).
   * webplaner가 hp3:model-doorslots로 전달. **도어 개수=슬롯 수, 각 도어 크기=슬롯 측정값(mm).**
   */
  const modelDoorSlotsRef = useRef<Record<string, { pos: 'L' | 'R'; w: number; h: number; center: [number, number, number] }[]>>({});

  // 웹플래너에서 배치 박스 선택 시 → 해당 상품으로 정보 동기화
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; code?: string; count?: number };
      if (d?.type === 'hp3:selected' && d.code) {
        const found = products.find((p) => p.productCode === d.code);
        if (found) { setActiveCode(found.contentCode); setAttrTab('속성설정'); }
      }
      // 배치 해제(빈 곳 클릭) → 공간 정보로 복귀
      if (d?.type === 'hp3:deselected') setActiveCode(null);
      // webplaner가 씬 배치 목록을 보내면 반영 (견적보기)
      if (d?.type === 'hp3:scene') {
        const sd = d as { count?: number; items?: PlacedItem[] };
        if (typeof sd.count === 'number') setPlacedCount(sd.count);
        if (Array.isArray(sd.items)) setPlacedItems(sd.items);
      }
      // webplaner가 모델에서 읽은 몸통 DP 타입 — 도어 매칭에 사용
      if (d?.type === 'hp3:model-dp') {
        const md = d as { code?: string; dpTypes?: string[] };
        if (md.code && Array.isArray(md.dpTypes)) modelDpRef.current[md.code] = md.dpTypes;
      }
      // 웹플래너 리사이즈 핸들로 치수 변경 — 상품정보 패널 사이즈에 반영 (code=productCode)
      if (d?.type === 'hp3:product-resized') {
        const md = d as { code?: string; w?: number; d?: number; h?: number };
        if (md.code) {
          const prod = products.find((pp) => pp.productCode === md.code);
          if (prod) {
            setDimOverrides((prev) => ({
              ...prev,
              [prod.contentCode]: {
                ...prev[prod.contentCode],
                ...(typeof md.w === 'number' ? { w: md.w } : {}),
                ...(typeof md.d === 'number' ? { d: md.d } : {}),
                ...(typeof md.h === 'number' ? { h: md.h } : {}),
              },
            }));
          }
        }
      }
      // webplaner가 모델 hotspot에서 계산한 도어 슬롯 — 부착 개수/크기 결정에 사용
      if (d?.type === 'hp3:model-doorslots') {
        const md = d as { code?: string; doorSlots?: { pos: 'L' | 'R'; w: number; h: number; center: [number, number, number] }[] };
        if (md.code && Array.isArray(md.doorSlots)) modelDoorSlotsRef.current[md.code] = md.doorSlots;
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [products]);

  /** 등록된 모델 URL — modelUrl 우선, 에셋 인라인 url, 없으면 IDB 하이드레이트 맵 */
  const modelUrlOf = (p: LibProduct): string | undefined =>
    p.modelUrl || p.assets?.find((a) => a.type === '모델링' && a.url)?.url || modelUrls[p.contentCode];

  /** 상품의 현재 유효 치수(오버라이드 우선) */
  const effDims = (p: LibProduct) => {
    const o = dimOverrides[p.contentCode] ?? {};
    return {
      w: o.w ?? p.w ?? 0,
      d: o.d ?? p.d ?? 0,
      h: o.h ?? p.h ?? 0,
      lift: o.lift ?? p.placeHeight ?? 0,
    };
  };

  /** 상품의 기본 정보·운영정보 전 필드를 수식 변수로 펼침.
   *  자기값: #W #D #H #lift #price #minW… #name #productCode … (접두어 없음)
   *  scope='up'이면 상위(부모=부착된 몸통/조립체) 참조 별칭으로 등록:
   *    신규 통일 표기 #up.W #up.lift #up.minW … (+ 레거시 #bodyW #body.* 하위호환) */
  const builtinVars = (p: LibProduct, dims: { w: number; d: number; h: number; lift: number }, scope: '' | 'up' = ''): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    // 자기값이면 그대로, 상위(up)면 '#up.이름' + 레거시 '#body이름' 두 벌 등록
    const put = (n: string, v: number | string) => {
      if (!scope) { out[n] = v; return; }
      out[`up.${n}`] = v;
      out[`body${n[0].toUpperCase()}${n.slice(1)}`] = v; // 레거시 하위호환(#bodyW 등)
    };
    put('lift', dims.lift);
    put('price', Number(p.price) || 0);
    put('nonStandard', p.nonStandard ? 1 : 0);
    // 문자 필드 — 조건식에서 == '값' 비교 (예: #productKind == '여닫이도어')
    put('name', p.name ?? ''); put('brand', p.brand ?? '');
    put('quoteGroup', p.quoteGroup ?? ''); put('productGroup', p.productGroup ?? '');
    put('productKind', p.productKind ?? ''); put('modelKind', p.modelKind ?? '');
    put('contentCode', p.contentCode ?? ''); put('productCode', p.productCode ?? '');
    put('modelCode', p.modelCode ?? ''); put('itemCode', p.itemCode ?? '');
    put('permission', p.permission ?? ''); put('placement', p.placement ?? '');
    put('attrType', p.attrType ?? ''); put('dp', p.dp ?? ''); put('pos', p.pos ?? '');
    const op = p.opSize ?? {};
    for (const k of ['minW', 'maxW', 'gapW', 'minD', 'maxD', 'gapD', 'minH', 'maxH', 'gapH'] as const) {
      const v = (op as Record<string, number | undefined>)[k];
      if (v != null) put(k, v);
    }
    return out;
  };

  /** 하위(자식) 참조 — 상위 상품의 구성 슬롯(부위)별 그룹 멤버를 집계해 #down.{부위}.{속성} 로 노출.
   *  count(멤버 수) + 대표 상품(기본 부위 상품 또는 첫 상품)의 W/D/H·min/max. */
  const childVars = (host: LibProduct): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    for (const s of host.modelingSlots ?? []) {
      const gid = s.groupId;
      if (!gid) continue;
      const cat = swapState.groups.find((g) => g.id === gid)?.kind ?? s.slot;
      if (!cat) continue;
      const codes = memberMap[gid] ?? [];
      const prods = codes.map((c) => products.find((p) => p.contentCode === c)).filter(Boolean) as LibProduct[];
      const rep = prods.find((p) => p.contentCode === s.defaultModelingId) ?? prods[0];
      out[`down.${cat}.count`] = prods.length;
      if (rep) {
        out[`down.${cat}.W`] = rep.w ?? 0;
        out[`down.${cat}.D`] = rep.d ?? 0;
        out[`down.${cat}.H`] = rep.h ?? 0;
        out[`down.${cat}.productCode`] = rep.productCode ?? '';
        out[`down.${cat}.modelKind`] = rep.modelKind ?? '';
      }
      // 그룹 내 치수 범위(배치 판정용)
      const ws = prods.map((p) => p.w ?? 0).filter((n) => n > 0);
      if (ws.length) { out[`down.${cat}.minW`] = Math.min(...ws); out[`down.${cat}.maxW`] = Math.max(...ws); }
    }
    return out;
  };
  /** 웹플래너로 배치(또는 갱신) 요청 — 현재 유효 치수 전송 */
  const sendPlace = (p: LibProduct) => {
    const dm = effDims(p);
    // 축별 가변 사이즈 범위 — 웹플래너 리사이즈 핸들(길이 변경 UI)용. 범위 미설정 축은 고정.
    const op = p.opSize;
    const rng = (min?: number, max?: number, gap?: number) =>
      min != null && max != null && max > min ? { min, max, gap: gap || 0 } : undefined;
    const sizeRange = op
      ? {
          ...(rng(op.minW, op.maxW, op.gapW) ? { w: rng(op.minW, op.maxW, op.gapW) } : {}),
          ...(rng(op.minD, op.maxD, op.gapD) ? { d: rng(op.minD, op.maxD, op.gapD) } : {}),
          ...(rng(op.minH, op.maxH, op.gapH) ? { h: rng(op.minH, op.maxH, op.gapH) } : {}),
        }
      : undefined;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hp3:place-product', name: p.name, code: p.productCode, modelUrl: modelUrlOf(p), color: p.color, ...dm, sizeRange },
      '*',
    );
  };
  // 상품 선택 → 우측 정보 + 웹플래너로 배치 요청
  const selectProduct = (p: LibProduct) => { setActiveCode(p.contentCode); sendPlace(p); setPlacedCount((n) => n + 1); };
  // 상품교체 → 배치된(선택된) 박스를 이 상품으로 교체
  const swapProduct = (p: LibProduct) => {
    setActiveCode(p.contentCode);
    const dm = effDims(p);
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hp3:swap-product', name: p.name, code: p.productCode, modelUrl: modelUrlOf(p), color: p.color, ...dm },
      '*',
    );
  };
  /** 우측 입력 변경 → 오버라이드 갱신 + 선택된 배치 컨텐츠를 그 자리에서 수정(새 배치 아님) */
  const setDim = (p: LibProduct, key: 'w' | 'd' | 'h' | 'lift', value: number) => {
    setDimOverrides((s) => ({ ...s, [p.contentCode]: { ...s[p.contentCode], [key]: value } }));
    const dm = { ...effDims(p), [key]: value };
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hp3:update-product', code: p.productCode, modelUrl: modelUrlOf(p), ...dm },
      '*',
    );
  };

  const subtreeCount = (id: string) => {
    const ids = folderSubtree(extFolders, id);
    return products.filter((p) => p.folderId && ids.has(p.folderId)).length;
  };

  // 진입한 폴더의 하위 폴더 + 직속 상품
  const subFolders = useMemo(() => extFolders.filter((f) => f.parentId === current), [extFolders, current]);
  const directProducts = useMemo(() => (products.filter((p) => p.folderId === current) as LibProduct[]).filter(matchFilters), [products, current, libFilters, filterGroups]);
  const pageCount = Math.max(1, Math.ceil(directProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = directProducts.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // 브레드크럼
  const trail = useMemo(() => {
    const path: { id: string; name: string }[] = [];
    let cur: string | null = current;
    while (cur && cur !== EXT_ROOT) {
      const f = extFolders.find((x) => x.id === cur);
      if (!f) break;
      path.unshift({ id: f.id, name: f.name });
      cur = f.parentId;
    }
    return [{ id: EXT_ROOT, name: '전체' }, ...path];
  }, [current, extFolders]);

  const sel = products.find((p) => p.contentCode === activeCode) ?? null;

  // 모델+품목 코드가 모두 같은 형제 상품(사이즈 변형 라인). 컨텐츠는 하나로 형상만 바뀌고 코드는 해당 사이즈 코드로 교체
  const siblings = useMemo(() => {
    if (!sel?.modelCode || !sel?.itemCode) return [] as LibProduct[];
    return products.filter((p) => p.modelCode === sel.modelCode && p.itemCode === sel.itemCode);
  }, [sel, products]);
  /** 형제 그룹에서 한 축의 선택 가능한 값(중복 제거·정렬) */
  const siblingVals = (k: 'w' | 'd' | 'h') => [...new Set(siblings.map((p) => p[k]).filter((n): n is number => typeof n === 'number'))].sort((a, b) => a - b);
  /** 축 값 선택 → 그 사이즈 상품으로 형상 변형(코드 교체). 다축은 현재값 우선 매칭 */
  const swapToSiblingSize = (k: 'w' | 'd' | 'h', val: number) => {
    if (!sel) return;
    const cur = effDims(sel);
    const want = { w: cur.w, d: cur.d, h: cur.h, [k]: val };
    const t = siblings.find((p) => p.w === want.w && p.d === want.d && p.h === want.h)
      ?? siblings.find((p) => p[k] === val) ?? null;
    if (!t) { setDim(sel, k, val); return; }
    setActiveCode(t.contentCode);
    // 하나의 컨텐츠를 그 자리에서 변형 + 코드/이름 교체 (새 배치 아님)
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hp3:update-product', code: t.productCode, name: t.name, modelUrl: modelUrlOf(t), color: t.color, w: t.w ?? 0, d: t.d ?? 0, h: t.h ?? 0 },
      '*',
    );
  };

  const [attachMsg, setAttachMsg] = useState('');
  /** 도어 컨텐츠코드 묶음 → 몸통 DP 매칭 도어를 POS(좌/우)에 자동 배치 (그룹/폴더 공통) */
  const attachDoorsFromCodes = (codes: string[], label: string, opts?: { selectBest?: boolean }) => {
    if (!sel) { setAttachMsg('⚠ 먼저 캔버스에서 몸통(베이스)을 배치·선택하세요.'); return; }
    // 몸통 DP 타입 — 모델(GLB)에서 읽은 것 우선, 없으면 상품 DP 속성 fallback.
    const modelDp = (sel.productCode ? modelDpRef.current[sel.productCode] : undefined) ?? [];
    const dpTypes = modelDp.length ? modelDp : ((sel.dp || '').trim() ? [(sel.dp || '').trim()] : []);
    if (dpTypes.length === 0) { setAttachMsg('⚠ 몸통 DP 정보가 없습니다. (모델에 DP 더미 또는 상품 DP 속성 필요)'); return; }
    const dpLabel = dpTypes.join('/');
    const dpSet = new Set(dpTypes.map((t) => t.toUpperCase()));
    const doors = codes.map((c) => products.find((p) => p.contentCode === c)).filter(Boolean) as LibProduct[];
    // DP 매칭: 도어 DP가 몸통 DP 타입 중 하나거나, 도어 DP가 'X'(범용 — 양쪽 다 부착)면 매칭.
    const matched = doors.filter((d) => {
      const ddp = (d.dp || '').trim().toUpperCase();
      return ddp === 'X' || dpSet.has(ddp);
    });
    if (matched.length === 0) { setAttachMsg(`⚠ "${label}"에 DP "${dpLabel}" 도어가 없습니다.`); return; }
    const bd = effDims(sel);
    const toNum = (v: number | boolean | string | null): number | null => (typeof v === 'number' ? v : v === true ? 1 : v === false ? 0 : null);
    // 상위(부모=몸통) 참조 — 몸통 자신의 치수 컨텍스트(#W/#D/#H=몸통값 + 하위 #down.*)로 순차 평가한 뒤
    // 부착 상품(도어) 수식에서 #up.변수명(레거시 #body.변수명)으로 참조할 수 있게 주입.
    const bodyVars: Record<string, number | string> = builtinVars(sel, bd, 'up');
    {
      const bctx: Record<string, number | string> = { W: bd.w, D: bd.d, H: bd.h, w: bd.w, d: bd.d, h: bd.h, ...builtinVars(sel, bd), ...childVars(sel) };
      for (const bv of sel.vars ?? []) {
        if (!bv.name?.trim() || varTypeOf(bv) === '조건식') continue;
        const name = bv.name.trim();
        const ov = varOv[sel.contentCode]?.[name];
        const r = ov ?? (bv.value?.trim() ? toNum(evalFormula(bv.value, bctx)) : null);
        const val = r ?? (Number(bv.value) || 0);
        bctx[name] = val;
        bodyVars[`up.${name}`] = val;    // 신규 통일 표기
        bodyVars[`body.${name}`] = val;  // 레거시 하위호환
      }
    }
    type DoorVariant = { size: number; code?: string; name: string; masterW?: number; masterH?: number; masterD?: number; modelUrl?: string; color?: string };
    const placeable: {
      code?: string; name: string; modelUrl?: string; color?: string; w: number; d: number; h: number; pos: string;
      // 견적용(콘텐츠 마스터 사이즈) — 실제 stretch 지오메트리(w/h)와 별개로 카탈로그 변형 상품의 등록 치수.
      masterW?: number; masterH?: number; masterD?: number; modelCode?: string; itemCode?: string;
      // 사이즈 변형 테이블 — 웹이 리사이즈 시 사이즈에 맞는 변형(코드/이름/마스터/모델)을 직접 선택.
      variants?: DoorVariant[];
      // 좌우 미러(피봇 보정) — POS='X' 범용 도어를 R 슬롯에 붙일 때 대칭.
      mirror?: boolean;
    }[] = [];
    const skipped: string[] = [];

    /** base 도어와 같은 (modelCode, itemCode) 패밀리의 사이즈 변형 상품 목록(폭 오름차순). 없으면 [base]. */
    const doorFamily = (base: LibProduct): LibProduct[] => {
      const mc = (base.modelCode || '').trim();
      const ic = (base.itemCode || '').trim();
      if (!mc) return [base];
      const fam = allProducts.filter((p) => (p.modelCode || '').trim() === mc && (p.itemCode || '').trim() === ic);
      return (fam.length ? fam : [base]).slice().sort((a, b) => (a.w ?? 0) - (b.w ?? 0));
    };
    /** 패밀리에서 목표 폭에 맞는 변형 선택 (정확 일치 → 이하 중 최대 → 최소). */
    const pickVariant = (fam: LibProduct[], targetW: number): LibProduct => {
      const exact = fam.find((p) => (p.w ?? 0) === targetW);
      if (exact) return exact;
      const leq = fam.filter((p) => (p.w ?? 0) <= targetW);
      return leq.length ? leq[leq.length - 1] : fam[0];
    };

    // 도어 슬롯(모델 hotspot DL/DR 기반) 우선 — 개수=슬롯 수.
    // 도어 사이즈(=견적/조회 기준) = **몸통폭 ÷ 슬롯 수**. 이 사이즈로 (modelCode,itemCode) 변형 상품을
    // 조회해 그 **상품코드·콘텐츠 마스터 사이즈**를 견적용으로 내보낸다. 실제 모델 지오메트리는
    // 슬롯 측정값(W=DL→XL, H=DL→{side}Y)으로 stretch해 몸통에 꽉 채운다.
    const slots = sel.productCode ? modelDoorSlotsRef.current[sel.productCode] : undefined;
    if (slots && slots.length > 0) {
      const doorSizeW = Math.round(bd.w / slots.length); // 몸통폭 ÷ 개수 (견적/조회 기준 사이즈)
      for (const slot of slots) {
        const base = matched.find((m) => {
          const dpos = (m.pos || '').trim().toUpperCase();
          const ddp = (m.dp || '').trim().toUpperCase();
          return dpos === slot.pos || dpos === 'X' || dpos === '' || ddp === 'X';
        }) ?? matched[0];
        // POS='X'(또는 미설정/ DP='X') = 범용 도어 → DL·DR 양쪽에 다 부착. 반대편(R)은 미러로 피봇 보정.
        const basePos = (base.pos || '').trim().toUpperCase();
        const baseDp = (base.dp || '').trim().toUpperCase();
        const universal = basePos === 'X' || basePos === '' || baseDp === 'X';
        const mirror = universal && slot.pos === 'R';
        const fam = doorFamily(base);
        const variant = pickVariant(fam, doorSizeW);
        // 변형 테이블 — 웹이 리사이즈 시 사이즈에 맞는 변형(코드/이름/마스터/모델)을 직접 선택해 표기 갱신.
        const variants: DoorVariant[] = fam.map((v) => ({
          size: v.w ?? 0, code: v.productCode, name: v.name,
          masterW: v.w, masterH: v.h, masterD: v.d, modelUrl: modelUrlOf(v), color: v.color,
        }));
        placeable.push({
          code: variant.productCode, name: variant.name, modelUrl: modelUrlOf(variant), color: variant.color ?? base.color,
          // 지오메트리: 슬롯 측정값으로 stretch(몸통에 꽉 채움). 깊이는 변형 상품 자기값.
          w: slot.w, d: variant.d ?? base.d ?? 30, h: slot.h, pos: slot.pos,
          // 견적: 변형 상품의 콘텐츠 마스터 사이즈 + 식별코드.
          masterW: variant.w ?? doorSizeW, masterH: variant.h ?? Math.round(slot.h), masterD: variant.d ?? 30,
          modelCode: variant.modelCode, itemCode: variant.itemCode, variants, mirror,
        });
      }
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'hp3:attach-doors', bodyW: bd.w, bodyD: bd.d, bodyH: bd.h, doors: placeable },
        '*',
      );
      setAttachMsg(`✓ 도어 ${slots.length}개 부착 (사이즈 ${doorSizeW}mm) — ${placeable.map((d) => `${d.pos} ${d.code ?? '-'}(마스터 ${d.masterW}×${d.masterH})`).join(', ')}`);
      return;
    }

    // 부착 대상 결정 — 기본: 매칭 도어 전부(POS별) / selectBest(모델그룹 폴더 선택):
    // 사이드(L·R)별로 목표 폭(몸통폭÷2)에 가장 가까운 도어 1개씩만 골라 부착.
    const sideOf = (d: LibProduct): string[] => {
      const dpos2 = (d.pos || '').trim().toUpperCase();
      const ddp2 = (d.dp || '').trim().toUpperCase();
      return (ddp2 === 'X' || dpos2 === 'X' || dpos2 === '') ? ['L', 'R'] : [dpos2.includes('R') ? 'R' : 'L'];
    };
    let jobs: { dr: LibProduct; side: string }[] = [];
    if (opts?.selectBest) {
      const targetW = bd.w / 2;
      for (const side of ['L', 'R']) {
        const cands = matched.filter((m) => sideOf(m).includes(side));
        if (cands.length === 0) continue;
        const best = cands.slice().sort((a, b) => Math.abs((a.w ?? 0) - targetW) - Math.abs((b.w ?? 0) - targetW))[0];
        jobs.push({ dr: best, side });
      }
    } else {
      jobs = matched.flatMap((d) => sideOf(d).map((side) => ({ dr: d, side })));
    }
    for (const { dr, side } of jobs) {
      // 변수 맵: 도어 자기값(#W/#D/#H, #w/#d/#h) + 몸통(#bodyW/#bodyD/#bodyH) + 몸통 사용자 변수(#body.이름) + 사용자 정의 변수
      const vmap: Record<string, number | string> = {
        W: dr.w ?? 0, D: dr.d ?? 0, H: dr.h ?? 0, w: dr.w ?? 0, d: dr.d ?? 0, h: dr.h ?? 0,
        ...builtinVars(dr, { w: dr.w ?? 0, d: dr.d ?? 0, h: dr.h ?? 0, lift: dr.placeHeight ?? 0 }),
        bodyW: bd.w, bodyD: bd.d, bodyH: bd.h,
        ...bodyVars,
      };
      // 변수 순차 평가 — 고정값/수식은 vmap 등록, 조건식은 배치 판정용으로 수집.
      // 이름 W/D/H(대소문자)의 '수식' 변수는 내보내기 치수로 사용(구버전 formula 대체).
      const conds: { name: string; value: string }[] = [];
      const dimVar: { w?: number | null; d?: number | null; h?: number | null } = {};
      for (const uv of dr.vars ?? []) {
        if (!uv.name?.trim()) continue;
        const name = uv.name.trim();
        const t = varTypeOf(uv);
        if (t === '조건식') { if (uv.value?.trim()) conds.push({ name, value: uv.value }); continue; }
        const ov = varOv[dr.contentCode]?.[name];
        const r = ov ?? (uv.value?.trim() ? toNum(evalFormula(uv.value, vmap)) : null);
        const val = r ?? (Number(uv.value) || 0);
        vmap[name] = val;
        const low = name.toLowerCase();
        if (low === 'w' || low === 'd' || low === 'h') {
          vmap[low] = val; vmap[low.toUpperCase()] = val; // 자기 치수 별칭(#W/#w) 동기화
          if (t === '수식') dimVar[low as 'w' | 'd' | 'h'] = r;
        }
      }
      // 조건식 — 모두 TRUE일 때만 배치 (구버전 condition 필드도 함께 검사)
      const legacyConds = dr.condition?.trim() ? [{ name: '조건', value: dr.condition }] : [];
      const failed = [...conds, ...legacyConds].find((c) => {
        const v = evalFormula(c.value, vmap);
        return !(v === true || toNum(v) === 1);
      });
      if (failed) { skipped.push(`${dr.name}(조건 미충족)`); continue; }
      // 내보내기 치수 — W/D/H 수식 변수 우선, 없으면 구버전 formula 필드 폴백
      const fw = dimVar.w ?? (dr.formula?.w?.trim() ? toNum(evalFormula(dr.formula.w, vmap)) : null);
      const fd = dimVar.d ?? (dr.formula?.d?.trim() ? toNum(evalFormula(dr.formula.d, vmap)) : null);
      const fh = dimVar.h ?? (dr.formula?.h?.trim() ? toNum(evalFormula(dr.formula.h, vmap)) : null);
      placeable.push({
        code: dr.productCode, name: dr.name, modelUrl: modelUrlOf(dr), color: dr.color,
        w: fw ?? dr.w ?? 0, d: fd ?? dr.d ?? 0, h: fh ?? dr.h ?? 0,
        pos: side,
      });
    }
    if (placeable.length === 0) { setAttachMsg(`⚠ DP "${dpLabel}" 도어가 조건을 충족하지 못해 배치 안 됨${skipped.length ? ` (${skipped.join(', ')})` : ''}`); return; }
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'hp3:attach-doors', bodyW: bd.w, bodyD: bd.d, bodyH: bd.h, doors: placeable },
      '*',
    );
    setAttachMsg(`✓ DP "${dpLabel}" 도어 ${placeable.length}개 배치 — ${placeable.map((d) => `${d.name}(${d.pos || '-'} ${d.w}×${d.h})`).join(', ')}${skipped.length ? ` / 제외 ${skipped.length}` : ''}`);
  };
  /** 모델그룹 폴더 선택 → 폴더(하위 포함) 상품 중 몸통 DP·POS·사이즈에 맞는 도어만 골라 자동 부착 */
  const attachFolderAsProduct = (folderId: string, folderName: string) => {
    const ids = folderSubtree(extFolders, folderId);
    const codes = products.filter((p) => p.folderId && ids.has(p.folderId)).map((p) => p.contentCode);
    attachDoorsFromCodes(codes, folderName, { selectBest: true });
  };

  // 운영 사이즈를 가진 상품 선택 시 정규화.
  // 규격: 각 축을 단계 옵션값으로 스냅(범위 밖이면 MIN). 비규격: 스냅하지 않고 Min~Max로 clamp만(자유 입력).
  useEffect(() => {
    if (!sel?.opSize) return;
    (['W', 'D', 'H'] as const).forEach((ax) => {
      const opts = opSizeOptions(sel.opSize, ax);
      if (!opts) return;
      const k = ax === 'W' ? 'w' : ax === 'D' ? 'd' : 'h';
      const cur = effDims(sel)[k];
      if (sel.nonStandard) {
        const min = opts[0], max = opts[opts.length - 1];
        const clamped = Math.min(max, Math.max(min, cur));
        if (clamped !== cur) setDim(sel, k, clamped);
      } else if (!opts.includes(cur)) {
        setDim(sel, k, opts[0]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCode]);

  const FolderTile = ({ id, name }: { id: string; name: string }) => {
    const rep = folderRepThumb(id, extFolders, products);
    const f = extFolders.find((x) => x.id === id);
    // 상품화 폴더 → 상품 타일처럼 노출. 클릭 시 선택된 몸통에 내부 도어 자동 부착
    if (f?.asProduct) {
      return (
        <button className="lib-tile asproduct" title="상품화 폴더 — 클릭 시 선택된 몸통에 자동 조립" onClick={() => attachFolderAsProduct(id, name)}>
          <span className={`tile-img${rep ? '' : ' folder-img'}`}>{rep ? <img src={rep} alt="" /> : <img src="/folder.png" alt="" />}</span>
          <span className="tile-name">{name} <span className="asproduct-badge">묶음</span></span>
          <span className="tile-tag">{subtreeCount(id)}개 자동조립</span>
        </button>
      );
    }
    return (
      <button className="lib-tile folder" onClick={() => goFolder(id)}>
        <span className={`tile-img${rep ? '' : ' folder-img'}`}>{rep ? <img src={rep} alt="" /> : <img src="/folder.png" alt="" />}</span>
        <span className="tile-name">{name}</span>
      </button>
    );
  };

  return (
    <main className="main design-preview">
      <div className="page-head">
        <h1>설계 미리보기</h1>
        <span className="date">stg 홈플래너 상품 라이브러리 구조 · 노출 폴더 연결 · 확인용</span>
        <label className="view-group" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-2)' }}>보는 사용자</span>
          <select className="inline-input" value={viewUserId} onChange={(e) => { setViewUserId(e.target.value); goFolder(EXT_ROOT); }}>
            {isAdmin && <option value="__all__">전체 (관리자)</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === currentUserId ? ' (나)' : ''} — 그룹 {u.groupIds.length}</option>)}
          </select>
        </label>
        <button className="btn-primary" style={{ marginLeft: 10 }} onClick={() => setQuoteOpen(true)}>
          견적보기 {placedCount > 0 ? `(${placedCount})` : ''}
        </button>
      </div>
      {attachMsg && (
        <div className="attach-toast" style={{ margin: '0 0 8px', background: attachMsg.startsWith('✓') ? 'rgba(30,42,58,0.06)' : '#fdecea', color: attachMsg.startsWith('✓') ? 'var(--ink)' : '#c0392b' }}>
          {attachMsg}
        </div>
      )}

      <div className="design-layout">
        <nav className="design-nav">
          {NAV.map((n) => (
            <button key={n} className={`design-nav-btn${navTab === n ? ' active' : ''}`} onClick={() => setNavTab(n)}>{n}</button>
          ))}
        </nav>

        <aside className="panel lib-panel">
          <div className="panel-head">
            <h2>상품 라이브러리</h2>
            <button className={`lib-filter-btn${libFilters.size ? ' on' : ''}`} aria-pressed={libFilterOpen}
              onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setLibFilterPos({ x: r.right, y: r.bottom }); setLibFilterOpen((v) => !v); }}>필터{libFilters.size > 0 && <span className="lib-filter-cnt">{libFilters.size}</span>}</button>
          </div>
          <div className="lib-search">
            <input type="search" value={libQuery} placeholder="상품 검색 (이름·코드·필터)" aria-label="상품 검색"
              onChange={(e) => setLibQuery(e.target.value)} />
            {libQuery && <button className="lib-search-x" aria-label="검색 지우기" onClick={() => setLibQuery('')}>×</button>}
          </div>
          {libFilterOpen && createPortal(<>
            <div className="lib-filter-backdrop" onClick={() => setLibFilterOpen(false)} />
            <div className="lib-filter-pop" style={{ left: libFilterPos.x + 12, top: libFilterPos.y - 30 }}>
              <div className="lib-filter-head">
                <span>필터로 거르기 <small>(그룹 AND · 옵션 OR)</small></span>
                {libFilters.size > 0 && <button className="link-mini" onClick={() => setLibFilters(new Set())}>초기화</button>}
                <button className="lib-filter-close" aria-label="닫기" onClick={() => setLibFilterOpen(false)}>×</button>
              </div>
              {filterGroups.length === 0 && <p className="hint">등록된 필터가 없습니다.</p>}
              {filterGroups.map((g) => (
                <div key={g.id} className="filter-grp">
                  <div className="filter-grp-head"><span className="filter-grp-name">{g.name}</span></div>
                  <div className="filter-opts">
                    {g.options.map((o) => {
                      const on = libFilters.has(o.id);
                      return (
                        <button key={o.id} type="button" className={`filter-opt${on ? ' on' : ''}`} aria-pressed={on}
                          onClick={() => setLibFilters((prev) => { const n = new Set(prev); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })}>
                          {on && <span className="filter-opt-chk">✓</span>}{o.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>, document.body)}

          {(libQuery.trim() || libFilters.size > 0) ? (
            /* 검색어/필터 결과 — 매칭 상품만. 각 상품의 설정 필터를 리스트로 표시 */
            <div className="lib-scroll">
              <div className="lib-section">
                <div className="lib-section-label">{libFilters.size > 0 ? '필터' : '검색'} 결과 {searchResults.length}{searchResults.length >= 100 ? '+' : ''}</div>
                {searchResults.length === 0 && <p className="empty-block">결과가 없습니다.</p>}
                <div className="lib-tiles">
                  {searchResults.map((p) => (
                    <button key={p.contentCode} className={`lib-tile${activeCode === p.contentCode ? ' active' : ''}`} onClick={() => selectProduct(p)}>
                      <span className="tile-img">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : (p.productKind || p.productGroup)}</span>
                      <span className="tile-name">{p.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : current === EXT_ROOT ? (
            /* 최초: 영역 타이틀 + 상품군 폴더 목록 (상품 미노출) */
            <div className="lib-scroll">
              {areas.length === 0 && <p className="empty-block">노출 폴더가 없습니다.</p>}
              {areas.map((area) => {
                const childFolders = extFolders.filter((f) => f.parentId === area.id);
                return (
                  <section className="lib-area" key={area.id}>
                    <div className="lib-area-title">{area.name}</div>
                    <div className="lib-tiles">
                      {childFolders.map((f) => <FolderTile key={f.id} id={f.id} name={f.name} />)}
                      {childFolders.length === 0 && <p className="empty-block" style={{ margin: '4px 0' }}>폴더 없음</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            /* 진입: 해당 상품군 하위만 */
            <>
              <div className="lib-crumb">
                {trail.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && <span className="crumb-sep">›</span>}
                    <button className={`crumb${t.id === current ? ' active' : ''}`} onClick={() => goFolder(t.id)}>{t.name}</button>
                  </span>
                ))}
              </div>
              <div className="lib-scroll">
                {subFolders.length > 0 && (
                  <div className="lib-section">
                    <div className="lib-section-label">폴더</div>
                    <div className="lib-tiles">
                      {subFolders.map((f) => <FolderTile key={f.id} id={f.id} name={f.name} />)}
                    </div>
                  </div>
                )}
                {directProducts.length > 0 && (
                  <div className="lib-section">
                    <div className="lib-section-label">상품</div>
                    <div className="lib-tiles">
                      {slice.map((p) => (
                        <button key={p.contentCode} className={`lib-tile${activeCode === p.contentCode ? ' active' : ''}`} onClick={() => selectProduct(p)}>
                          <span className="tile-img">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : (p.productKind || p.productGroup)}</span>
                          <span className="tile-name">{p.name}</span>
                          <span className="tile-tag s">{p.productCode}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {subFolders.length === 0 && directProducts.length === 0 && <p className="empty-block">이 폴더에 항목이 없습니다.</p>}
                {pageCount > 1 && (
                  <div className="lib-pager">
                    <button className="btn-ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</button>
                    <span className="lib-pager-info">{safePage + 1} / {pageCount} <span className="s">({directProducts.length}개)</span></span>
                    <button className="btn-ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>›</button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        {popDragging && <div className="drag-overlay" />}
        <section className="panel design-canvas">
          <iframe ref={iframeRef} className="three-frame" src={THREE_URL} title="HomePlanner3 설계 캔버스" />
        </section>

        <aside className="panel attr-panel">
          <div className="panel-head"><h2>{sel ? '상품 정보' : '공간 정보'}</h2></div>
          {!sel ? (
            <div className="bi">
              <div className="bi-fields">
                {([['바닥 폭', 10000, 'mm'], ['바닥 깊이', 10000, 'mm'], ['바닥 면적', 100, '㎡'], ['배치 상품', placedCount, '개']] as const).map(([label, v, unit]) => (
                  <div className="bi-field" key={label}>
                    <label>{label}</label>
                    <div className="bi-input">
                      <input type="text" value={v} readOnly />
                      <span className="bi-unit">{unit}</span>
                    </div>
                  </div>
                ))}
                <div className="bi-field">
                  <label>배경</label>
                  <div className="bi-input"><input type="text" value="흰색 (#ffffff)" readOnly /></div>
                </div>
              </div>
              <p className="hint" style={{ margin: '8px 2px' }}>배치된 상품을 선택하면 속성·스타일 정보가 표시됩니다.</p>
            </div>
          ) : (
            <div className="bi">
              {/* 카드 헤더: 썸네일 + 이름 + 코드 */}
              <div className="bi-card">
                <div className="bi-thumb">{sel.thumbUrl ? <img src={sel.thumbUrl} alt="" /> : <span>{sel.productKind || sel.productGroup}</span>}</div>
                <div className="bi-card-body">
                  <div className="bi-name">{sel.name}</div>
                  <div className="bi-code">{sel.productCode}</div>
                </div>
              </div>

              {/* 탭 */}
              <div className="bi-tabs">
                {(['속성설정', '스타일 설정'] as const).map((t) => (
                  <button key={t} className={`bi-tab${attrTab === t ? ' active' : ''}`} onClick={() => setAttrTab(t)}>{t}</button>
                ))}
              </div>

              {attrTab === '속성설정' ? (
                <div className="bi-fields">
                  {([['W 폭', 'w', 'W'], ['D 깊이', 'd', 'D'], ['H 높이', 'h', 'H'], ['배치 높이', 'lift', null]] as const).map(([label, k, ax]) => {
                    const v = effDims(sel)[k];
                    // 1) 모델+품목 형제 변형 (lift 제외) — 값이 여러개일 때만 사이즈 선택.
                    //    값이 하나뿐인 축은 아래 opSize(비규격 범위/규격 단계) 규칙으로 넘긴다.
                    const sib = ax && siblings.length > 1 ? siblingVals(k as 'w' | 'd' | 'h') : [];
                    if (sib.length > 1) {
                      const hintSib = `선택 가능: ${sib.join(', ')} mm (사이즈별 상품 교체)`;
                      return (
                        <div className="bi-field" key={k}>
                          <label>{label}<span className="bi-range-tag" title={hintSib}> ⓘ</span></label>
                          <div className="bi-input" title={hintSib}>
                            <select value={sib.includes(v) ? v : sib[0]} title={hintSib}
                              onChange={(e) => swapToSiblingSize(k as 'w' | 'd' | 'h', Number(e.target.value))}>
                              {sib.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <span className="bi-unit">mm</span>
                          </div>
                        </div>
                      );
                    }
                    // 2) 운영 사이즈(opSize) 기반
                    const op = ax ? sel.opSize : undefined;
                    const min = op?.[`min${ax}` as keyof OpSize];
                    const max = op?.[`max${ax}` as keyof OpSize];
                    const gap = op?.[`gap${ax}` as keyof OpSize];
                    const hasRange = min != null && max != null && max > min;
                    // 비규격(맞춤): 규격 사이즈의 Min/Max/Gap을 참고해 **범위 안에서 자유 입력**.
                    // 규격: GAP>1이면 **단계 선택(드롭다운)**.
                    const useSelect = hasRange && gap != null && gap > 1 && !sel.nonStandard; // 규격 단계 선택
                    const useRange = hasRange && !useSelect;                     // 비규격/GAP≤1 → 범위 자유 입력
                    const fixed = !hasRange && min != null;                      // 고정값
                    const opts = useSelect ? (opSizeOptions(op, ax!) ?? []) : [];
                    // 마우스 오버 안내 — 입력 가능한 범위/값 (비규격이면 명시)
                    const npfx = sel.nonStandard ? '비규격 ' : '';
                    const hint = useSelect ? `${npfx}선택 가능: ${opts.join(', ')} mm`
                      : useRange ? `${npfx}입력 범위: ${min} ~ ${max} mm${gap ? ` (${gap} 단위)` : ''}`
                      : fixed ? `고정값: ${min} mm`
                      : undefined;
                    return (
                      <div className="bi-field" key={k}>
                        <label>{label}{hint && <span className="bi-range-tag" title={hint}> ⓘ</span>}</label>
                        <div className="bi-input" title={hint}>
                          {useSelect ? (
                            <select value={opts.includes(v) ? v : opts[0]} title={hint} onChange={(e) => setDim(sel, k, Number(e.target.value))}>
                              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : fixed ? (
                            <input type="number" value={min} readOnly title={hint} />
                          ) : useRange ? (
                            <input type="number" value={v} min={min} max={max} step={gap || 1}
                              title={hint}
                              onChange={(e) => setDim(sel, k, Number(e.target.value) || 0)}
                              onBlur={(e) => { const n = Math.min(max!, Math.max(min!, Number(e.target.value) || min!)); if (n !== v) setDim(sel, k, n); }} />
                          ) : (
                            <input type="number" value={v}
                              onChange={(e) => setDim(sel, k, Number(e.target.value) || 0)} />
                          )}
                          <span className="bi-unit">mm</span>
                        </div>
                      </div>
                    );
                  })}
                  {/* 노출 변수 — 상품 편집에서 '노출' 체크한 변수만 표시. 값 조정 시 수식·조건 평가에 우선 적용 */}
                  {(sel.vars ?? []).filter((v) => v.expose && v.name?.trim()).map((v) => {
                    const name = v.name.trim();
                    const t = varTypeOf(v);
                    const isCond = t === '조건식';
                    const ov = varOv[sel.contentCode]?.[name];
                    const hint = `변수 ${name} (${t}) · 등록값: ${v.value || '—'}`;
                    return (
                      <div className="bi-field" key={`var-${name}`}>
                        <label>{name}<span className="bi-range-tag" title={hint}> ⓘ</span></label>
                        <div className="bi-input" title={hint}>
                          {isCond ? (
                            <input type="text" value={v.value} readOnly />
                          ) : (
                            <input type="number" value={ov ?? (Number(v.value) || 0)}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                setVarOv((s) => ({ ...s, [sel.contentCode]: { ...s[sel.contentCode], [name]: Number.isNaN(n) ? 0 : n } }));
                              }} />
                          )}
                          {!isCond && <span className="bi-unit">mm</span>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="bi-field">
                    <label>스펙파일</label>
                    {(sel.specUrls ?? []).filter((u) => u.url?.trim()).length > 0 ? (
                      <div className="bi-links">
                        {sel.specUrls!.filter((u) => u.url?.trim()).map((u, idx) => (
                          <button key={idx} className="bi-file" onClick={() => window.open(u.url, '_blank')}>↓ {u.name || '스펙파일'}</button>
                        ))}
                      </div>
                    ) : <span className="bi-empty">없음</span>}
                  </div>
                  <div className="bi-field">
                    <label>URL</label>
                    {(sel.mallUrls ?? []).filter((u) => u.url?.trim()).length > 0 ? (
                      <div className="bi-links">
                        {sel.mallUrls!.filter((u) => u.url?.trim()).map((u, idx) => (
                          <a key={idx} className="bi-link" href={u.url} target="_blank" rel="noreferrer">🔗 {u.name || u.url}</a>
                        ))}
                      </div>
                    ) : <span className="bi-empty">없음</span>}
                  </div>
                  <div className="bi-field">
                    <label>가격</label>
                    <div className="bi-input">
                      <input type="text" inputMode="numeric" placeholder="0" value={priceOv[sel.contentCode] ?? ''}
                        onChange={(e) => setPriceOv((s) => ({ ...s, [sel.contentCode]: e.target.value }))} />
                      <span className="bi-unit">원</span>
                    </div>
                  </div>
                </div>
              ) : (
                (() => {
                  /* 스타일 설정 — 컨텐츠 그룹 관리의 탭(부위)이 구분 타이틀로 표기되고,
                     그 아래에 해당 부위의 교체 묶음·폴더 단위 노출 그룹이 나열된다.
                     그룹이 없는 부위(탭)는 숨김. 구성 슬롯 조건 규칙이 있으면 해석 결과 그룹에 배지 표시. */
                  const hostDims = effDims(sel);
                  const vmap: Record<string, number | string> = {
                    W: Number(sel.w) || 0, D: Number(sel.d) || 0, H: Number(sel.h) || 0,
                    ...builtinVars(sel, hostDims), ...childVars(sel),
                  };
                  (sel.vars ?? []).forEach((v) => {
                    if (!v.name?.trim() || varTypeOf(v) === '조건식') return;
                    const ov = varOv[sel.contentCode]?.[v.name.trim()];
                    const n = ov ?? (v.value?.trim() ? Number(evalFormula(v.value, vmap)) : NaN);
                    if (!Number.isNaN(n)) vmap[v.name.trim()] = n;
                  });
                  // 구성 슬롯 규칙 해석 — 활성 그룹 id → 적용 조건(없으면 null)
                  const slotCond = new Map<string, string | null>();
                  for (const s of sel.modelingSlots ?? []) {
                    let gid = s.groupId; let cond: string | null = null;
                    for (const r of s.rules ?? []) {
                      if (!r.groupId) continue;
                      if (!r.condition?.trim()) { gid = r.groupId; cond = null; break; }
                      try { const v = evalFormula(r.condition, vmap); if (v === true || (typeof v === 'number' && v !== 0)) { gid = r.groupId; cond = r.condition; break; } } catch { /* ignore */ }
                    }
                    if (gid) slotCond.set(gid, cond);
                  }
                  const openGroupFlyout = (gid: string) => { setSwapGroupId(gid); setSwapFolderId(null); setSwapOpen(true); };
                  const sections = swapState.categories.map((cat) => {
                    const groups = swapState.groups.filter((g) => g.kind === cat && (memberMap[g.id]?.length ?? 0) > 0);
                    if (groups.length === 0) return null;
                    const doorish = cat.includes('도어');
                    return (
                      <div className="bi-swap" key={cat}>
                        <div className="bi-swap-title">{cat}{doorish && <small style={{ fontWeight: 400, color: 'var(--text-3)' }}> (DP {sel.dp || '미설정'})</small>}</div>
                        {groups.map((g) => {
                          const codes = memberMap[g.id] ?? [];
                          const active = slotCond.has(g.id);
                          const cond = slotCond.get(g.id);
                          return (
                            <button key={g.id} className="bi-swap-folder"
                              title="클릭 시 왼쪽에 이 그룹의 상품 리스트가 열립니다"
                              onClick={() => openGroupFlyout(g.id)}>
                              <span className="bi-cgroup-kind">{g.type === 'grouping' ? '폴더 노출' : '교체 묶음'}</span>
                              <span className="bi-swap-fname">{g.name}
                                {active && <small style={{ color: 'var(--text-3)', marginLeft: 6 }}>{cond ? `· 조건: ${cond}` : '· 구성 슬롯'}</small>}
                              </span>
                              <span className="bi-swap-cnt">{codes.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  }).filter(Boolean);
                  return (
                    <>
                      {sections}
                      {sections.length === 0 && (
                        <p className="hint" style={{ margin: '4px 2px' }}>등록된 부위 그룹이 없습니다 — 컨텐츠 그룹 관리에서 교체 묶음 또는 폴더 단위 노출을 구성하세요.</p>
                      )}
                      {attachMsg && <p className="hint" style={{ margin: '6px 2px', color: attachMsg.startsWith('✓') ? 'var(--ink)' : '#c0392b' }}>{attachMsg}</p>}
                    </>
                  );
                })()
              )}
            </div>
          )}
        </aside>

        {/* 교체 상품 플라이아웃 — 기본정보 패널 왼쪽 */}
        {sel && attrTab === '스타일 설정' && swapOpen && (() => {
          // 그룹 선택 시: 그룹에 연결된 폴더(모델) 목록 → 폴더 진입 시 그 폴더의 하위폴더+상품
          const groupFolderIds = swapGroupId ? (swapState.folders[swapGroupId] ?? []) : [];
          const showFolderList = !!swapGroupId && swapFolderId === null;
          // 폴더 목록 모드에서 보여줄 폴더들 (그룹에 직접 연결된 폴더)
          const groupFolders = groupFolderIds
            .map((fid) => folders.find((f) => f.id === fid))
            .filter(Boolean) as typeof folders;
          // 진입한 폴더의 하위 폴더
          const drillSubFolders = swapFolderId ? folders.filter((f) => f.parentId === swapFolderId) : [];
          // 교체 후보 상품: 그룹 진입 시 = 진입 폴더의 직속 상품 / 단일 교체 = 같은 상품군
          const inGroup = swapGroupId
            ? (swapFolderId ? products.filter((p) => p.folderId === swapFolderId) : [])
            : products.filter((p) => p.productGroup === sel.productGroup);
          const swapGroup = swapGroupId ? swapState.groups.find((g) => g.id === swapGroupId) : undefined;
          const groupName = swapGroup?.name ?? '교체 상품';
          // 폴더 단위 노출 그룹 — 폴더(모델그룹)를 진입하지 않고 상품처럼 선택.
          // 선택 시 폴더 안 상품들 중 몸통 DP·POS·사이즈에 맞는 도어를 자동 부착한다.
          const folderUnit = swapGroup?.type === 'grouping';
          // 그룹에 직접 추가된 상품(폴더 없이 items로 담긴 것) — 폴더 목록 모드에서 함께 표시
          const directProducts = showFolderList
            ? ((swapState.items?.[swapGroupId!] ?? []).map((c) => products.find((p) => p.contentCode === c)).filter(Boolean) as LibProduct[])
            : [];
          // 리스트에서 상품 선택 — 도어(DP 보유 부속)는 몸통에 부착, 그 외는 배치 상품 교체
          const pickFromFlyout = (p: LibProduct) => {
            const isDoorPart = !!(p.dp || '').trim() && (p.productKind || '').includes('도어');
            if (isDoorPart) attachDoorsFromCodes([p.contentCode], p.name);
            else swapProduct(p);
          };
          const drillName = swapFolderId ? (folders.find((f) => f.id === swapFolderId)?.name ?? '') : '';
          const flyoutTitle = swapFolderId ? `${groupName} › ${drillName}` : groupName;
          const q = swapQuery.trim().toLowerCase();
          // 선택된 필터를 그룹별로 묶음 — 그룹 간 AND, 그룹 내 OR
          const selByGroup = filterGroups
            .map((g) => g.options.filter((o) => swapFilters.has(o.id)).map((o) => o.id))
            .filter((ids) => ids.length > 0);
          const list = inGroup.filter((p) => {
            if (q && !(p.name.toLowerCase().includes(q) || p.productCode.toLowerCase().includes(q))) return false;
            const fv = p.filterValues ?? [];
            return selByGroup.every((ids) => ids.some((id) => fv.includes(id)));
          });
          return (
            <aside className="panel swap-flyout">
              <div className="panel-head"><h2>{flyoutTitle}</h2>
                <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setSwapOpen(false)}>닫기</button>
              </div>
              {!showFolderList && (
              <div className="swap-tools">
                <input className="swap-search" type="search" placeholder="상품명·코드 검색" value={swapQuery} onChange={(e) => setSwapQuery(e.target.value)} />
                <button className={`swap-filter-btn${filterPanelOpen ? ' open' : ''}`} onClick={() => { if (!filterPanelOpen) setPopPos(null); setFilterPanelOpen((v) => !v); }}>
                  필터{swapFilters.size > 0 ? ` ${swapFilters.size}` : ''}
                </button>
              </div>
              )}
              {!showFolderList && filterPanelOpen && (
              <>
              <div className="swap-filter-pop" style={popPos ? { left: popPos.x, top: popPos.y, right: 'auto' } : undefined}>
                <div className="swap-filter-pophead">
                  <span className="swap-filter-grip" onPointerDown={onPopDragStart} title="드래그하여 이동">⠿</span>
                  <span>필터</span>
                  {swapFilters.size > 0 && <button className="swap-filter-clear" onClick={() => setSwapFilters(new Set())}>초기화</button>}
                  <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setFilterPanelOpen(false)}>닫기</button>
                </div>
                <div className="swap-filters">
                {filterGroups.map((g) => {
                  // 교체 후보 상품이 실제 가진 필터 옵션만 노출
                  const opts = g.options.filter((o) => inGroup.some((p) => (p.filterValues ?? []).includes(o.id)));
                  if (opts.length === 0) return null;
                  return (
                    <div className="swap-fgroup" key={g.id}>
                      <span className="swap-fglabel">{g.name}</span>
                      <div className="swap-fchips">
                        {opts.map((o) => (
                          <button key={o.id} className={`swap-chip${swapFilters.has(o.id) ? ' on' : ''}`} onClick={() => toggleSwapFilter(o.id)}>{o.name}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              </>
              )}
              {swapFolderId && (
                <button className="swap-back" onClick={() => setSwapFolderId(null)}>‹ {groupName} 폴더 목록</button>
              )}
              <div className="swap-flyout-list">
                {showFolderList ? (
                  /* 그룹에 연결된 도어 폴더(모델) 목록 */
                  <>
                    {groupFolders.map((f) => {
                      const rep = folderRepThumb(f.id, folders, products);
                      const cnt = folderSubtree(folders, f.id);
                      const n = products.filter((p) => p.folderId && cnt.has(p.folderId)).length;
                      return (
                        <button key={f.id} className="bi-swap-item folder"
                          title={folderUnit ? '선택 시 폴더 안에서 몸통 DP·POS·사이즈에 맞는 도어를 자동 배치' : '폴더 열기'}
                          onClick={() => (folderUnit ? attachFolderAsProduct(f.id, f.name) : setSwapFolderId(f.id))}>
                          <span className="bi-swap-thumb">{rep ? <img src={rep} alt="" /> : <img src="/folder.png" alt="" />}</span>
                          <span className="bi-swap-info">
                            <span className="bi-swap-n">{f.name}</span>
                            <span className="bi-swap-c">{folderUnit ? `모델그룹 · ${n}개 (자동 매칭)` : `상품 ${n}개`}</span>
                          </span>
                          {!folderUnit && <span className="tree-caret">›</span>}
                        </button>
                      );
                    })}
                    {/* 그룹에 직접 추가된 상품 — 폴더와 같은 레벨에 표시. 도어는 클릭 시 몸통에 부착 */}
                    {directProducts.map((p) => (
                      <button key={p.contentCode} className={`bi-swap-item${p.contentCode === sel.contentCode ? ' active' : ''}`} onClick={() => pickFromFlyout(p)}>
                        <span className="bi-swap-thumb">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : (p.productKind || '·')}</span>
                        <span className="bi-swap-info">
                          <span className="bi-swap-n">{p.name}</span>
                          <span className="bi-swap-c">{p.productCode} · {p.modelKind || '-'}</span>
                        </span>
                      </button>
                    ))}
                    {groupFolders.length === 0 && directProducts.length === 0 && <p className="empty-block">이 그룹에 연결된 폴더·상품이 없습니다.<br />컨텐츠 그룹 관리에서 담아주세요.</p>}
                  </>
                ) : (
                  <>
                    {/* 진입 폴더의 하위 폴더 */}
                    {drillSubFolders.map((f) => {
                      const rep = folderRepThumb(f.id, folders, products);
                      return (
                        <button key={f.id} className="bi-swap-item folder" onClick={() => setSwapFolderId(f.id)}>
                          <span className="bi-swap-thumb">{rep ? <img src={rep} alt="" /> : <img src="/folder.png" alt="" />}</span>
                          <span className="bi-swap-info"><span className="bi-swap-n">{f.name}</span><span className="bi-swap-c">폴더</span></span>
                          <span className="tree-caret">›</span>
                        </button>
                      );
                    })}
                    {list.map((p) => (
                      <button key={p.contentCode} className={`bi-swap-item${p.contentCode === sel.contentCode ? ' active' : ''}`} onClick={() => pickFromFlyout(p)}>
                        <span className="bi-swap-thumb">{p.thumbUrl ? <img src={p.thumbUrl} alt="" /> : (p.productKind || '·')}</span>
                        <span className="bi-swap-info">
                          <span className="bi-swap-n">{p.name}</span>
                          <span className="bi-swap-c">{p.productCode} · {p.modelKind || '-'}</span>
                        </span>
                      </button>
                    ))}
                    {list.length === 0 && drillSubFolders.length === 0 && <p className="empty-block">결과 없음</p>}
                  </>
                )}
              </div>
            </aside>
          );
        })()}
      </div>

      {/* 견적보기 — 배치된 컨텐츠 내역 (확인용) */}
      {quoteOpen && (
        <div className="modal-backdrop" onClick={() => setQuoteOpen(false)}>
          <div className="modal quote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-stickyhead">
              <h2>견적보기 <small style={{ fontWeight: 400, color: 'var(--text-3)' }}>배치 컨텐츠 {placedItems.length}개</small></h2>
              <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setQuoteOpen(false)}>닫기</button>
            </div>
            <div className="quote-body">
              <table className="quote-table">
                <thead>
                  <tr><th>명칭</th><th>상품코드</th><th>모델코드</th><th>품목코드</th><th>컨텐츠코드</th><th>사이즈 (W×D×H)</th></tr>
                </thead>
                <tbody>
                  {placedItems.map((it) => {
                    const p = allProducts.find((x) => x.productCode === it.code);
                    return (
                      <tr key={it.id}>
                        <td>{p?.name ?? it.name}</td>
                        <td className="mono">{it.code ?? '-'}</td>
                        <td className="mono">{p?.modelCode ?? '-'}</td>
                        <td className="mono">{p?.itemCode ?? '-'}</td>
                        <td className="mono">{p?.contentCode ?? '-'}</td>
                        <td className="mono">{it.w} × {it.d} × {it.h}</td>
                      </tr>
                    );
                  })}
                  {placedItems.length === 0 && <tr><td colSpan={6} className="empty-row">배치된 컨텐츠가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}