import { useMemo, useRef, useState } from 'react';
import { SearchIcon } from '../components/icons';
import { ThSort, useSort } from '../components/sortable';
import { Pagination, usePagination } from '../components/Pagination';

/**
 * 가격 관리 — 등록된 모든 컨텐츠(상품)의 가격을 한 화면에서 일괄 등록·수정·삭제.
 * 데이터는 상품관리와 동일한 hp3-products-state.products[].price 를 직접 읽고 쓴다(가격만 갱신, 나머지 보존).
 */
const STORE_KEY = 'hp3-products-state';

type PriceRow = {
  contentCode: string;
  name: string;
  brand: string;
  productGroup: string;
  productCode: string;
  price: number;
};

function loadRows(): PriceRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    const ps = Array.isArray(raw.products) ? raw.products : [];
    return ps.map((p: Record<string, unknown>) => ({
      contentCode: String(p.contentCode ?? ''),
      name: String(p.name ?? ''),
      brand: String(p.brand ?? ''),
      productGroup: String(p.productGroup ?? ''),
      productCode: String(p.productCode ?? ''),
      price: Number(p.price) || 0,
    }));
  } catch { return []; }
}

/** 변경된 가격(contentCode→price)만 원본 스토어에 반영 */
function savePrices(map: Record<string, number>) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (Array.isArray(raw.products)) {
      raw.products = raw.products.map((p: Record<string, unknown>) =>
        Object.prototype.hasOwnProperty.call(map, String(p.contentCode))
          ? { ...p, price: map[String(p.contentCode)] }
          : p);
      localStorage.setItem(STORE_KEY, JSON.stringify(raw));
    }
  } catch { /* ignore */ }
}

const won = (n: number) => n.toLocaleString('ko-KR');

