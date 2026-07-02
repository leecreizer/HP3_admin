import { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, SearchIcon, TrashIcon } from '../components/icons';
import { useConfirm } from '../components/confirm';

/**
 * APT 도면 관리 — 공용 기본 레이아웃 도면 마스터.
 * 운영자가 단지·평형별 기본 도면을 등록·관리하고,
 * 사용자는 홈플래너에서 아파트를 검색해 이 도면을 열어 상품을 배치한다(사용자 도면의 원본).
 */
type AptStatus = 'public' | 'review' | 'draft';

type AptPlan = {
  id: string;
  /** 단지명 (예: 래미안 원베일리) */
  complex: string;
  /** 지역 */
  region: string;
  /** 평형·타입 (예: 84A) */
  unitType: string;
  pyeong: number;
  rooms: string;
  status: AptStatus;
  updated: string;
  tone: 1 | 2 | 3 | 4;
};

const STATUS_LABEL: Record<AptStatus, { text: string; cls: string }> = {
  public: { text: '공개', cls: 'st-done' },
  review: { text: '검수중', cls: 'st-wait' },
  draft: { text: '임시저장', cls: 'st-fail' },
};

const SEED: AptPlan[] = [
  { id: 'APT-0001', complex: '래미안 원베일리', region: '서울 서초구', unitType: '84A', pyeong: 34, rooms: '3R/2B', status: 'public', updated: '2026-06-10', tone: 1 },
  { id: 'APT-0002', complex: '래미안 원베일리', region: '서울 서초구', unitType: '59B', pyeong: 25, rooms: '2R/1B', status: 'public', updated: '2026-06-10', tone: 2 },
  { id: 'APT-0003', complex: '힐스테이트 광교', region: '경기 수원시', unitType: '59B', pyeong: 25, rooms: '2R/1B', status: 'public', updated: '2026-06-09', tone: 3 },
  { id: 'APT-0004', complex: '푸르지오 송도', region: '인천 연수구', unitType: '101C', pyeong: 41, rooms: '4R/2B', status: 'review', updated: '2026-06-08', tone: 4 },
  { id: 'APT-0005', complex: '자이 마포 리버뷰', region: '서울 마포구', unitType: '74T', pyeong: 30, rooms: '3R/2B', status: 'public', updated: '2026-06-08', tone: 1 },
  { id: 'APT-0006', complex: '더샵 센텀파크', region: '부산 해운대구', unitType: '112D', pyeong: 45, rooms: '4R/2B', status: 'draft', updated: '2026-06-07', tone: 2 },
];

const KEY = 'hp3-apt-plans';

function loadAptPlans(): AptPlan[] {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return Array.isArray(r) ? r : SEED; } catch { return SEED; }
}

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

type PlanForm = { complex: string; region: string; unitType: string; pyeong: string; rooms: string; status: AptStatus };
const EMPTY_FORM: PlanForm = { complex: '', region: '', unitType: '', pyeong: '', rooms: '', status: 'draft' };

let aptSeq = 100;

