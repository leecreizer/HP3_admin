import type { Role, TopbarConfig } from '../config';

type TopbarProps = {
  config: TopbarConfig;
  /** 운영자 등급 목록·현재 등급 — 사용자 이름 옆 등급 표시용 */
  roles: Role[];
  currentRoleId: string;
};

export function Topbar({ config, roles, currentRoleId }: TopbarProps) {
  const currentRole = roles.find((r) => r.id === currentRoleId);
  return (
    // 페이지 타이틀과 같은 라인에 겹쳐 뜨는 우상단 로그인 정보 (별도 상단 행 없음)
    <header className="topbar">
      <div className="user">
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