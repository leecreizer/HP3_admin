import { useRef, useState } from 'react';
import type { AdminConfig, MenuKey } from '../config';
import { DEFAULT_CONFIG } from '../config';
import { menuIcon } from '../components/Sidebar';
import { TrashIcon } from '../components/icons';

let customSeq = 0;

type SettingsProps = {
  config: AdminConfig;
  onChange: (next: AdminConfig) => void;
  dirty: boolean;
  onSave: () => void;
};

export function Settings({ config, onChange, dirty, onSave }: SettingsProps) {
  const [newMenuName, setNewMenuName] = useState('');
  /** 좌측 메뉴 관리에서 선택된 메뉴 — 우측 패널이 이 메뉴의 하위메뉴 설정으로 전환 */
  const [selMenu, setSelMenu] = useState<MenuKey>(config.mainMenu[0]?.key ?? 'users');

  const addMenu = () => {
    const label = newMenuName.trim();
    if (!label) return;
    onChange({
      ...config,
      mainMenu: [
        ...config.mainMenu,
        { key: `custom-${Date.now()}-${++customSeq}`, label, visible: true },
      ],
    });
    setNewMenuName('');
  };

  const removeMenu = (key: MenuKey) => {
    onChange({ ...config, mainMenu: config.mainMenu.filter((m) => m.key !== key) });
  };

  /** 데이터 백업/복원 — 모든 hp3-* localStorage 키 */
  const BACKUP_KEYS = ['hp3-products-state', 'hp3-swap-groups', 'hp3-users', 'hp3-org-brands', 'hp3-org-groups', 'hp3-login-user', 'hp3-admin-config'];
  const exportData = () => {
    const dump: Record<string, string | null> = {};
    BACKUP_KEYS.forEach((k) => { dump[k] = localStorage.getItem(k); });
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hp3-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importRef = useRef<HTMLInputElement>(null);
  const importData = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result as string) as Record<string, string | null>;
        Object.entries(obj).forEach(([k, v]) => { if (v != null) localStorage.setItem(k, v); });
        alert('복원 완료. 새로고침합니다.');
        location.reload();
      } catch { alert('가져오기 실패: 올바른 백업 파일이 아닙니다.'); }
    };
    reader.readAsText(file);
  };
  const setTopbar = (patch: Partial<AdminConfig['topbar']>) =>
    onChange({ ...config, topbar: { ...config.topbar, ...patch } });

  const setMenuLabel = (key: MenuKey, label: string) =>
    onChange({
      ...config,
      mainMenu: config.mainMenu.map((m) => (m.key === key ? { ...m, label } : m)),
    });

  const setMenuVisible = (key: MenuKey, visible: boolean) =>
    onChange({
      ...config,
      mainMenu: config.mainMenu.map((m) => (m.key === key ? { ...m, visible } : m)),
    });

  const moveMenu = (key: MenuKey, dir: -1 | 1) => {
    const idx = config.mainMenu.findIndex((m) => m.key === key);
    const to = idx + dir;
    if (to < 0 || to >= config.mainMenu.length) return;
    const next = [...config.mainMenu];
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange({ ...config, mainMenu: next });
  };

  /* ---- 메뉴별 하위메뉴 (이름변경·표시·순서) — 좌측에서 메뉴 선택 → 우측에서 편집 ---- */
  const subList = config.subMenus[selMenu] ?? [];
  const selMenuLabel = config.mainMenu.find((m) => m.key === selMenu)?.label ?? selMenu;
  const patchSubs = (next: typeof subList) =>
    onChange({ ...config, subMenus: { ...config.subMenus, [selMenu]: next } });
  const setSubLabel = (key: string, label: string) =>
    patchSubs(subList.map((s) => (s.key === key ? { ...s, label } : s)));
  const setSubVisible = (key: string, visible: boolean) =>
    patchSubs(subList.map((s) => (s.key === key ? { ...s, visible } : s)));
  const moveSub = (key: string, dir: -1 | 1) => {
    const idx = subList.findIndex((s) => s.key === key);
    const to = idx + dir;
    if (to < 0 || to >= subList.length) return;
    const next = [...subList];
    [next[idx], next[to]] = [next[to], next[idx]];
    patchSubs(next);
  };

  return (
    <main className="main">
      <div className="page-head">
        <h1>설정</h1>
        <span className="date">변경 후 '저장'을 눌러야 반영됩니다</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-ghost" style={{ marginLeft: dirty ? 0 : 'auto' }} onClick={() => onChange(DEFAULT_CONFIG)}>
          기본값으로 되돌리기
        </button>
        <button className="btn-primary" disabled={!dirty} onClick={onSave}>저장</button>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* ---- 좌측 메뉴 관리 ---- */}
        <section className="panel">
          <div className="panel-head">
            <h2>좌측 메뉴 관리</h2>
            <span className="sel-info" style={{ marginLeft: 12 }}>순서 · 이름 · 표시 — 행을 선택하면 우측에서 하위메뉴 설정</span>
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 70 }}>순서</th>
                <th>메뉴 이름</th>
                <th style={{ width: 70 }}>표시</th>
                <th style={{ width: 46 }}></th>
              </tr>
            </thead>
            <tbody>
              {config.mainMenu.map((m, i) => (
                <tr
                  key={m.key}
                  onClick={() => setSelMenu(m.key)}
                  style={selMenu === m.key ? { background: 'rgba(30, 42, 58, 0.07)', cursor: 'pointer' } : { cursor: 'pointer' }}
                  aria-selected={selMenu === m.key}
                >
                  <td>
                    <span className="order-btns">
                      <button
                        className="order-btn"
                        aria-label={`${m.label} 위로`}
                        disabled={i === 0}
                        onClick={() => moveMenu(m.key, -1)}
                      >
                        ▲
                      </button>
                      <button
                        className="order-btn"
                        aria-label={`${m.label} 아래로`}
                        disabled={i === config.mainMenu.length - 1}
                        onClick={() => moveMenu(m.key, 1)}
                      >
                        ▼
                      </button>
                    </span>
                  </td>
                  <td>
                    <span className="menu-ico-cell">{menuIcon(m.key)}</span>
                    <input
                      className="inline-input"
                      value={m.label}
                      aria-label={`${m.key} 메뉴 이름`}
                      onChange={(e) => setMenuLabel(m.key, e.target.value)}
                    />
                  </td>
                  <td>
                    <button
                      className={`switch${m.visible ? ' on' : ''}`}
                      role="switch"
                      aria-checked={m.visible}
                      aria-label={`${m.label} 메뉴 표시 여부`}
                      onClick={() => setMenuVisible(m.key, !m.visible)}
                    />
                  </td>
                  <td>
                    <button
                      className="order-btn"
                      aria-label={`${m.label} 메뉴 삭제`}
                      title="메뉴 삭제 (기본 메뉴는 '기본값으로 되돌리기'로 복구할 수 있습니다)"
                      onClick={() => removeMenu(m.key)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="folder-new" style={{ marginTop: 14 }}>
            <input
              value={newMenuName}
              placeholder="새 메뉴 이름"
              aria-label="새 메뉴 이름"
              onChange={(e) => setNewMenuName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addMenu(); }}
            />
            <button className="btn-mini" onClick={addMenu}>메뉴 추가</button>
          </div>
          <p className="hint">
            추가한 메뉴는 "준비 중" 페이지로 연결됩니다. 삭제한 기본 메뉴는 "기본값으로 되돌리기"로 복구할 수 있고,
            사이드바에서 메뉴를 직접 드래그해서 순서를 바꿀 수도 있습니다.
          </p>
        </section>

        {/* ---- 하위메뉴 관리 — 좌측에서 선택한 메뉴의 하위메뉴 ---- */}
        <section className="panel">
          <div className="panel-head">
            <h2>하위메뉴 관리 — {selMenuLabel}</h2>
            <span className="sel-info" style={{ marginLeft: 12 }}>순서 · 이름 · 표시 여부</span>
          </div>
          {subList.length === 0 ? (
            <p className="hint">이 메뉴에는 하위메뉴가 없습니다. 좌측에서 사용자 관리·컨텐츠 관리·도면 관리를 선택하면 하위메뉴를 설정할 수 있습니다.</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>순서</th>
                    <th>메뉴 이름</th>
                    <th style={{ width: 70 }}>표시</th>
                  </tr>
                </thead>
                <tbody>
                  {subList.map((s, i) => (
                    <tr key={s.key}>
                      <td>
                        <span className="order-btns">
                          <button className="order-btn" aria-label={`${s.label} 위로`} disabled={i === 0} onClick={() => moveSub(s.key, -1)}>▲</button>
                          <button className="order-btn" aria-label={`${s.label} 아래로`} disabled={i === subList.length - 1} onClick={() => moveSub(s.key, 1)}>▼</button>
                        </span>
                      </td>
                      <td>
                        <input
                          className="inline-input"
                          value={s.label}
                          aria-label={`${s.key} 하위메뉴 이름`}
                          onChange={(e) => setSubLabel(s.key, e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className={`switch${s.visible ? ' on' : ''}`}
                          role="switch"
                          aria-checked={s.visible}
                          aria-label={`${s.label} 표시 여부`}
                          onClick={() => setSubVisible(s.key, !s.visible)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint">'{selMenuLabel}' 메뉴 아래에 펼쳐지는 하위메뉴입니다. 각 항목은 정해진 화면에 연결되어 있어 이름·표시·순서만 조정됩니다.</p>
            </>
          )}
        </section>

        {/* ---- 상부 메뉴 관리 ---- */}
        <section className="panel">
          <div className="panel-head">
            <h2>상부 메뉴 관리</h2>
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>브랜드명</span>
              <input
                className="inline-input full"
                value={config.topbar.brandTitle}
                onChange={(e) => setTopbar({ brandTitle: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>브랜드 부제</span>
              <input
                className="inline-input full"
                value={config.topbar.brandSub}
                onChange={(e) => setTopbar({ brandSub: e.target.value })}
              />
            </label>

            <label className="form-field">
              <span>관리자 이름</span>
              <input
                className="inline-input full"
                value={config.topbar.userName}
                onChange={(e) => setTopbar({ userName: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>역할 표기</span>
              <input
                className="inline-input full"
                value={config.topbar.userRole}
                onChange={(e) => setTopbar({ userRole: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>계정</span>
              <input
                className="inline-input full"
                value={config.topbar.userAccount}
                onChange={(e) => setTopbar({ userAccount: e.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>데이터 백업 · 복원</h2>
            <span className="sel-info" style={{ marginLeft: 12 }}>현재 작업 데이터(상품·그룹·사용자·브랜드·설정)를 파일로 저장/복원</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={exportData}>내보내기(백업)</button>
            <button className="btn-ghost" onClick={() => importRef.current?.click()}>가져오기(복원)</button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.currentTarget.value = ''; }} />
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            내보내기 → <b>hp3-backup-YYYY-MM-DD.json</b> 다운로드. 가져오기로 그 파일을 올리면 현재 브라우저에 복원 후 새로고침됩니다.
            다른 PC/브라우저로 작업 데이터를 옮길 때 사용하세요.
          </p>
        </section>
      </div>
    </main>
  );
}