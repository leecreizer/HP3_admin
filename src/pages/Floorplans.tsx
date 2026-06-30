import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon, TrashIcon } from '../components/icons';

type FloorplanStatus = 'public' | 'review' | 'draft';

type Floorplan = {
  id: string;
  name: string;
  complex: string;
  pyeong: number;
  rooms: string;
  updated: string;
  status: FloorplanStatus;
  tone: 1 | 2 | 3 | 4;
};

type RenderImage = {
  id: string;
  planId: string;
  room: string;
  style: string;
  created: string;
  duration: string;
  tone: 1 | 2 | 3 | 4;
};

const STATUS_LABEL: Record<FloorplanStatus, { text: string; cls: string }> = {
  public: { text: '공개', cls: 'st-done' },
  review: { text: '검수중', cls: 'st-wait' },
  draft: { text: '임시저장', cls: 'st-fail' },
};

const PLANS: Floorplan[] = [
  { id: 'FP-1042', name: '래미안 원베일리 84A', complex: '서울 서초구', pyeong: 34, rooms: '3R/2B', updated: '2026-06-11', status: 'public', tone: 1 },
  { id: 'FP-1041', name: '힐스테이트 광교 59B', complex: '경기 수원시', pyeong: 25, rooms: '2R/1B', updated: '2026-06-11', status: 'public', tone: 2 },
  { id: 'FP-1040', name: '푸르지오 송도 101C', complex: '인천 연수구', pyeong: 41, rooms: '4R/2B', updated: '2026-06-10', status: 'review', tone: 3 },
  { id: 'FP-1039', name: '자이 마포 리버뷰 74T', complex: '서울 마포구', pyeong: 30, rooms: '3R/2B', updated: '2026-06-10', status: 'public', tone: 4 },
  { id: 'FP-1038', name: '더샵 센텀파크 112D', complex: '부산 해운대구', pyeong: 45, rooms: '4R/2B', updated: '2026-06-09', status: 'draft', tone: 2 },
  { id: 'FP-1037', name: 'e편한세상 일산 84F', complex: '경기 고양시', pyeong: 34, rooms: '3R/2B', updated: '2026-06-08', status: 'public', tone: 1 },
  { id: 'FP-1036', name: '롯데캐슬 잠실 134P', complex: '서울 송파구', pyeong: 52, rooms: '5R/3B', updated: '2026-06-08', status: 'review', tone: 3 },
  { id: 'FP-1035', name: '아이파크 분당 59A', complex: '경기 성남시', pyeong: 25, rooms: '2R/1B', updated: '2026-06-07', status: 'public', tone: 4 },
];

export const INITIAL_RENDERS: RenderImage[] = [
  { id: 'R-20481', planId: 'FP-1042', room: '거실', style: '모던', created: '2026-06-12', duration: '8.2 s', tone: 1 },
  { id: 'R-20476', planId: 'FP-1042', room: '거실', style: '내추럴', created: '2026-06-11', duration: '9.0 s', tone: 2 },
  { id: 'R-20470', planId: 'FP-1042', room: '침실', style: '미니멀', created: '2026-06-11', duration: '7.8 s', tone: 3 },
  { id: 'R-20465', planId: 'FP-1042', room: '주방', style: '모던', created: '2026-06-10', duration: '11.2 s', tone: 4 },
  { id: 'R-20480', planId: 'FP-1041', room: '주방', style: '모던', created: '2026-06-12', duration: '10.4 s', tone: 2 },
  { id: 'R-20471', planId: 'FP-1041', room: '거실', style: '클래식', created: '2026-06-10', duration: '12.1 s', tone: 1 },
  { id: 'R-20468', planId: 'FP-1040', room: '거실', style: '모던', created: '2026-06-10', duration: '9.4 s', tone: 3 },
  { id: 'R-20462', planId: 'FP-1039', room: '침실', style: '내추럴', created: '2026-06-09', duration: '8.8 s', tone: 4 },
  { id: 'R-20461', planId: 'FP-1039', room: '아이방', style: '모던', created: '2026-06-09', duration: '7.6 s', tone: 2 },
];

function PlanThumb({ tone }: { tone: number }) {
  return (
    <div className={`fp-thumb tone-${tone}`}>
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <rect x="6" y="6" width="108" height="68" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M6 42h44M50 42V6M50 42v32M78 74V48M78 48h36M28 6v14" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </div>
  );
}

