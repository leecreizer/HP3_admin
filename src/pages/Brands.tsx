import { useMemo, useState } from 'react';
import { TrashIcon } from '../components/icons';
import type { Brand, Group } from '../data/org';

let brandSeq = 100;

type BrandsProps = {
  brands: Brand[];
  setBrands: React.Dispatch<React.SetStateAction<Brand[]>>;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
  dirty: boolean;
  onSave: () => void;
};

export function Brands({ brands, setBrands, groups, setGroups, dirty, onSave }: BrandsProps) {
  const [newName, setNewName] = useState('');
  const [newGroupUnder, setNewGroupUnder] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');

  const groupsByBrand = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of groups) {
      map.set(g.brandId, [...(map.get(g.brandId) ?? []), g]);
    }
    return map;
  }, [groups]);

  const addBrand = () => {
    const name = newName.trim();
    if (!name || brands.some((b) => b.name === name)) return;
    setBrands((prev) => [...prev, { id: `b-new-${++brandSeq}`, name }]);
    setNewName('');
  };

  const renameBrand = (id: string, name: string) => {
    setBrands((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
  };

  const deleteBrand = (id: string) => {
    const childGroups = groupsByBrand.get(id) ?? [];
    // 하위 그룹이 있으면 확인 후 함께 삭제 (사용자 소속 정보는 자동 해제됨)
    if (childGroups.length > 0 && !window.confirm(`'${brands.find((b) => b.id === id)?.name}' 브랜드와 하위 그룹 ${childGroups.length}개를 모두 삭제할까요?`)) return;
    setGroups((prev) => prev.filter((g) => g.brandId !== id));
    setBrands((prev) => prev.filter((b) => b.id !== id));
  };

  const addGroup = (brandId: string) => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups((prev) => [...prev, { id: `g-new-${++brandSeq}`, name, brandId }]);
    setNewGroupName('');
    setNewGroupUnder(null);
  };

  const renameGroup = (id: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  return (
    <main className="main">
      <div className="page-head">
        <h1>브랜드 관리</h1>
        <span className="date">브랜드 {brands.length}개 · 그룹 {groups.length}개</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-primary" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={onSave}>저장</button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>브랜드(파트너사) 목록</h2>
          <span className="sel-info" style={{ marginLeft: 12 }}>
            사용자 관리의 그룹, 상품의 컨텐츠 권한과 연동됩니다
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 220 }}>브랜드명</th>
              <th>소속 그룹</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((b) => {
              const brandGroups = groupsByBrand.get(b.id) ?? [];
              return (
                <tr key={b.id}>
                  <td>
                    <input
                      className="inline-input"
                      style={{ width: 180 }}
                      value={b.name}
                      aria-label={`${b.name} 브랜드명`}
                      onChange={(e) => renameBrand(b.id, e.target.value)}
                    />
                  </td>
                  <td>
                    {brandGroups.map((g) => (
                      <span key={g.id} className="tag removable" style={{ paddingLeft: 4 }}>
                        <input
                          className="kind-edit"
                          defaultValue={g.name}
                          aria-label={`${g.name} 그룹명`}
                          onBlur={(e) => renameGroup(g.id, e.target.value.trim() || g.name)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                        <button className="tag-x" aria-label={`${g.name} 그룹 삭제`} onClick={() => deleteGroup(g.id)}>
                          ×
                        </button>
                      </span>
                    ))}
                    {newGroupUnder === b.id ? (
                      <span className="folder-new" style={{ display: 'inline-flex', marginTop: 0 }}>
                        <input
                          autoFocus
                          value={newGroupName}
                          placeholder="그룹 이름"
                          style={{ width: 130 }}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addGroup(b.id);
                            if (e.key === 'Escape') setNewGroupUnder(null);
                          }}
                        />
                        <button className="btn-mini" onClick={() => addGroup(b.id)}>추가</button>
                      </span>
                    ) : (
                      <button
                        className="tag-add"
                        aria-label={`${b.name} 아래 그룹 추가`}
                        title="그룹 추가"
                        onClick={() => { setNewGroupUnder(b.id); setNewGroupName(''); }}
                        style={{ paddingLeft: 0, textAlign: 'center' }}
                      >
                        +
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      className="order-btn"
                      aria-label={`${b.name} 브랜드 삭제`}
                      title={brandGroups.length > 0 ? '브랜드와 하위 그룹 모두 삭제' : '브랜드 삭제'}
                      onClick={() => deleteBrand(b.id)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {brands.length === 0 && (
              <tr><td colSpan={3} className="empty-row">등록된 브랜드가 없습니다.</td></tr>
            )}
          </tbody>
        </table>

        <div className="folder-new" style={{ marginTop: 14, maxWidth: 320 }}>
          <input
            value={newName}
            placeholder="새 브랜드(파트너사) 이름"
            aria-label="새 브랜드 이름"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addBrand(); }}
          />
          <button className="btn-mini" onClick={addBrand}>브랜드 추가</button>
        </div>
        <p className="hint">그룹 삭제 시 사용자는 유지되고 소속 정보만 해제됩니다.</p>
      </section>
    </main>
  );
}