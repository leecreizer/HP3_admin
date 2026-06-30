import { useEffect, useState } from 'react';

const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

/** 목록 페이지네이션 상태 — total과 의존 키를 받아 현재 페이지의 슬라이스 범위를 돌려준다 */
export function usePagination(total: number, resetKey: unknown) {
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(1);

  // 필터/검색/페이지크기 변경 시 1페이지로
  useEffect(() => { setPage(1); }, [resetKey, pageSize]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  const end = start + pageSize;

  return { page: current, setPage, pageSize, setPageSize, pageCount, start, end };
}

type PaginationProps = {
  page: number;
  pageCount: number;
  pageSize: PageSize;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: PageSize) => void;
};

/** 1,2,3 … 형태의 페이지 번호 목록 (현재 페이지 주변 + 양 끝) */
function pageItems(page: number, pageCount: number): (number | '…')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items: (number | '…')[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  if (lo > 2) items.push('…');
  for (let i = lo; i <= hi; i++) items.push(i);
  if (hi < pageCount - 1) items.push('…');
  items.push(pageCount);
  return items;
}

export function Pagination({ page, pageCount, pageSize, total, onPage, onPageSize }: PaginationProps) {
  return (
    <div className="pagination">
      <label className="page-size">
        페이지당
        <select
          className="inline-input"
          aria-label="페이지당 표시 개수"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s}개</option>
          ))}
        </select>
      </label>

      <span className="page-info">전체 {total.toLocaleString()}건</span>

      <div className="page-nav" role="navigation" aria-label="페이지 이동">
        <button className="page-btn" aria-label="이전 페이지" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
        {pageItems(page, pageCount).map((it, i) =>
          it === '…' ? (
            <span key={`e${i}`} className="page-ellipsis">…</span>
          ) : (
            <button
              key={it}
              className={`page-btn${it === page ? ' active' : ''}`}
              aria-current={it === page ? 'page' : undefined}
              onClick={() => onPage(it)}
            >
              {it}
            </button>
          ),
        )}
        <button className="page-btn" aria-label="다음 페이지" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>›</button>
      </div>
    </div>
  );
}