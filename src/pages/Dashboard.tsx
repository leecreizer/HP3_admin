import { useMemo, useState } from 'react';
import { INITIAL_PRODUCTS, INITIAL_PRODUCT_GROUPS } from './Products';
import { INITIAL_USERS } from './Users';
import { INITIAL_RENDERS } from './Floorplans';

type Period = '일' | '월' | '년';
const PERIODS: Period[] = ['일', '월', '년'];

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 현재 등록된 상품 데이터 (localStorage 우선, 없으면 시드) */
function loadProducts() {
  try {
    const raw = JSON.parse(localStorage.getItem('hp3-products-state') ?? '{}');
    if (Array.isArray(raw.products) && raw.products.length) return raw.products as typeof INITIAL_PRODUCTS;
  } catch { /* ignore */ }
  return INITIAL_PRODUCTS;
}

const inPeriod = (dateStr: string | undefined, period: Period, now: Date) => {
  if (!dateStr) return false;
  if (period === '일') return dateStr === fmtDate(now);
  if (period === '월') return dateStr.startsWith(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  return dateStr.startsWith(String(now.getFullYear()));
};

/** 기간별 날짜 라벨 (2026 기준 앵커) */
function periodLabels(period: Period, len: number, now: Date) {
  if (period === '일') {
    return Array.from({ length: len }, (_, i) => {
      const d = new Date(now); d.setDate(now.getDate() - (len - 1 - i));
      return { short: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, full: fmtDate(d) };
    });
  }
  if (period === '월') {
    return Array.from({ length: len }, (_, i) => {
      let y = now.getFullYear(), m = now.getMonth() + 1 - (len - 1 - i);
      while (m <= 0) { m += 12; y -= 1; }
      return { short: `${String(y).slice(2)}.${pad(m)}`, full: `${y}-${pad(m)}` };
    });
  }
  return Array.from({ length: len }, (_, i) => {
    const y = now.getFullYear() - (len - 1 - i);
    return { short: `${y}`, full: `${y}` };
  });
}
const rangeText = (labels: { full: string }[]) => (labels.length ? `${labels[0].full} ~ ${labels[labels.length - 1].full}` : '');

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="기간" style={{ marginLeft: 'auto' }}>
      {PERIODS.map((p) => (
        <button key={p} role="tab" aria-selected={value === p} className={`seg-item${value === p ? ' active' : ''}`} onClick={() => onChange(p)}>
          {p === '년' ? '년별' : `${p}별`}
        </button>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [groupPeriod, setGroupPeriod] = useState<Period>('월');
  const [renderPeriod, setRenderPeriod] = useState<Period>('월');

  const now = new Date();
  const today = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const extractedAt = `${fmtDate(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const products = useMemo(() => loadProducts(), []);

  // 사용자 — 실제 등록 사용자 기준
  const userSummary = useMemo(() => ({
    total: INITIAL_USERS.length,
    dau: INITIAL_USERS.filter((u) => u.status === 'active').length,
    idle: INITIAL_USERS.filter((u) => u.status !== 'active').length,
  }), []);

  // 컨텐츠 상품군별 등록수 — 실제 상품 데이터, updatedAt 기준 기간 필터
  const groups = useMemo(
    () => INITIAL_PRODUCT_GROUPS.map((name) => ({ name, count: products.filter((p) => p.productGroup === name && inPeriod(p.updatedAt, groupPeriod, now)).length })),
    [products, groupPeriod],
  );
  const groupMax = Math.max(1, ...groups.map((g) => g.count));
  const groupTotal = groups.reduce((s, g) => s + g.count, 0);
  const groupBasis = groupPeriod === '일' ? fmtDate(now) : groupPeriod === '월' ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}` : `${now.getFullYear()}년`;

  // 렌더링 수 — 실제 렌더 데이터, created 기준 시계열
  const renderLabels = useMemo(() => periodLabels(renderPeriod, renderPeriod === '일' ? 7 : renderPeriod === '월' ? 6 : 5, now), [renderPeriod]);
  const renderValues = useMemo(
    () => renderLabels.map((l) => INITIAL_RENDERS.filter((r) => (renderPeriod === '일' ? r.created === l.full : r.created.startsWith(l.full))).length),
    [renderLabels, renderPeriod],
  );
  const renderMax = Math.max(1, ...renderValues);
  const renderTotal = renderValues.reduce((s, v) => s + v, 0);
  const renderRange = rangeText(renderLabels);

  return (
    <main className="main">
      <div className="page-head">
        <h1>대시보드</h1>
        <span className="date">{today}</span>
      </div>

      {/* 사용자 요약 — 실제 등록 사용자 */}
      <section className="kpis" aria-label="사용자 요약">
        <div className="kpi"><div className="label">총 등록 사용자</div><div className="value">{userSummary.total.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">일 활성 사용자 (DAU)</div><div className="value">{userSummary.dau.toLocaleString()}</div></div>
        <div className="kpi"><div className="label">미사용 인원</div><div className="value">{userSummary.idle.toLocaleString()}</div></div>
      </section>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        {/* 상품군별 등록수 */}
        <section className="panel">
          <div className="panel-head">
            <h2>컨텐츠 상품군별 등록수</h2>
            <PeriodTabs value={groupPeriod} onChange={setGroupPeriod} />
          </div>
          <p className="dash-total">합계 <b>{groupTotal.toLocaleString()}</b> 개 · 집계 기준 <b>{groupBasis}</b> · 전체 등록 {products.length.toLocaleString()}개</p>
          <div className="barlist">
            {groups.map((g) => (
              <div className="row" key={g.name}>
                <span className="lbl">{g.name}</span>
                <span className="track"><span className="fill" style={{ width: `${(g.count / groupMax) * 100}%` }} /></span>
                <span className="val">{g.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <p className="dash-basis">※ 집계 기준일: {groupBasis} · 추출: {extractedAt} · 등록일(updatedAt) 기준</p>
        </section>

        {/* 렌더링 수 */}
        <section className="panel">
          <div className="panel-head">
            <h2>렌더링 수</h2>
            <PeriodTabs value={renderPeriod} onChange={setRenderPeriod} />
          </div>
          <p className="dash-total">합계 <b>{renderTotal.toLocaleString()}</b> 건 · 기간 <b>{renderRange}</b></p>
          <div className="vbars">
            {renderValues.map((v, i) => (
              <div className="col" key={renderLabels[i].full} title={`${renderLabels[i].full} · ${v.toLocaleString()}건`}>
                <span className="num">{v.toLocaleString()}</span>
                <span className="bar" style={{ height: `${Math.max(4, (v / renderMax) * 100)}%` }} />
                <span className="lbl">{renderLabels[i].short}</span>
              </div>
            ))}
          </div>
          <p className="dash-basis">※ 집계 기간: {renderRange} · 추출: {extractedAt} · 생성일(created) 기준</p>
        </section>
      </div>
    </main>
  );
}