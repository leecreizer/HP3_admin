import type { Role, TopbarConfig } from '../config';

type TopbarProps = {
  section: string;
  page: string;
  config: TopbarConfig;
  /** 운영자 등급 목록·현재 등급 — 사용자 이름 옆 등급 표시용 */
  roles: Role[];
  currentRoleId: string;
};

export function Topbar({ section, page, config, roles, currentRoleId }: TopbarProps) {
  const currentRole = roles.find((r) => r.id === currentRoleId);
  return (
    <header className="topbar">
      <span className="crumb">
        {section} / <b>{page}</b>
      </span>

      <div className="user" style={{ marginLeft: 'auto' }}>
        <span className="avatar">{config.userName.charAt(0)}</span>
        <span className="user-meta">
          <span className="name">
            {config.userName}
            {currentRole && <span className="user-grade">{currentRole.name}</span>}
          </span>
          <br />
          <span className="role">
            {config.userRole} · {config.userAccount}
          </span>
        </span>
      </div>
    </header>
  );
}