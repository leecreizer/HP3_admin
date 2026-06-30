import type { AdminConfig, MenuKey, Role } from '../config';
import { ALL_ADMIN_MENU_KEYS } from '../config';
import { TrashIcon } from '../components/icons';

let roleSeq = 0;

type RoleManagerProps = {
  config: AdminConfig;
  onChange: (next: AdminConfig) => void;
  dirty: boolean;
  onSave: () => void;
};

export function RoleManager({ config, onChange, dirty, onSave }: RoleManagerProps) {
  const menuLabel = (key: MenuKey): string => {
    if (key === 'dashboard') return '홈 대시보드';
    if (key === 'settings') return '설정';
    return config.mainMenu.find((m) => m.key === key)?.label ?? key;
  };
  const addRole = () => {
    const role: Role = {
      id: `role-custom-${Date.now()}-${++roleSeq}`,
      name: '새 운영자 등급',
      scope: 'admin',
      menus: ['dashboard'],
    };
    onChange({ ...config, roles: [...config.roles, role] });
  };
  const renameRole = (id: string, name: string) =>
    onChange({ ...config, roles: config.roles.map((r) => (r.id === id ? { ...r, name } : r)) });
  const deleteRole = (id: string) => {
    const role = config.roles.find((r) => r.id === id);
    if (role?.builtin) return;
    const nextCurrent = config.currentRoleId === id ? 'role-super' : config.currentRoleId;
    onChange({ ...config, roles: config.roles.filter((r) => r.id !== id), currentRoleId: nextCurrent });
  };
  const toggleRoleMenu = (id: string, key: MenuKey) =>
    onChange({
      ...config,
      roles: config.roles.map((r) =>
        r.id === id
          ? { ...r, menus: r.menus.includes(key) ? r.menus.filter((k) => k !== key) : [...r.menus, key] }
          : r,
      ),
    });

  const adminRoles = config.roles.filter((r) => r.scope === 'admin');

  return (
    <main className="main">
      <div className="page-head">
        <h1>권한 관리</h1>
        <span className="date">운영자 등급 {adminRoles.length}개</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-primary" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={onSave}>저장</button>
      </div>

      {/* ---- 운영자 등급 (메뉴 노출) ---- */}
      <section className="panel">
        <div className="panel-head">
          <h2>운영자 등급 · 메뉴 노출</h2>
          <span className="sel-info" style={{ marginLeft: 12 }}>등급별로 좌측 메뉴 접근 권한이 달라집니다</span>
          <button className="btn-mini" style={{ marginLeft: 'auto' }} onClick={addRole}>+ 운영자 등급 추가</button>
        </div>

        <table className="role-table">
          <thead>
            <tr>
              <th style={{ width: 180 }}>등급</th>
              {ALL_ADMIN_MENU_KEYS.map((k) => (
                <th key={k} className="role-menu-col">{menuLabel(k)}</th>
              ))}
              <th style={{ width: 46 }}></th>
            </tr>
          </thead>
          <tbody>
            {adminRoles.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    className="inline-input"
                    style={{ width: 150 }}
                    value={r.name}
                    aria-label={`${r.name} 등급명`}
                    onChange={(e) => renameRole(r.id, e.target.value)}
                  />
                  {r.builtin && <span className="tag" style={{ marginLeft: 6 }}>기본</span>}
                </td>
                {ALL_ADMIN_MENU_KEYS.map((k) => {
                  const locked = r.id === 'role-super'; // 최고관리자는 전체 고정
                  const dash = k === 'dashboard'; // 대시보드는 항상 접근
                  return (
                    <td key={k} className="role-menu-cell">
                      <input
                        type="checkbox"
                        aria-label={`${r.name} - ${menuLabel(k)} 접근`}
                        checked={r.menus.includes(k) || dash}
                        disabled={locked || dash}
                        onChange={() => toggleRoleMenu(r.id, k)}
                      />
                    </td>
                  );
                })}
                <td>
                  {!r.builtin && (
                    <button className="order-btn" aria-label={`${r.name} 삭제`} title="등급 삭제" onClick={() => deleteRole(r.id)}>
                      <TrashIcon size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">
          체크된 메뉴만 해당 등급 운영자에게 노출됩니다. <b>홈 대시보드</b>는 항상 접근 가능하고, <b>최고관리자</b>는 전체 고정입니다.
          상단바의 <b>등급</b> 선택으로 실제 노출을 미리볼 수 있습니다.
        </p>
      </section>
    </main>
  );
}