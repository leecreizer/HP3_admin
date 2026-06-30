import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlusIcon, PencilIcon, SearchIcon, TrashIcon, UsersIcon } from '../components/icons';
import { ThSort, useSort } from '../components/sortable';
import { Pagination, usePagination } from '../components/Pagination';

type UserStatus = 'active' | 'dormant' | 'blocked';
/** 서비스 사용자 등급 — 설정 › 등급 관리에서 정의 (자유 문자열) */
type UserRole = string;

import type { Brand, Group } from '../data/org';

export type AppUser = {
  id: string;
  name: string;
  email: string;
  empNo: string;
  org: string;
  role: UserRole;
  joined: string;
  /** 계정 종료(만료)일. 없으면 '-' */
  endDate: string;
  lastSeen: string;
  renders: number;
  status: UserStatus;
  groupIds: string[];
  /** 도메인 구분 — operator: 어드민/포탈 로그인·메뉴 권한 / content: 콘텐츠 노출 대상(사용자 그룹) */
  kind?: 'operator' | 'content';
};

/** kind 미지정 레거시 데이터 추론: 어드민 등급(adminGrades)에 속하면 운영자, 아니면 컨텐츠 사용자 */
export function userKind(u: AppUser, adminGrades: string[]): 'operator' | 'content' {
  return u.kind ?? (adminGrades.includes(u.role) ? 'operator' : 'content');
}

const STATUS_LABEL: Record<UserStatus, { text: string; cls: string }> = {
  active: { text: '활성', cls: 'st-done' },
  dormant: { text: '휴면', cls: 'st-wait' },
  blocked: { text: '차단', cls: 'st-fail' },
};



export const INITIAL_USERS: AppUser[] = [
  { id: 'U-90413', name: '이대우', email: 'leedw0341@hanssem.com', empNo: '20180341', org: '서비스기획2팀', role: '최고관리자', joined: '2022-01-03', endDate: '-', lastSeen: '2026-06-26', renders: 3102, status: 'active', groupIds: [], kind: 'operator' },
  { id: 'U-90412', name: '강현우', email: 'kang**@hanssem.com', empNo: '20170215', org: '서비스기획2팀', role: '운영자', joined: '2024-03-12', endDate: '-', lastSeen: '2026-06-12', renders: 1284, status: 'active', groupIds: [], kind: 'operator' },
  { id: 'U-90408', name: '한소율', email: 'han**@hanssem.com', empNo: '20190842', org: '플랫폼개발팀', role: '운영자', joined: '2023-06-27', endDate: '-', lastSeen: '2026-06-12', renders: 940, status: 'active', groupIds: [], kind: 'operator' },
  { id: 'U-90411', name: '유미래', email: 'yoo**@naver.com', empNo: '-', org: '-', role: '일반', joined: '2025-11-02', endDate: '-', lastSeen: '2026-06-11', renders: 86, status: 'active', groupIds: ['g-vip'], kind: 'content' },
  { id: 'U-90410', name: '서지안', email: 'seo**@gmail.com', empNo: '-', org: '-', role: '일반', joined: '2025-08-19', endDate: '-', lastSeen: '2026-06-11', renders: 152, status: 'active', groupIds: ['g-beta', 'g-vip'], kind: 'content' },
  { id: 'U-90409', name: '민태호', email: 'min**@daum.net', empNo: 'P-0083', org: '리바트 파트너스', role: 'B2B', joined: '2024-12-01', endDate: '2026-12-31', lastSeen: '2026-06-10', renders: 2370, status: 'active', groupIds: ['g-b2b'], kind: 'content' },
  { id: 'U-90407', name: '조은별', email: 'cho**@kakao.com', empNo: '-', org: '-', role: '일반', joined: '2025-02-14', endDate: '-', lastSeen: '2026-01-03', renders: 12, status: 'dormant', groupIds: [], kind: 'content' },
  { id: 'U-90406', name: '정라온', email: 'jun**@gmail.com', empNo: '-', org: '-', role: '일반', joined: '2025-09-30', endDate: '2026-05-22', lastSeen: '2026-05-22', renders: 7, status: 'blocked', groupIds: [], kind: 'content' },
];