export function Floorplans() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | FloorplanStatus>('all');
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [renders, setRenders] = useState<RenderImage[]>(() => {
    try { const r = JSON.parse(localStorage.getItem('hp3-renders') ?? 'null'); return Array.isArray(r) ? r : INITIAL_RENDERS; } catch { return INITIAL_RENDERS; }
  });
  const [roomFilter, setRoomFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'pyeong'>('updated');

  // 자동저장 없음 — '저장' 버튼으로만 영속화
  const rendersSig = JSON.stringify(renders);
  const savedRendersSig = useRef(rendersSig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(rendersSig !== savedRendersSig.current); }, [rendersSig]);
  const save = () => { localStorage.setItem('hp3-renders', JSON.stringify(renders)); savedRendersSig.current = rendersSig; setDirty(false); };

  const visiblePlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = PLANS.filter(
      (p) =>
        (status === 'all' || p.status === status) &&
        (!q || p.name.toLowerCase().includes(q) || p.complex.includes(q) || p.id.toLowerCase().includes(q)),
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ko');
      if (sortBy === 'pyeong') return b.pyeong - a.pyeong;
      return b.updated.localeCompare(a.updated); // 최신 수정순
    });
  }, [query, status, sortBy]);

  const renderCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of renders) map.set(r.planId, (map.get(r.planId) ?? 0) + 1);
    return map;
  }, [renders]);

  const openPlan = PLANS.find((p) => p.id === openPlanId);

  const deleteRender = (id: string) => {
    setRenders((prev) => prev.filter((r) => r.id !== id));
  };

  /* ---------- 상세: 선택한 도면의 렌더 이미지 ---------- */
  if (openPlan) {
    const planRenders = renders.filter((r) => r.planId === openPlan.id);
    const rooms = [...new Set(planRenders.map((r) => r.room))];
    const shown = planRenders.filter((r) => roomFilter === 'all' || r.room === roomFilter);

    return (
      <main className="main">
        <div className="page-head">
          <button
            className="btn-ghost"
            onClick={() => {
              setOpenPlanId(null);
              setRoomFilter('all');
            }}
          >
            ‹ 도면 목록
          </button>
          <h1>{openPlan.name}</h1>
          <span className={`pill ${STATUS_LABEL[openPlan.status].cls}`} style={{ marginBottom: 5 }}>
            {STATUS_LABEL[openPlan.status].text}
          </span>
          <button className="btn-primary">+ 렌더 생성</button>
        </div>

        <div className="plan-detail">
          {/* 도면 정보 */}
          <section className="panel plan-info">
            <PlanThumb tone={openPlan.tone} />
            <dl className="plan-meta">
              <div><dt>도면 ID</dt><dd className="num-inline">{openPlan.id}</dd></div>
              <div><dt>단지</dt><dd>{openPlan.complex}</dd></div>
              <div><dt>평형</dt><dd>{openPlan.pyeong}평 · {openPlan.rooms}</dd></div>
              <div><dt>최종 수정</dt><dd className="num-inline">{openPlan.updated}</dd></div>
              <div><dt>렌더 이미지</dt><dd className="num-inline">{planRenders.length}장</dd></div>
            </dl>
          </section>

          {/* 렌더 이미지 갤러리 */}
          <section className="panel">
            <div className="panel-head">
              <h2>렌더 이미지</h2>
              <div className="seg" role="tablist" aria-label="공간 필터" style={{ marginLeft: 14 }}>
                <button
                  role="tab"
                  aria-selected={roomFilter === 'all'}
                  className={`seg-item${roomFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setRoomFilter('all')}
                >
                  전체 {planRenders.length}
                </button>
                {rooms.map((room) => (
                  <button
                    key={room}
                    role="tab"
                    aria-selected={roomFilter === room}
                    className={`seg-item${roomFilter === room ? ' active' : ''}`}
                    onClick={() => setRoomFilter(room)}
                  >
                    {room}
                  </button>
                ))}
              </div>
            </div>

            <div className="render-grid">
              {shown.map((r) => (
                <figure className="render-card" key={r.id}>
                  <div className={`render-thumb tone-${r.tone}`}>
                    <span className="render-room">{r.room}</span>
                    <button
                      className="render-del"
                      aria-label={`${r.id} 렌더 이미지 삭제`}
                      title="렌더 이미지 삭제"
                      onClick={() => deleteRender(r.id)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                  <figcaption className="render-body">
                    <span className="t">{r.style} 스타일</span>
                    <span className="s">
                      <span className="num-inline">#{r.id}</span> · {r.created} · {r.duration}
                    </span>
                  </figcaption>
                </figure>
              ))}
              {shown.length === 0 && <p className="empty-block">렌더 이미지가 없습니다. <b>+ 렌더 생성</b>으로 추가하세요.</p>}
            </div>
          </section>
        </div>
      </main>
    );
  }

  /* ---------- 목록 ---------- */
  return (
    <main className="main">
      <div className="page-head">
        <h1>도면 관리</h1>
        <span className="date">전체 {PLANS.length.toLocaleString()}개 도면 · 렌더 이미지 {renders.length}장</span>
        {dirty && <span className="dirty-badge" style={{ marginLeft: 'auto' }} title="저장되지 않은 변경사항">● 미저장 변경</span>}
        <button className="btn-ghost" style={{ marginLeft: dirty ? 0 : 'auto' }} disabled={!dirty} onClick={save}>저장</button>
        <button className="btn-primary">+ 도면 등록</button>
      </div>

      <section className="panel">
        <div className="product-toolbar">
          <label className="search inset">
            <SearchIcon />
            <input
              type="search"
              placeholder="단지명, 평형, 도면 ID 검색"
              aria-label="도면 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="seg" role="tablist" aria-label="상태 필터">
            {(['all', 'public', 'review', 'draft'] as const).map((s) => (
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
          <select
            className="btn-ghost"
            style={{ marginLeft: 'auto' }}
            aria-label="도면 정렬"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="updated">최신 수정순</option>
            <option value="name">이름순</option>
            <option value="pyeong">평형 큰 순</option>
          </select>
          <span className="sel-info">{visiblePlans.length}개 표시</span>
        </div>

        <div className="fp-grid">
          {visiblePlans.map((p) => (
            <article
              className="fp-card"
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setOpenPlanId(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenPlanId(p.id); }}
            >
              <PlanThumb tone={p.tone} />
              <div className="fp-body">
                <div className="fp-title-row">
                  <h3>{p.name}</h3>
                  <span className={`pill ${STATUS_LABEL[p.status].cls}`}>{STATUS_LABEL[p.status].text}</span>
                </div>
                <p className="fp-meta">{p.complex} · {p.pyeong}평 · {p.rooms}</p>
                <p className="fp-sub">
                  <span className="num-inline">{p.id}</span> · 렌더 <b className="num-inline">{renderCount.get(p.id) ?? 0}</b>장
                </p>
              </div>
            </article>
          ))}
          {visiblePlans.length === 0 && <p className="empty-block">조건에 맞는 도면이 없습니다.</p>}
        </div>
      </section>
    </main>
  );
}