export function AptPlans() {
  const { confirm, confirmDialog } = useConfirm();
  const [plans, setPlans] = useState<AptPlan[]>(loadAptPlans);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | AptStatus>('all');
  /** 모달: null=닫힘, 'new'=등록, 그 외=수정 대상 id */
  const [editTarget, setEditTarget] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  // 자동저장 없음 — '저장' 버튼으로만 영속화
  const sig = JSON.stringify(plans);
  const savedSig = useRef(sig);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setDirty(sig !== savedSig.current); }, [sig]);
  const save = () => { localStorage.setItem(KEY, JSON.stringify(plans)); savedSig.current = sig; setDirty(false); };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plans.filter((p) =>
      (status === 'all' || p.status === status) &&
      (!q || p.complex.toLowerCase().includes(q) || p.region.includes(q) || p.unitType.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  }, [plans, query, status]);

  const openAdd = () => { setForm(EMPTY_FORM); setEditTarget('new'); };
  const openEdit = (p: AptPlan) => {
    setForm({ complex: p.complex, region: p.region, unitType: p.unitType, pyeong: String(p.pyeong), rooms: p.rooms, status: p.status });
    setEditTarget(p.id);
  };
  const formValid = !!(form.complex.trim() && form.unitType.trim());
  const submit = () => {
    if (!formValid) return;
    const today = new Date().toISOString().slice(0, 10);
    if (editTarget === 'new') {
      setPlans((prev) => [{
        id: `APT-${String(++aptSeq).padStart(4, '0')}`,
        complex: form.complex.trim(), region: form.region.trim(), unitType: form.unitType.trim(),
        pyeong: Number(form.pyeong) || 0, rooms: form.rooms.trim() || '-',
        status: form.status, updated: today, tone: ((prev.length % 4) + 1) as 1 | 2 | 3 | 4,
      }, ...prev]);
    } else if (editTarget) {
      setPlans((prev) => prev.map((p) => (p.id === editTarget
        ? { ...p, complex: form.complex.trim(), region: form.region.trim(), unitType: form.unitType.trim(), pyeong: Number(form.pyeong) || 0, rooms: form.rooms.trim() || '-', status: form.status, updated: today }
        : p)));
    }
    setEditTarget(null);
  };
  const remove = (p: AptPlan) =>
    confirm({
      message: <>‘{p.complex} {p.unitType}’ 기본 도면을 삭제할까요?<br />이미 이 도면으로 만들어진 사용자 도면은 유지됩니다.</>,
      onConfirm: () => setPlans((prev) => prev.filter((x) => x.id !== p.id)),
    });

  const editing = editTarget && editTarget !== 'new' ? plans.find((p) => p.id === editTarget) : null;

  return (
    <main className="main">
      <div className="page-head">
        <h1>APT 도면 관리</h1>
        <span className="date">공용 기본 도면 {plans.length}개 · 공개 {plans.filter((p) => p.status === 'public').length}개</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && <span className="dirty-badge" title="저장되지 않은 변경사항">● 미저장 변경</span>}
          <button className="btn-primary" onClick={openAdd}>+ 도면 등록</button>
          <button className="btn-primary" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>

      <div className="grp-guide">
        <span className="grp-guide-ico">💡</span>
        <div>
          <b>APT 도면</b>은 단지·평형별 <u>공용 기본 레이아웃</u>입니다. 사용자가 홈플래너에서 <b>아파트를 검색</b>해 도면을 열면
          여기 등록된 <b>공개</b> 도면이 기본 도면으로 사용되고, 상품을 배치하면 <b>사용자 도면</b>(사용자 도면 관리)으로 저장됩니다.
        </div>
      </div>

      <section className="panel">
        <div className="product-toolbar">
          <label className="search inset">
            <SearchIcon />
            <input type="search" placeholder="단지명, 지역, 타입 검색" aria-label="APT 도면 검색"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="seg" role="tablist" aria-label="상태 필터">
            {(['all', 'public', 'review', 'draft'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={status === s}
                className={`seg-item${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
                {s === 'all' ? '전체' : STATUS_LABEL[s].text}
              </button>
            ))}
          </div>
          <span className="sel-info" style={{ marginLeft: 'auto' }}>{visible.length}개 표시</span>
        </div>

        <div className="fp-grid">
          {visible.map((p) => (
            <article className="fp-card" key={p.id}>
              <PlanThumb tone={p.tone} />
              <div className="fp-body">
                <div className="fp-title-row">
                  <h3>{p.complex} {p.unitType}</h3>
                  <span className={`pill ${STATUS_LABEL[p.status].cls}`}>{STATUS_LABEL[p.status].text}</span>
                </div>
                <p className="fp-meta">{p.region} · {p.pyeong}평 · {p.rooms}</p>
                <p className="fp-sub">
                  <span className="num-inline">{p.id}</span> · 수정 {p.updated}
                  <span className="row-actions" style={{ marginLeft: 8 }}>
                    <button className="order-btn" aria-label={`${p.complex} ${p.unitType} 수정`} title="수정" onClick={() => openEdit(p)}><PencilIcon size={12} /></button>
                    <button className="order-btn" aria-label={`${p.complex} ${p.unitType} 삭제`} title="삭제" onClick={() => remove(p)}><TrashIcon size={12} /></button>
                  </span>
                </p>
              </div>
            </article>
          ))}
          {visible.length === 0 && <p className="empty-block">조건에 맞는 도면이 없습니다. <b>+ 도면 등록</b>으로 추가하세요.</p>}
        </div>
      </section>

      {editTarget !== null && (
        <div className="modal-backdrop" onClick={() => setEditTarget(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={editTarget === 'new' ? 'APT 도면 등록' : 'APT 도면 수정'} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{editTarget === 'new' ? 'APT 도면 등록' : `APT 도면 수정 — ${editing?.complex ?? ''} ${editing?.unitType ?? ''}`}</h2>
            <div className="form-grid">
              <label className="form-field">
                <span>단지명 *</span>
                <input autoFocus className="inline-input full" value={form.complex} placeholder="예: 래미안 원베일리"
                  onChange={(e) => setForm((f) => ({ ...f, complex: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>지역</span>
                <input className="inline-input full" value={form.region} placeholder="예: 서울 서초구"
                  onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>평형·타입 *</span>
                <input className="inline-input full" value={form.unitType} placeholder="예: 84A"
                  onChange={(e) => setForm((f) => ({ ...f, unitType: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>평수</span>
                <input className="inline-input full" type="number" min="0" value={form.pyeong} placeholder="34"
                  onChange={(e) => setForm((f) => ({ ...f, pyeong: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>방/욕실</span>
                <input className="inline-input full" value={form.rooms} placeholder="예: 3R/2B"
                  onChange={(e) => setForm((f) => ({ ...f, rooms: e.target.value }))} />
              </label>
              <label className="form-field">
                <span>상태</span>
                <select className="inline-input full" value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AptStatus }))}>
                  {(Object.keys(STATUS_LABEL) as AptStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s].text}</option>)}
                </select>
              </label>
            </div>
            <p className="hint" style={{ margin: '8px 0 0' }}>공개 상태의 도면만 홈플래너 아파트 검색에 노출됩니다.</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setEditTarget(null)}>취소</button>
              <button className="btn-primary" style={{ marginLeft: 0 }} disabled={!formValid} onClick={submit}>
                {editTarget === 'new' ? '등록' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </main>
  );
}