export function Pricing() {
  const original = useRef(loadRows()).current;
  const [rows, setRows] = useState<PriceRow[]>(() => original.map((r) => ({ ...r })));
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState('');

  const sig = JSON.stringify(rows.map((r) => [r.contentCode, r.price]));
  const savedSig = useRef(sig);
  const dirty = sig !== savedSig.current;
  const save = () => {
    const map: Record<string, number> = {};
    rows.forEach((r) => { map[r.contentCode] = r.price; });
    savePrices(map);
    savedSig.current = sig;
    // 저장 후 dirty 갱신을 위해 상태 토글
    setRows((prev) => prev.map((r) => ({ ...r })));
  };

  const groups = useMemo(() => [...new Set(original.map((r) => r.productGroup).filter(Boolean))].sort(), [original]);

  const setPrice = (code: string, price: number) =>
    setRows((prev) => prev.map((r) => (r.contentCode === code ? { ...r, price } : r)));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) =>
      (groupFilter === 'all' || r.productGroup === groupFilter) &&
      (!q || `${r.name} ${r.productCode} ${r.contentCode}`.toLowerCase().includes(q)));
  }, [rows, query, groupFilter]);

  const sort = useSort(visible, {
    name: (r: PriceRow) => r.name,
    brand: (r: PriceRow) => r.brand,
    group: (r: PriceRow) => r.productGroup,
    code: (r: PriceRow) => r.productCode,
    price: (r: PriceRow) => r.price,
  });
  const pg = usePagination(sort.sorted.length, `${query}|${groupFilter}|${sort.sortKey}|${sort.dir}`);
  const pageRows = sort.sorted.slice(pg.start, pg.end);

  const allChecked = visible.length > 0 && visible.every((r) => checked.has(r.contentCode));
  const toggleAll = () => setChecked((prev) => {
    const next = new Set(prev);
    if (allChecked) visible.forEach((r) => next.delete(r.contentCode));
    else visible.forEach((r) => next.add(r.contentCode));
    return next;
  });
  const toggleOne = (code: string) => setChecked((prev) => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next;
  });

  /** 선택 항목에 일괄 가격 적용(등록·수정) */
  const applyBulk = () => {
    const v = Number(bulkValue);
    if (!Number.isFinite(v) || checked.size === 0) return;
    setRows((prev) => prev.map((r) => (checked.has(r.contentCode) ? { ...r, price: v } : r)));
  };
  /** 선택 항목 가격 삭제(0원) */
  const clearBulk = () => {
    if (checked.size === 0) return;
    setRows((prev) => prev.map((r) => (checked.has(r.contentCode) ? { ...r, price: 0 } : r)));
  };

  const stats = useMemo(() => {
    const priced = rows.filter((r) => r.price > 0);
    return { total: rows.length, priced: priced.length, zero: rows.length - priced.length };
  }, [rows]);

  return (
    <main className="main">
      <div className="page-head">
        <h1>가격 관리</h1>
        <span className="date">전체 {stats.total.toLocaleString()}개 · 가격 등록 {stats.priced.toLocaleString()} · 미설정 {stats.zero.toLocaleString()}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && <span className="dirty-badge" title="저장되지 않은 변경사항">● 미저장 변경</span>}
          <button className="btn-primary" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>

      <section className="panel product-panel">
        <div className="product-toolbar">
          <label className="search inset">
            <SearchIcon />
            <input type="search" placeholder="상품명·코드 검색" aria-label="가격 검색"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className="inline-input" aria-label="상품군 필터" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">전체 상품군</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <span className="sel-info" style={{ marginLeft: 'auto' }}>
            {checked.size > 0 ? `${checked.size}개 선택됨` : `${visible.length}개 표시`}
          </span>
          <button className="btn-ghost" disabled={visible.length === 0} onClick={() => setChecked(new Set(visible.map((r) => r.contentCode)))}>전체선택</button>
          <button className="btn-ghost" disabled={checked.size === 0} onClick={() => setChecked(new Set())}>선택취소</button>
          <input className="inline-input" type="number" style={{ width: 120 }} placeholder="일괄 가격(원)"
            value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} aria-label="일괄 가격" />
          <button className="btn-ghost" disabled={checked.size === 0 || bulkValue === ''} onClick={applyBulk}>일괄 등록·수정</button>
          <button className="btn-ghost danger" disabled={checked.size === 0} onClick={clearBulk}>가격 삭제</button>
        </div>

        <table>
          <thead>
            <tr>
              <th className="w-check"><input type="checkbox" aria-label="전체 선택" checked={allChecked} onChange={toggleAll} /></th>
              <ThSort label="상품명" k="name" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
              <ThSort label="브랜드" k="brand" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
              <ThSort label="상품군" k="group" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
              <ThSort label="상품코드" k="code" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
              <ThSort label="가격(원)" k="price" sortKey={sort.sortKey} dir={sort.dir} onToggle={sort.toggle} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.contentCode}>
                <td className="w-check"><input type="checkbox" aria-label={`${r.name} 선택`} checked={checked.has(r.contentCode)} onChange={() => toggleOne(r.contentCode)} /></td>
                <td>
                  <b style={{ fontWeight: 600 }}>{r.name}</b>
                  <span style={{ color: 'var(--text-3)', marginLeft: 8 }}>{r.contentCode}</span>
                </td>
                <td>{r.brand || <span style={{ color: 'var(--text-3)' }}>–</span>}</td>
                <td>{r.productGroup || <span style={{ color: 'var(--text-3)' }}>–</span>}</td>
                <td className="num">{r.productCode}</td>
                <td className="num">
                  <input className="inline-input" type="number" style={{ width: 120, textAlign: 'right' }}
                    value={r.price || ''} placeholder="0" aria-label={`${r.name} 가격`}
                    onChange={(e) => setPrice(r.contentCode, Number(e.target.value) || 0)} />
                  <span style={{ color: 'var(--text-3)', marginLeft: 6, fontSize: '0.78rem' }}>{won(r.price)}</span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={6} className="empty-row">조건에 맞는 컨텐츠가 없습니다.</td></tr>}
          </tbody>
        </table>
        {sort.sorted.length > 0 && (
          <Pagination page={pg.page} pageCount={pg.pageCount} pageSize={pg.pageSize} total={sort.sorted.length} onPage={pg.setPage} onPageSize={pg.setPageSize} />
        )}
      </section>
    </main>
  );
}