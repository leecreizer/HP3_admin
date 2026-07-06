import { useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { loadConfig, saveConfig, type AdminConfig, type MenuKey } from './config';
import { INITIAL_BRANDS, INITIAL_GROUPS, type Brand, type Group } from './data/org';
import { AptPlans } from './pages/AptPlans';
import { Brands } from './pages/Brands';
import { Dashboard } from './pages/Dashboard';
import { Floorplans } from './pages/Floorplans';
import { Products } from './pages/Products';
import { Design } from './pages/Design';
import { RoleManager } from './pages/RoleManager';
import { ModelingLibrary } from './pages/ModelingLibrary';
import { StyleLibrary } from './pages/StyleLibrary';
import { Settings } from './pages/Settings';
import { Users, loadUsers, userKind } from './pages/Users';

const FIXED_TITLE: Partial<Record<MenuKey, string>> = {
  dashboard: '대시보드',
  settings: '설정',
};

function PagePlaceholder({ title }: { title: string }) {
  return (
    <main className="main">
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <section className="panel">
        <p style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>
          {title} 페이지는 준비 중입니다.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  const [active, setActive] = useState<MenuKey>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [config, setConfig] = useState<AdminConfig>(loadConfig);
  // 로그인 = 운영자 관리에 등록된 운영자만 선택 가능. 컨텐츠 사용자는 노출 대상일 뿐 로그인 주체가 아님
  const adminGrades = config.roles.filter((r) => r.scope === 'admin').map((r) => r.name);
  const everyUser = loadUsers();
  const operators = everyUser.filter((u) => userKind(u, adminGrades) === 'operator');
  const contentUsers = everyUser.filter((u) => userKind(u, adminGrades) === 'content');
  // 로그인 사용자는 고정 — 기본 계정(topbar) 매칭 운영자, 없으면 첫 운영자
  const loginUserId = (() => {
    try { const s = localStorage.getItem('hp3-login-user'); if (s && operators.some((u) => u.id === s)) return s; } catch { /* ignore */ }
    return operators.find((u) => u.email === config.topbar.userAccount)?.id ?? operators[0]?.id ?? '';
  })();
  const currentUser = operators.find((u) => u.id === loginUserId) ?? null;
  const currentUserName = currentUser?.name ?? config.topbar.userName;
  // 운영자는 콘텐츠를 전체 열람(미리보기 '전체') — 콘텐츠 그룹 소속 개념 없음
  const myGroupIds: string[] = [];
  const isAdminUser = true;
  // 브랜드/그룹은 사용자 관리에서 생성·관리되고 상품의 컨텐츠 권한 등에서 공유된다
  const loadOrg = <T,>(key: string, fallback: T): T => {
    try {
      const r = JSON.parse(localStorage.getItem(key) ?? 'null');
      // 빈 배열(소속 그룹/브랜드가 비어버린 경우)은 시드로 복구
      if (Array.isArray(r) && r.length === 0 && Array.isArray(fallback) && fallback.length) return fallback;
      return r ?? fallback;
    } catch { return fallback; }
  };
  const [brands, setBrands] = useState<Brand[]>(() => loadOrg('hp3-org-brands', INITIAL_BRANDS));
  const [groups, setGroups] = useState<Group[]>(() => loadOrg('hp3-org-groups', INITIAL_GROUPS));
  // 자동저장 없음 — 브랜드/사용자 관리의 '저장' 버튼으로만 영속화
  const orgSig = JSON.stringify({ brands, groups });
  const savedOrgSig = useRef(orgSig);
  const [orgDirty, setOrgDirty] = useState(false);
  useEffect(() => { setOrgDirty(orgSig !== savedOrgSig.current); }, [orgSig]);
  const saveOrg = () => {
    localStorage.setItem('hp3-org-brands', JSON.stringify(brands));
    localStorage.setItem('hp3-org-groups', JSON.stringify(groups));
    savedOrgSig.current = JSON.stringify({ brands, groups });
    setOrgDirty(false);
  };

  // 자동저장 없음 — Settings/등급·노출 관리의 '저장' 버튼으로만 영속화
  const configSig = JSON.stringify(config);
  const savedConfigSig = useRef(configSig);
  const [configDirty, setConfigDirty] = useState(false);
  useEffect(() => { setConfigDirty(configSig !== savedConfigSig.current); }, [configSig]);
  const saveConfigNow = (next?: AdminConfig) => {
    const target = next ?? config;
    saveConfig(target);
    savedConfigSig.current = JSON.stringify(target);
    setConfigDirty(false);
  };

  const reorderMenu = (src: MenuKey, target: MenuKey) => {
    setConfig((prev) => {
      const next = prev.mainMenu.filter((m) => m.key !== src);
      const srcItem = prev.mainMenu.find((m) => m.key === src);
      if (!srcItem) return prev;
      next.splice(next.findIndex((m) => m.key === target), 0, srcItem);
      const updated = { ...prev, mainMenu: next };
      saveConfigNow(updated); // 사이드바 직접 드래그는 즉시 반영
      return updated;
    });
  };

  // 로그인 사용자의 권한 등급(권한 관리)으로 왼쪽 메뉴 사용여부 결정
  // 사용자 권한(이름)으로 권한 관리 등급을 매칭, 없으면 상단바 미리보기 등급으로 폴백
  const currentRole = config.roles.find((r) => r.scope === 'admin' && r.name === currentUser?.role)
    ?? config.roles.find((r) => r.id === config.currentRoleId);
  const allowedMenus = new Set<MenuKey>(currentRole ? currentRole.menus : config.mainMenu.map((m) => m.key));
  allowedMenus.add('dashboard'); // 홈 대시보드는 항상 접근 가능
  // 외부 공개 배포(GitHub Pages) 여부 — 웹플래너 비공개 정책으로 설계 미리보기 '접속'만 차단.
  // 메뉴는 그대로 노출하고, 진입 시 안내 페이지를 보여준다.
  const isPublicDeploy = window.location.hostname.endsWith('github.io');

  const base = active.split('/')[0];

  // 현재 등급으로 접근 불가한 페이지에 있으면 첫 허용 메뉴로 이동
  useEffect(() => {
    if (!allowedMenus.has(base)) {
      const first = config.mainMenu.find((m) => m.visible && allowedMenus.has(m.key))?.key ?? 'dashboard';
      setActive(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.currentRoleId, loginUserId]);

  const SUB_TITLE: Record<string, string> = {
    'users/operators': '어드민 사용자 관리',
    'content-users': '홈플래너 사용자 관리',
    'products': '상품 관리',
    'brands': '브랜드 관리',
    'floorplans': '사용자 도면 관리',
    'drawings/apt': 'APT 도면 관리',
    'users/roles': '어드민 권한 관리',
    'products/modeling': '컨텐츠 그룹 관리',
    'products/styles': '스타일 그룹 관리',
    'products/catalog': '상품군·구분 관리',
    'products/quote-groups': '견적그룹 관리',
    'products/models': '모델 구분 관리',
    'products/fields': '노출 필드 관리',
    'products/filters': '필터 관리',
  };
  const page =
    SUB_TITLE[active] ??
    FIXED_TITLE[base] ??
    config.mainMenu.find((m) => m.key === base)?.label ??
    '대시보드';

  const productsPanel =
    active === 'products/catalog' ? 'catalog'
    : active === 'products/models' ? 'models'
    : active === 'products/fields' ? 'fields'
    : active === 'products/filters' ? 'filters'
    : active === 'products/quote-groups' ? 'quoteGroups'
    : 'list';

  // 권한 등급으로 허용되지 않은 메뉴는 사이드바에서 숨겨져 접근 경로가 없음.
  // (active는 등급/로그인 변경 시 첫 허용 메뉴로 자동 이동 — 별도 ‘접근 권한 없음’ 페이지 불필요)
  let content;
  switch (base) {
    case 'dashboard':
      content = <Dashboard />;
      break;
    case 'floorplans':
      content = <Floorplans />;
      break;
    case 'drawings':
      content = active === 'drawings/apt'
        ? <AptPlans />
        : <PagePlaceholder title="도면 관리" />;
      break;
    case 'users':
      if (active === 'users/roles') {
        content = <RoleManager config={config} onChange={setConfig} dirty={configDirty} onSave={() => saveConfigNow()} />;
      } else if (active === 'users/operators') {
        content = <Users variant="operator" brands={brands} setBrands={setBrands} groups={groups} setGroups={setGroups} serviceRoles={adminGrades} orgDirty={orgDirty} onSaveOrg={saveOrg} />;
      } else {
        content = <PagePlaceholder title="사용자 관리" />;
      }
      break;
    case 'content-users':
      content = <Users variant="content" brands={brands} setBrands={setBrands} groups={groups} setGroups={setGroups} serviceRoles={adminGrades} orgDirty={orgDirty} onSaveOrg={saveOrg} />;
      break;
    case 'brands':
      content = <Brands brands={brands} setBrands={setBrands} groups={groups} setGroups={setGroups} dirty={orgDirty} onSave={saveOrg} />;
      break;
    case 'content':
      content = <PagePlaceholder title="컨텐츠 관리" />;
      break;
    case 'products':
      if (active === 'products/modeling') { content = <ModelingLibrary />; break; }
      if (active === 'products/styles') { content = <StyleLibrary />; break; }
      content = (
        <Products
          groups={groups}
          panel={productsPanel}
          onClosePanel={() => setActive('products')}
          currentUser={currentUserName}
        />
      );
      break;
    case 'design':
      content = isPublicDeploy ? (
        // 외부 공개 환경 — 설계 캔버스(웹플래너) 미제공. 접속만 차단(메뉴는 유지)
        <main className="main">
          <div className="page-head"><h1>설계 미리보기</h1></div>
          <section className="panel">
            <p className="hint" style={{ margin: 0 }}>
              외부 공개 환경에서는 설계 미리보기를 사용할 수 없습니다.<br />
              사내 네트워크 또는 로컬 실행(<b>start-local.bat</b>)에서 이용해 주세요.
            </p>
          </section>
        </main>
      ) : (
        <Design users={contentUsers} currentUserId={null} myGroupIds={myGroupIds} isAdmin={isAdminUser} userName={currentUserName} />
      );
      break;
    case 'settings':
      content = <Settings config={config} onChange={setConfig} dirty={configDirty} onSave={() => saveConfigNow()} />;
      break;
    default:
      content = <PagePlaceholder title={page} />;
  }

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <Sidebar
        active={active}
        collapsed={collapsed}
        config={config}
        allowedMenus={allowedMenus}
        onSelect={setActive}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onReorder={reorderMenu}
      />
      <Topbar
        config={{ ...config.topbar, userName: currentUserName, userRole: currentUser?.role ?? config.topbar.userRole, userAccount: currentUser?.email ?? config.topbar.userAccount }}
        roles={config.roles.filter((r) => r.scope === 'admin')}
        currentRoleId={config.currentRoleId}
      />
      {content}
    </div>
  );
}