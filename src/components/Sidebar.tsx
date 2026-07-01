import { Fragment, useRef, useState, type ReactNode } from 'react';
import type { AdminConfig, MenuKey } from '../config';
import {
  ApiIcon,
  BrandIcon,
  CollapseIcon,
  ContentIcon,
  FloorplanIcon,
  HomeIcon,
  ProductIcon,
  SettingsIcon,
  StatsIcon,
  UsersIcon,
} from './icons';

export type { MenuKey };

const BUILTIN_ICONS: Record<string, ReactNode> = {
  dashboard: <HomeIcon />,
  floorplans: <FloorplanIcon />,
  users: <UsersIcon />,
  brands: <BrandIcon />,
  products: <ProductIcon />,
  stats: <StatsIcon />,
  api: <ApiIcon />,
  settings: <SettingsIcon />,
};

export function menuIcon(key: MenuKey): ReactNode {
  return BUILTIN_ICONS[key] ?? <ContentIcon />;
}

const BADGES: Partial<Record<MenuKey, number>> = {};

const SYSTEM_MENU: { key: MenuKey; label: string }[] = [
  { key: 'settings', label: '설정' },
];

/** 사용자 관리 하위 메뉴 (고정) — 부모 '사용자 관리'는 빈 그룹, 실제 화면은 하위에서 */
const USER_SUBMENUS: { key: MenuKey; label: string }[] = [
  { key: 'users/operators', label: '어드민 운영자 관리' },
  { key: 'content-users', label: '홈플래너 계정 관리' },
  { key: 'users/roles', label: '권한 관리' },
];

/** 컨텐츠 관리 하위 메뉴 — 상품 관리(+상품 하위), 가격 관리, 브랜드 관리 */
const CONTENT_SUBMENUS: { key: MenuKey; label: string }[] = [
  { key: 'products', label: '상품 관리' },
  { key: 'brands', label: '브랜드 관리' },
];

/** 'products/groups' → 'products' */
const baseKey = (k: MenuKey) => k.split('/')[0];
/** 부모 메뉴가 포함하는 하위 base 키들(펼침·활성 판정용) */
const childBases = (key: MenuKey): string[] =>
  key === 'users' ? ['users', 'content-users']
  : key === 'content' ? ['content', 'products', 'brands']
  : [key];

type SidebarProps = {
  active: MenuKey;
  collapsed: boolean;
  config: AdminConfig;
  /** 현재 등급이 접근 가능한 메뉴 키 집합 */
  allowedMenus: Set<MenuKey>;
  onSelect: (key: MenuKey) => void;
  onToggleCollapse: () => void;
  onReorder: (src: MenuKey, target: MenuKey) => void;
};

type RailButtonProps = {
  itemKey: MenuKey;
  label: string;
  active: boolean;
  onSelect: (key: MenuKey) => void;
  hasSubs?: boolean;
  expanded?: boolean;
  draggable?: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
};

function RailButton({
  itemKey, label, active, onSelect, hasSubs, expanded,
  draggable, dragging, dropTarget,
  onDragStart, onDragEnter, onDragEnd, onDrop,
}: RailButtonProps) {
  const badge = BADGES[itemKey];
  return (
    <button
      className={`rail-item${active ? ' active' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}`}
      data-label={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(itemKey)}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
    >
      <span className="rail-ico">{menuIcon(itemKey)}</span>
      <span className="rail-label">{label}</span>
      {badge !== undefined && <span className="badge">{badge}</span>}
      {hasSubs && <span className={`rail-caret${expanded ? ' open' : ''}`} aria-hidden="true">›</span>}
      {draggable && <span className="rail-grip" aria-hidden="true">⠿</span>}
    </button>
  );
}

export function Sidebar({ active, collapsed, config, allowedMenus, onSelect, onToggleCollapse, onReorder }: SidebarProps) {
  const dragKey = useRef<MenuKey | null>(null);
  const [dragging, setDragging] = useState<MenuKey | null>(null);
  const [over, setOver] = useState<MenuKey | null>(null);

  // 표시 ON + 현재 등급이 접근 가능한 메뉴만 노출
  const visibleMenu = config.mainMenu.filter((m) => m.visible && allowedMenus.has(m.key));

  return (
    <aside className="sidebar">
      <nav className="rail" aria-label="주 메뉴">
        <div className="rail-head">
          <button
            className={`rail-brand${active === 'dashboard' ? ' current' : ''}`}
            data-label="홈 대시보드"
            aria-label="홈 대시보드"
            aria-current={active === 'dashboard' ? 'page' : undefined}
            onClick={() => onSelect('dashboard')}
          >
            <HomeIcon size={20} />
          </button>
          <div className="rail-title">
            {config.topbar.brandTitle}
            <small>{config.topbar.brandSub}</small>
          </div>
        </div>

        {visibleMenu.map((item) => {
          const subs =
            item.key === 'users' ? USER_SUBMENUS
            : item.key === 'content' ? CONTENT_SUBMENUS
            : undefined;
          const baseActive = childBases(item.key).includes(baseKey(active));
          return (
            <div key={item.key} className="rail-group">
              <RailButton
                itemKey={item.key}
                label={item.label}
                active={baseActive}
                onSelect={onSelect}
                hasSubs={!!subs && subs.length > 0}
                expanded={baseActive}
                draggable
                dragging={dragging === item.key}
                dropTarget={over === item.key && dragging !== item.key}
                onDragStart={() => {
                  dragKey.current = item.key;
                  setDragging(item.key);
                }}
                onDragEnter={() => setOver(item.key)}
                onDragEnd={() => {
                  dragKey.current = null;
                  setDragging(null);
                  setOver(null);
                }}
                onDrop={() => {
                  if (dragKey.current && dragKey.current !== item.key) onReorder(dragKey.current, item.key);
                }}
              />
              {subs && subs.length > 0 && baseActive && !collapsed && (
                <div className="rail-subs">
                  {subs.map((sub) => (
                    <Fragment key={sub.key}>
                      <button
                        className={`rail-sub${active === sub.key ? ' active' : ''}`}
                        aria-current={active === sub.key ? 'page' : undefined}
                        onClick={() => onSelect(sub.key)}
                      >
                        {sub.label}
                      </button>
                      {/* 상품 관리 하위(컨텐츠 그룹·스타일 그룹·상품군 …) — 한 단계 더 들여쓰기 */}
                      {item.key === 'content' && sub.key === 'products' && baseKey(active) === 'products' &&
                        config.productSubMenus.filter((s) => s.visible).map((ps) => (
                          <button
                            key={ps.key}
                            className={`rail-sub rail-sub-2${active === ps.key ? ' active' : ''}`}
                            aria-current={active === ps.key ? 'page' : undefined}
                            onClick={() => onSelect(ps.key)}
                          >
                            {ps.label}
                          </button>
                        ))}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="rail-divider" />

        {SYSTEM_MENU.filter((item) => allowedMenus.has(item.key)).map((item) => (
          <RailButton key={item.key} itemKey={item.key} label={item.label} active={item.key === active} onSelect={onSelect} />
        ))}

        <div className="rail-foot">
          <button
            className="rail-item"
            data-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
            aria-label={collapsed ? '메뉴 펼치기' : '메뉴 접기'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
          >
            <span className={`rail-ico collapse-ico${collapsed ? ' flipped' : ''}`}>
              <CollapseIcon />
            </span>
            <span className="rail-label">메뉴 접기</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}