/** 내장 페이지 키. 커스텀 메뉴는 'custom-*' 형태의 자유 키를 사용한다. */
export type BuiltinMenuKey =
  | 'dashboard'
  | 'drawings'
  | 'floorplans'
  | 'users'
  | 'content-users'
  | 'content'
  | 'brands'
  | 'products'
  | 'design'
  | 'settings';

export type MenuKey = BuiltinMenuKey | (string & {});

export type MenuConfig = {
  key: MenuKey;
  label: string;
  visible: boolean;
};

export type TopbarConfig = {
  brandTitle: string;
  brandSub: string;
  showSearch: boolean;
  searchPlaceholder: string;
  showNotifications: boolean;
  userName: string;
  userRole: string;
  userAccount: string;
};

/** 등급(권한) 적용 범위 */
export type RoleScope = 'admin' | 'service';

export type Role = {
  id: string;
  name: string;
  scope: RoleScope;
  /** admin 등급: 접근 가능한 메뉴 키 목록('dashboard' 포함). service 등급: 미사용 */
  menus: MenuKey[];
  /** 시스템 기본 등급 — 삭제 불가 */
  builtin?: boolean;
};

export type AdminConfig = {
  mainMenu: MenuConfig[];
  /** 사용자가 명시적으로 삭제한 기본 메뉴 키 — 새 기본 메뉴 병합 시 부활 방지 */
  removedMenus: string[];
  /** 상품관리 하위메뉴 — 이름변경·표시숨김·순서 */
  productSubMenus: MenuConfig[];
  topbar: TopbarConfig;
  /** 등급(권한) 정의 — 운영자/서비스 사용자 */
  roles: Role[];
  /** 현재(미리보기) 운영자 등급 id — 좌측 메뉴 노출 기준 */
  currentRoleId: string;
};

/** admin 등급이 가질 수 있는 전체 메뉴 키(대시보드+주메뉴+시스템) */
export const ALL_ADMIN_MENU_KEYS: MenuKey[] = [
  'dashboard', 'users', 'content-users', 'content', 'brands', 'drawings', 'floorplans', 'products', 'design', 'settings',
];

/** 기본 등급 세트 (설정에서 추가·수정·삭제 가능) */
export const DEFAULT_ROLES: Role[] = [
  { id: 'role-super', name: '최고관리자', scope: 'admin', menus: [...ALL_ADMIN_MENU_KEYS], builtin: true },
  { id: 'role-operator', name: '운영자', scope: 'admin', menus: ['dashboard', 'drawings', 'floorplans', 'content', 'products', 'design'], builtin: true },
  { id: 'role-viewer', name: '뷰어', scope: 'admin', menus: ['dashboard', 'drawings', 'floorplans'], builtin: true },
  { id: 'role-user', name: '일반', scope: 'service', menus: [], builtin: true },
  { id: 'role-b2b', name: 'B2B', scope: 'service', menus: [], builtin: true },
  { id: 'role-vip', name: 'VIP', scope: 'service', menus: [], builtin: true },
];

/** 상품관리 하위메뉴 기본값 (키는 고정, 라벨·표시·순서만 설정 가능) */
export const DEFAULT_PRODUCT_SUBMENUS: MenuConfig[] = [
  { key: 'products/modeling', label: '컨텐츠 그룹 관리', visible: true },
  { key: 'products/styles', label: '스타일 그룹 관리', visible: true },
  { key: 'products/catalog', label: '상품군·구분 관리', visible: true },
  { key: 'products/quote-groups', label: '견적그룹 관리', visible: true },
  { key: 'products/models', label: '모델 구분 관리', visible: true },
  { key: 'products/fields', label: '노출 필드 관리', visible: true },
  { key: 'products/filters', label: '필터 관리', visible: true },
];

export const DEFAULT_CONFIG: AdminConfig = {
  mainMenu: [
    { key: 'users', label: '사용자 관리', visible: true },
    { key: 'content', label: '컨텐츠 관리', visible: true },
    { key: 'drawings', label: '도면 관리', visible: true },
    { key: 'design', label: '설계 미리보기', visible: true },
  ],
  removedMenus: [],
  productSubMenus: DEFAULT_PRODUCT_SUBMENUS,
  topbar: {
    brandTitle: 'HomePlanner3',
    brandSub: 'HANSSEM ADMIN',
    showSearch: true,
    searchPlaceholder: '사용자, 상품, 렌더 ID 검색…',
    showNotifications: true,
    userName: '이대우',
    userRole: '시스템 관리자',
    userAccount: 'leedw0341@hanssem.com',
  },
  roles: DEFAULT_ROLES,
  currentRoleId: 'role-super',
};

const CONFIG_KEY = 'hp3-admin-config';

export function loadConfig(): AdminConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as AdminConfig | null;
    if (!saved) return DEFAULT_CONFIG;
    // 저장된 메뉴 구성 유지. 새로 생긴 기본 메뉴는 병합하되, 사용자가 삭제한 메뉴는 부활시키지 않음
    const removed = saved.removedMenus ?? [];
    const validMenu = saved.mainMenu
      .filter((m) => DEFAULT_CONFIG.mainMenu.some((d) => d.key === m.key) || m.key.startsWith('custom-'))
      // 기본 메뉴 라벨은 항상 최신 기본값 사용(이름 개편 반영). 순서·표시 여부는 저장본 유지
      .map((m) => {
        const d = DEFAULT_CONFIG.mainMenu.find((x) => x.key === m.key);
        return d ? { ...m, label: d.label } : m;
      });
    const missing = DEFAULT_CONFIG.mainMenu.filter(
      (d) => !validMenu.some((m) => m.key === d.key) && !removed.includes(d.key),
    );
    // 상품 하위메뉴 — 저장된 순서/표시 유지. 라벨은 최신 기본값 사용(키·라벨은 시스템 고정 항목)
    const savedSubs = (saved.productSubMenus ?? [])
      .filter((s) => DEFAULT_PRODUCT_SUBMENUS.some((d) => d.key === s.key))
      .map((s) => ({ ...s, label: DEFAULT_PRODUCT_SUBMENUS.find((d) => d.key === s.key)!.label }));
    const missingSubs = DEFAULT_PRODUCT_SUBMENUS.filter((d) => !savedSubs.some((s) => s.key === d.key));
    // 등급 — 저장본 유지, 없으면 기본값. 기본 등급(builtin)은 항상 병합 보장
    const savedRoles = saved.roles ?? [];
    const mergedRoles = [
      ...DEFAULT_ROLES.map((d) => {
        const s = savedRoles.find((r) => r.id === d.id);
        if (!s) return d;
        // 최고관리자(superuser)는 항상 모든 어드민 메뉴 접근 — 새 메뉴 추가 시에도 자동 포함
        if (d.id === 'role-super') return { ...s, menus: [...ALL_ADMIN_MENU_KEYS] };
        return s;
      }),
      ...savedRoles.filter((s) => !DEFAULT_ROLES.some((d) => d.id === s.id)),
    ];
    const currentRoleId = mergedRoles.some((r) => r.id === saved.currentRoleId)
      ? saved.currentRoleId
      : 'role-super';
    return {
      mainMenu: [...validMenu, ...missing],
      removedMenus: removed,
      productSubMenus: [...savedSubs, ...missingSubs],
      topbar: { ...DEFAULT_CONFIG.topbar, ...saved.topbar },
      roles: mergedRoles,
      currentRoleId,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AdminConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}