let userSeq = 90413;

type UserForm = {
  name: string;
  email: string;
  empNo: string;
  org: string;
  endDate: string;
  role: UserRole;
  status: UserStatus;
  groupIds: string[];
};

const EMPTY_FORM: UserForm = { name: '', email: '', empNo: '', org: '', endDate: '', role: '일반', status: 'active', groupIds: [] };

type UsersProps = {
  brands: Brand[];
  setBrands: React.Dispatch<React.SetStateAction<Brand[]>>;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  /** 운영자 등급 목록 (권한 관리, scope=admin) */
  serviceRoles: string[];
  /** 브랜드/그룹(공유 데이터) 미저장 여부 */
  orgDirty: boolean;
  /** 브랜드/그룹 영속화 */
  onSaveOrg: () => void;
  /** operator: 운영자 관리(로그인·메뉴 권한) / content: 컨텐츠 사용자(노출 대상 그룹) */
  variant?: 'operator' | 'content';
};

export const USERS_KEY = 'hp3-users';
export function loadUsers(): AppUser[] {
  try { const r = JSON.parse(localStorage.getItem(USERS_KEY) ?? 'null'); return Array.isArray(r) ? r : INITIAL_USERS; } catch { return INITIAL_USERS; }
}

export function Users({ brands, setBrands, groups, setGroups, serviceRoles, orgDirty, onSaveOrg, variant = 'operator' }: UsersProps) {
  const isContent = variant === 'content';
  /** 컨텐츠 사용자 관리의 그룹 트리는 필터·소속 연결 전용 — 브랜드/그룹 구조 편집은 브랜드 관리에서만 */
  const treeEditable = false;
  const [allUsers, setAllUsers] = useState<AppUser[]>(loadUsers);
  /** 현재 화면(variant)에 해당하는 사용자만 — 저장은 전체(allUsers)로 */
  const users = useMemo(() => allUsers.filter((u) => userKind(u, serviceRoles) === variant), [allUsers, serviceRoles, variant]);
  const setUsers = setAllUsers;
  /** 일괄 사용자 그룹 추가 팝오버 */
  const [groupAddOpen, setGroupAddOpen] = useState(false);
  const [groupAddSel, setGroupAddSel] = useState<Set<string>>(new Set());
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | UserStatus>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** 모달: null=닫힘, 'new'=추가, 그 외=수정 대상 사용자 id */
  const [editTarget, setEditTarget] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  /** 그룹 패널 너비 (드래그로 조절) */
  const [groupWidth, setGroupWidth] = useState(250);
  const resizing = useRef(false);

  /** 트리 위치 이동(드래그) — 순서는 공유 상태(브랜드 관리와 연동)에 반영 */
  const dragItem = useRef<{ kind: 'brand' | 'group'; id: string } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  /** 그룹 추가/이름변경 (브랜드 관리와 공유 상태로 연동) */
  const [addingGroupBrand, setAddingGroupBrand] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [renameGroupDraft, setRenameGroupDraft] = useState('');
  /** 최상위 그룹(브랜드) 이름변경 — 추가는 브랜드 관리에서 */
  const [brandRenaming, setBrandRenaming] = useState<string | null>(null);
  const [brandRenameDraft, setBrandRenameDraft] = useState('');
  let groupSeq = 0;

  // 자동저장 없음 — '저장' 버튼으로만 영속화 (사용자 목록 + 공유 브랜드/그룹)
  const usersSig = JSON.stringify(allUsers);
  const savedUsersSig = useRef(usersSig);
  const [usersDirty, setUsersDirty] = useState(false);
  useEffect(() => { setUsersDirty(usersSig !== savedUsersSig.current); }, [usersSig]);
  const dirty = usersDirty || orgDirty;
  const save = () => {
    localStorage.setItem(USERS_KEY, JSON.stringify(allUsers));
    savedUsersSig.current = usersSig;
    setUsersDirty(false);
    onSaveOrg();
  };

  const commitBrandRename = () => {
    const name = brandRenameDraft.trim();
    if (brandRenaming && name) setBrands((prev) => prev.map((b) => (b.id === brandRenaming ? { ...b, name } : b)));
    setBrandRenaming(null);
  };
  const deleteBrand = (id: string) => {
    const gids = groups.filter((g) => g.brandId === id).map((g) => g.id);
    setGroups((prev) => prev.filter((g) => g.brandId !== id));
    setUsers((prev) => prev.map((u) => ({ ...u, groupIds: u.groupIds.filter((gid) => !gids.includes(gid)) })));
    setBrands((prev) => prev.filter((b) => b.id !== id));
    if (activeGroup === `brand:${id}`) setActiveGroup('all');
  };

  const addGroupToBrand = (brandId: string) => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((prev) => [...prev, { id: `g-new-${Date.now()}-${++groupSeq}`, name, brandId }]);
    setNewGroupName('');
    setAddingGroupBrand(null);
  };
  const renameGroup = () => {
    const name = renameGroupDraft.trim();
    if (renamingGroup && name) setGroups((prev) => prev.map((g) => (g.id === renamingGroup ? { ...g, name } : g)));
    setRenamingGroup(null);
  };
  const deleteGroupU = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setUsers((prev) => prev.map((u) => ({ ...u, groupIds: u.groupIds.filter((gid) => gid !== id) })));
    if (activeGroup === id) setActiveGroup('all');
  };

  const reorderBrands = (srcId: string, targetId: string) => {
    if (srcId === targetId) return;
    setBrands((prev) => {
      const src = prev.find((b) => b.id === srcId);
      if (!src) return prev;
      const arr = prev.filter((b) => b.id !== srcId);
      arr.splice(arr.findIndex((b) => b.id === targetId), 0, src);
      return arr;
    });
  };

  /** 그룹을 다른 그룹 앞 또는 특정 브랜드 하위로 이동 */
  const moveGroup = (srcId: string, target: { type: 'group' | 'brand'; id: string }) => {
    setGroups((prev) => {
      const src = prev.find((g) => g.id === srcId);
      if (!src) return prev;
      const arr = prev.filter((g) => g.id !== srcId);
      if (target.type === 'brand') {
        const moved = { ...src, brandId: target.id };
        const idxs = arr.map((g, i) => (g.brandId === target.id ? i : -1)).filter((i) => i >= 0);
        if (idxs.length === 0) arr.push(moved);
        else arr.splice(idxs[idxs.length - 1] + 1, 0, moved);
        return arr;
      }
      const targetG = prev.find((g) => g.id === target.id);
      if (!targetG) return prev;
      arr.splice(arr.findIndex((g) => g.id === target.id), 0, { ...src, brandId: targetG.brandId });
      return arr;
    });
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startW = groupWidth;
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      setGroupWidth(Math.min(560, Math.max(180, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const memberCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) for (const g of u.groupIds) map.set(g, (map.get(g) ?? 0) + 1);
    return map;
  }, [users]);

  /** 브랜드에 속한 그룹 id 집합 */
  const brandGroupIds = (brandId: string) =>
    new Set(groups.filter((g) => g.brandId === brandId).map((g) => g.id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inScope = (u: AppUser) => {
      if (activeGroup === 'all') return true;
      if (activeGroup.startsWith('brand:')) {
        const ids = brandGroupIds(activeGroup.slice(6));
        return u.groupIds.some((g) => ids.has(g));
      }
      return u.groupIds.includes(activeGroup);
    };
    return users.filter(
      (u) =>
        inScope(u) &&
        (status === 'all' || u.status === status) &&
        (!q || u.name.includes(q) || u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, groups, activeGroup, query, status]);

  const groupNames = (u: AppUser) =>
    u.groupIds
      .map((gid) => groups.find((g) => g.id === gid)?.name ?? '')
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .join(', ');

  /** 사용자의 소속 브랜드 목록 (그룹에서 도출) */
  const userBrands = (u: AppUser) => {
    const ids = new Set(
      u.groupIds.map((gid) => groups.find((g) => g.id === gid)?.brandId).filter(Boolean) as string[],
    );
    return brands.filter((b) => ids.has(b.id));
  };

  const sort = useSort(visible, {
    brand: (u: AppUser) => userBrands(u).map((b) => b.name).join(', ') || '￿',
    name: (u: AppUser) => u.name,
    empNo: (u: AppUser) => u.empNo,
    org: (u: AppUser) => (u.org === '-' ? '￿' : u.org),
    role: (u: AppUser) => u.role,
    groups: (u: AppUser) => groupNames(u) || '￿', // 무소속은 맨 뒤로
    joined: (u: AppUser) => u.joined,
    endDate: (u: AppUser) => (u.endDate === '-' ? '￿' : u.endDate),
    renders: (u: AppUser) => u.renders,
    status: (u: AppUser) => u.status,
  });

  const pg = usePagination(sort.sorted.length, `${query}|${status}|${activeGroup}|${sort.sortKey}|${sort.dir}`);
  const pageRows = sort.sorted.slice(pg.start, pg.end);

  const allChecked = visible.length > 0 && visible.every((u) => checked.has(u.id));

  const toggleAll = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) visible.forEach((u) => next.delete(u.id));
      else visible.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  /** 체크된 사용자의 사용자 그룹을 선택 상태로 저장(체크=소속, 해제=제거) */
  const saveCheckedGroups = (ids: string[]) => {
    setUsers((prev) =>
      prev.map((u) => (checked.has(u.id) ? { ...u, groupIds: [...ids] } : u)),
    );
    setChecked(new Set());
    setGroupAddSel(new Set());
    setGroupAddOpen(false);
  };

  /* ---------- 사용자 추가/수정/삭제 ---------- */
  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      role: isContent ? '' : (serviceRoles[0] ?? ''),
      groupIds: isContent && activeGroup !== 'all' && !activeGroup.startsWith('brand:') ? [activeGroup] : [],
    });
    setEditTarget('new');
  };

  const openEdit = (u: AppUser) => {
    setForm({ name: u.name, email: u.email, empNo: u.empNo, org: u.org, endDate: u.endDate === '-' ? '' : u.endDate, role: u.role, status: u.status, groupIds: [...u.groupIds] });
    setEditTarget(u.id);
  };

  const formValid = isContent ? !!form.name.trim() : !!(form.name.trim() && form.empNo.trim() && form.org.trim());

  const submitForm = () => {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!formValid) return;
    if (editTarget === 'new') {
      const today = new Date().toISOString().slice(0, 10);
      setUsers((prev) => [
        {
          id: `U-${++userSeq}`,
          name,
          email,
          empNo: form.empNo.trim() || '-',
          org: form.org.trim() || '-',
          endDate: form.endDate || '-',
          role: form.role,
          status: form.status,
          groupIds: form.groupIds,
          joined: today,
          lastSeen: today,
          renders: 0,
          kind: variant,
        },
        ...prev,
      ]);
    } else if (editTarget) {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editTarget
            ? { ...u, name, email, empNo: form.empNo.trim() || '-', org: form.org.trim() || '-', endDate: form.endDate || '-', role: form.role, status: form.status, groupIds: form.groupIds }
            : u,
        ),
      );
    }
    setEditTarget(null);
  };

  const deleteUser = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const deleteChecked = () => {
    setUsers((prev) => prev.filter((u) => !checked.has(u.id)));
    setChecked(new Set());
  };

  const toggleFormGroup = (gid: string) => {
    setForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.includes(gid)
        ? prev.groupIds.filter((g) => g !== gid)
        : [...prev.groupIds, gid],
    }));
  };

  const summary = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === 'active').length,
      dormant: users.filter((u) => u.status === 'dormant').length,
      blocked: users.filter((u) => u.status === 'blocked').length,
    }),
    [users],
  );

  const editingUser = editTarget && editTarget !== 'new' ? users.find((u) => u.id === editTarget) : null;

  return (
    <main className="main">
      <div className="page-head">
        <h1>{isContent ? '홈플래너 계정 관리' : '어드민 운영자 관리'}</h1>
        <span className="date">전체 {summary.total.toLocaleString()}명{isContent ? ` · 사용자 그룹 ${groups.length}개` : ''}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && <span className="dirty-badge" title="저장되지 않은 변경사항">● 미저장 변경</span>}
          <button className="btn-primary" onClick={openAdd}>+ {isContent ? '홈플래너 계정' : '운영자'} 추가</button>
          <button className="btn-primary" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>

      <section className="kpis" aria-label="사용자 요약">
        <div className="kpi"><div className="label">전체 사용자</div><div className="value">{summary.total.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">활성</div><div className="value">{summary.active.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">휴면</div><div className="value">{summary.dormant.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">차단</div><div className="value">{summary.blocked.toLocaleString()}</div></div>
      </section>

      <div className="products-layout" style={{ gridTemplateColumns: '1fr' }}>
        {/* 그룹 트리 패널 제거 — 브랜드/그룹 구조는 브랜드 관리에서 관리(중복 제거).
            컨텐츠 사용자 관리는 사용자 등록 + 소속 연결(사용자 그룹 설정·모달)만 담당 */}
        {false && (<>
        <section className="panel folder-panel">
          <div className="panel-head">
            <h2>사용자 그룹</h2>
            <span className="sel-info" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>소속(브랜드·그룹) 관리는 브랜드 관리에서</span>
          </div>

          <ul className="tree">
            <li>
              <div
                className={`tree-item${activeGroup === 'all' ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveGroup('all')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveGroup('all'); }}
              >
                <UsersIcon size={15} />
                <span className="t">전체 사용자</span>
                <span className="count">{users.length}</span>
              </div>
            </li>
            {brands.map((b) => {
              const brandKey = `brand:${b.id}`;
              const brandGroups = groups.filter((g) => g.brandId === b.id);
              const brandMembers = new Set(
                users.filter((u) => u.groupIds.some((gid) => brandGroups.some((g) => g.id === gid))).map((u) => u.id),
              ).size;
              return (
                <li key={b.id}>
                  <div
                    className={`tree-item brand${activeGroup === brandKey ? ' active' : ''}${dropKey === `brand:${b.id}` ? ' drop-target' : ''}`}
                    role="button"
                    tabIndex={0}
                    draggable={treeEditable}
                    onClick={() => setActiveGroup(brandKey)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveGroup(brandKey); }}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; dragItem.current = { kind: 'brand', id: b.id }; }}
                    onDragEnter={() => setDropKey(`brand:${b.id}`)}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => { dragItem.current = null; setDropKey(null); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const d = dragItem.current;
                      if (d?.kind === 'brand') reorderBrands(d.id, b.id);
                      else if (d?.kind === 'group') moveGroup(d.id, { type: 'brand', id: b.id });
                      dragItem.current = null;
                      setDropKey(null);
                    }}
                  >
                    <span className="rail-grip" aria-hidden="true" style={{ opacity: 0.5, marginRight: 6, marginLeft: 0 }}>⠿</span>
                    {brandRenaming === b.id ? (
                      <input className="inline-input tree-rename" autoFocus value={brandRenameDraft}
                        onClick={(e) => e.stopPropagation()} onChange={(e) => setBrandRenameDraft(e.target.value)}
                        onBlur={commitBrandRename} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitBrandRename(); if (e.key === 'Escape') setBrandRenaming(null); }} />
                    ) : (
                      <span className="t">{b.name}</span>
                    )}
                    <span className="count">{brandMembers}</span>
                    {treeEditable && <span className="tree-actions">
                      <span
                        className="tree-act" role="button"
                        aria-label={`${b.name} 그룹 추가`} title="하위 그룹 추가"
                        onClick={(e) => { e.stopPropagation(); setAddingGroupBrand(b.id); setNewGroupName(''); }}
                      >
                        <FolderPlusIcon size={13} />
                      </span>
                      <span className="tree-act" role="button" aria-label={`${b.name} 이름 변경`} title="이름 변경"
                        onClick={(e) => { e.stopPropagation(); setBrandRenaming(b.id); setBrandRenameDraft(b.name); }}>
                        <PencilIcon size={13} />
                      </span>
                      <span className="tree-act" role="button" aria-label={`${b.name} 삭제`} title="최상위 그룹 삭제(하위 그룹 포함)"
                        onClick={(e) => { e.stopPropagation(); deleteBrand(b.id); }}>
                        <TrashIcon size={13} />
                      </span>
                    </span>}
                  </div>
                  {treeEditable && addingGroupBrand === b.id && (
                    <div className="folder-new" style={{ marginLeft: 24 }}>
                      <input
                        autoFocus
                        value={newGroupName}
                        placeholder={`${b.name} 하위 그룹 이름`}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addGroupToBrand(b.id);
                          if (e.key === 'Escape') setAddingGroupBrand(null);
                        }}
                      />
                      <button className="btn-mini" onClick={() => addGroupToBrand(b.id)}>추가</button>
                    </div>
                  )}
                  <ul className="tree">
                    {brandGroups.map((g) => (
                      <li key={g.id}>
                        <div
                          className={`tree-item${g.id === activeGroup ? ' active' : ''}${dropKey === `group:${g.id}` ? ' drop-target' : ''}`}
                          style={{ paddingLeft: 24 }}
                          role="button"
                          tabIndex={0}
                          draggable={treeEditable}
                          onClick={() => setActiveGroup(g.id)}
                          onDoubleClick={treeEditable ? () => { setRenamingGroup(g.id); setRenameGroupDraft(g.name); } : undefined}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveGroup(g.id); }}
                          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; dragItem.current = { kind: 'group', id: g.id }; }}
                          onDragEnter={() => setDropKey(`group:${g.id}`)}
                          onDragOver={(e) => e.preventDefault()}
                          onDragEnd={() => { dragItem.current = null; setDropKey(null); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const d = dragItem.current;
                            if (d?.kind === 'group') moveGroup(d.id, { type: 'group', id: g.id });
                            dragItem.current = null;
                            setDropKey(null);
                          }}
                        >
                          <span className="rail-grip" aria-hidden="true" style={{ opacity: 0.5, marginRight: 6, marginLeft: 0 }}>⠿</span>
                          {renamingGroup === g.id ? (
                            <input
                              className="inline-input tree-rename"
                              autoFocus
                              value={renameGroupDraft}
                              aria-label={`${g.name} 이름 변경`}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setRenameGroupDraft(e.target.value)}
                              onBlur={renameGroup}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') renameGroup();
                                if (e.key === 'Escape') setRenamingGroup(null);
                              }}
                            />
                          ) : (
                            <span className="t">{g.name}</span>
                          )}
                          <span className="count">{memberCount.get(g.id) ?? 0}</span>
                          {treeEditable && <span className="tree-actions">
                            <span
                              className="tree-act" role="button"
                              aria-label={`${g.name} 이름 변경`} title="이름 변경"
                              onClick={(e) => { e.stopPropagation(); setRenamingGroup(g.id); setRenameGroupDraft(g.name); }}
                            >
                              <PencilIcon size={13} />
                            </span>
                            <span
                              className="tree-act" role="button"
                              aria-label={`${g.name} 그룹 삭제`} title="그룹 삭제 (사용자는 유지, 소속만 해제)"
                              onClick={(e) => { e.stopPropagation(); deleteGroupU(g.id); }}
                            >
                              <TrashIcon size={13} />
                            </span>
                          </span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>

          <p className="hint">
            그룹을 클릭해 해당 소속 사용자만 필터링합니다. 사용자에게 그룹을 연결하려면 목록에서 사용자를 선택해 <b>사용자 그룹 설정</b> 또는 추가/수정 모달에서 지정하세요.
            브랜드·그룹의 생성·이름변경·삭제는 <b>브랜드 관리</b>에서 합니다.
          </p>
        </section>

        {/* ---- 너비 조절 핸들 ---- */}
        <div
          className="col-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="그룹 패널 너비 조절"
          onMouseDown={startResize}
        />
        </>) }

        {/* ---- 사용자 패널 ---- */}
        <section className="panel product-panel">
          <div className="product-toolbar">
            <label className="search inset">
              <SearchIcon />
              <input
                type="search"
                placeholder="이름, 이메일, ID 검색"
                aria-label="사용자 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="seg" role="tablist" aria-label="상태 필터">
              {(['all', 'active', 'dormant', 'blocked'] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={status === s}
                  className={`seg-item${status === s ? ' active' : ''}`}
                  onClick={() => setStatus(s)}
                >
                  {s === 'all' ? '전체' : STATUS_LABEL[s].text}
                </button>
              ))}
            </div>
            <span className="sel-info" style={{ marginLeft: 'auto' }}>
              {checked.size > 0 ? `${checked.size}명 선택됨` : `${visible.length}명 표시`}
            </span>
            <button className="btn-ghost" disabled={visible.length === 0}
              onClick={() => setChecked(new Set(visible.map((u) => u.id)))}>전체선택</button>
            <button className="btn-ghost" disabled={checked.size === 0}
              onClick={() => setChecked(new Set())}>선택취소</button>
            {isContent && <div className="group-add-wrap" style={{ position: 'relative' }}>
              <button
                className="btn-ghost"
                disabled={checked.size === 0}
                onClick={() => {
                  if (!groupAddOpen) {
                    // 체크된 사용자가 이미 속한 그룹을 미리 체크
                    const pre = new Set<string>();
                    users.forEach((u) => { if (checked.has(u.id)) u.groupIds.forEach((id) => pre.add(id)); });
                    setGroupAddSel(pre);
                  }
                  setGroupAddOpen((v) => !v);
                }}
              >
                사용자 그룹 설정 ▾
              </button>
              {groupAddOpen && checked.size > 0 && (
                <div className="group-add-pop">
                  <div className="group-add-pop-head">
                    사용자 그룹 선택 (복수)
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                      <button className="link-mini" disabled={groups.length === 0} onClick={() => setGroupAddSel(new Set(groups.map((g) => g.id)))}>전체선택</button>
                      <button className="link-mini" disabled={groupAddSel.size === 0} onClick={() => setGroupAddSel(new Set())}>선택취소</button>
                    </span>
                  </div>
                  <div className="group-add-list">
                    {groups.length === 0 && <p className="hint" style={{ margin: 4 }}>그룹이 없습니다.</p>}
                    {groups.map((g) => (
                      <label key={g.id} className="group-add-item">
                        <input
                          type="checkbox"
                          checked={groupAddSel.has(g.id)}
                          onChange={() => setGroupAddSel((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                        />
                        <span>{g.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="group-add-actions">
                    <button className="btn-mini ghost" onClick={() => setGroupAddOpen(false)}>닫기</button>
                    <button className="btn-mini" onClick={() => saveCheckedGroups([...groupAddSel])}>
                      저장 {groupAddSel.size > 0 ? `(${groupAddSel.size})` : ''}
                    </button>
                  </div>
                </div>
              )}
            </div>}
            <button className="btn-ghost danger" disabled={checked.size === 0} onClick={deleteChecked}>
              삭제
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th className="w-check">
                  <input type="checkbox" aria-label="전체 선택" checked={allChecked} onChange={toggleAll} />
                </th>
                {isContent && <ThSort label="브랜드" k="brand" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />}
                <ThSort label="사용자" k="name" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="사번" k="empNo" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="조직" k="org" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                {!isContent && <ThSort label="권한" k="role" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />}
                {isContent && <ThSort label="사용자 그룹" k="groups" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />}
                <ThSort label="가입일" k="joined" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="종료일" k="endDate" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="렌더 수" k="renders" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <ThSort label="상태" k="status" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
                <th style={{ width: 76 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((u) => (
                <tr key={u.id}>
                  <td className="w-check">
                    <input
                      type="checkbox"
                      aria-label={`${u.name} 선택`}
                      checked={checked.has(u.id)}
                      onChange={() => toggleOne(u.id)}
                    />
                  </td>
                  {isContent && <td>
                    {userBrands(u).length > 0
                      ? userBrands(u).map((b) => <span key={b.id} className="tag">{b.name}</span>)
                      : <span style={{ color: 'var(--text-3)' }}>–</span>}
                  </td>}
                  <td>
                    <span className="avatar mini" aria-hidden="true">{u.name.charAt(0)}</span>
                    <b style={{ fontWeight: 600 }}>{u.name}</b>
                    <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>{u.email}</span>
                  </td>
                  <td className="num">{u.empNo}</td>
                  <td>{u.org === '-' ? <span style={{ color: 'var(--text-3)' }}>–</span> : u.org}</td>
                  {!isContent && <td>{serviceRoles.includes(u.role) ? <span className="tag">{u.role}</span> : <span style={{ color: 'var(--text-3)' }}>–</span>}</td>}
                  {isContent && <td>
                    {u.groupIds.length > 0
                      ? u.groupIds.map((gid) => {
                          const g = groups.find((x) => x.id === gid);
                          return g ? <span key={gid} className="tag">{g.name}</span> : null;
                        })
                      : <span style={{ color: 'var(--text-3)' }}>–</span>}
                  </td>}
                  <td className="num">{u.joined}</td>
                  <td className="num">{u.endDate === '-' ? <span style={{ color: 'var(--text-3)' }}>–</span> : u.endDate}</td>
                  <td className="num">{u.renders.toLocaleString()}</td>
                  <td><span className={`pill ${STATUS_LABEL[u.status].cls}`}>{STATUS_LABEL[u.status].text}</span></td>
                  <td>
                    <span className="row-actions">
                      <button className="order-btn" aria-label={`${u.name} 수정`} title="수정" onClick={() => openEdit(u)}>
                        <PencilIcon size={12} />
                      </button>
                      <button className="order-btn" aria-label={`${u.name} 삭제`} title="삭제" onClick={() => deleteUser(u.id)}>
                        <TrashIcon size={12} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={isContent ? 11 : 10} className="empty-row">조건에 맞는 사용자가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
          {sort.sorted.length > 0 && (
            <Pagination
              page={pg.page}
              pageCount={pg.pageCount}
              pageSize={pg.pageSize}
              total={sort.sorted.length}
              onPage={pg.setPage}
              onPageSize={pg.setPageSize}
            />
          )}
        </section>
      </div>

      {/* ---- 사용자 추가/수정 모달 ---- */}
      {editTarget !== null && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editTarget === 'new' ? '사용자 추가' : '사용자 수정'}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">
              {editTarget === 'new' ? '사용자 추가' : `사용자 수정 — ${editingUser?.name ?? ''}`}
            </h2>

            <div className="form-grid">
              <label className="form-field">
                <span>이름 *</span>
                <input
                  autoFocus
                  className="inline-input full"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>이메일</span>
                <input
                  type="email"
                  className="inline-input full"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>사번 *</span>
                <input
                  className="inline-input full"
                  value={form.empNo}
                  placeholder="예: 20170215"
                  onChange={(e) => setForm((f) => ({ ...f, empNo: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>조직 *</span>
                <input
                  className="inline-input full"
                  value={form.org}
                  placeholder="예: 서비스기획2팀"
                  onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))}
                />
              </label>
              <label className="form-field">
                <span>종료일</span>
                <input
                  type="date"
                  className="inline-input full"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </label>
              {!isContent && <label className="form-field">
                <span>권한 (운영자 등급)</span>
                <select
                  className="inline-input full"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                >
                  <option value="">미지정</option>
                  {serviceRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>}
              <label className="form-field">
                <span>상태</span>
                <select
                  className="inline-input full"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as UserStatus }))}
                >
                  {(Object.keys(STATUS_LABEL) as UserStatus[]).map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s].text}</option>
                  ))}
                </select>
              </label>
              {isContent && <div className="form-field">
                <span>소속 사용자 그룹 (복수 선택)</span>
                {brands.map((b) => {
                  const brandGroups = groups.filter((g) => g.brandId === b.id);
                  if (brandGroups.length === 0) return null;
                  return (
                    <div key={b.id} className="check-list" style={{ alignItems: 'center' }}>
                      <span className="check-brand">{b.name}</span>
                      {brandGroups.map((g) => (
                        <label key={g.id} className="check-item">
                          <input
                            type="checkbox"
                            checked={form.groupIds.includes(g.id)}
                            onChange={() => toggleFormGroup(g.id)}
                          />
                          {g.name}
                        </label>
                      ))}
                    </div>
                  );
                })}
                {groups.length === 0 && <span className="hint">생성된 그룹이 없습니다.</span>}
              </div>}
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditTarget(null)}>취소</button>
              <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!formValid} onClick={submitForm}>
                {editTarget === 'new' ? '추가' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}