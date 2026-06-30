import { useMemo, useState, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';

export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => string | number>,
  initialKey?: K,
) {
  const [sortKey, setSortKey] = useState<K | null>(initialKey ?? null);
  const [dir, setDir] = useState<SortDir>('asc');

  const toggle = (key: K) => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const get = accessors[sortKey];
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'ko');
      return dir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir]);

  return { sorted, sortKey, dir, toggle };
}

type ThSortProps<K extends string> = {
  label: ReactNode;
  k: K;
  sortKey: K | null;
  dir: SortDir;
  onToggle: (key: K) => void;
  style?: React.CSSProperties;
};

export function ThSort<K extends string>({ label, k, sortKey, dir, onToggle, style }: ThSortProps<K>) {
  const active = sortKey === k;
  return (
    <th
      className="sortable"
      style={style}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onToggle(k)}
    >
      {label}
      <span className="sort-arrow" aria-hidden="true">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}