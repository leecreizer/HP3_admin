import { useMemo, useState } from 'react';
import { GROUP_LABEL, MODEL_TYPES, TOOLTYPES, TOOLTYPE_LABEL, searchCats, type ModelCat, type ToolType } from '../../pm/modelTypes';
import { loadModels } from '../../pm/store';
import type { PmModel } from '../../pm/types';

export type ModelTypePick = { tooltype: ToolType; lib: number; library: string; categoryId: number; category: string };

/**
 * 모델 유형 선택(选择模型类别) — 새 에디터용.
 *  왼쪽: 새로 만들기 / 열기 · 가운데: 소속 라이브러리(프론트 · 백엔드) · 오른쪽: 실제 분류 3단 + 검색 · 아래: 현재 선택한 분류 · 확인
 */
export function PmModelDialog({ tooltype, fixedTool, initialTab = 'new', change, current, onConfirm, onOpen, onClose }: {
  tooltype: ToolType; fixedTool: boolean; initialTab?: 'new' | 'open'; change?: boolean; current?: { lib?: number; categoryId?: number };
  onConfirm: (p: ModelTypePick) => void; onOpen?: (m: PmModel) => void; onClose?: () => void;
}) {
  const [tool, setTool] = useState<ToolType>(tooltype);
  const [tab, setTab] = useState<'new' | 'open'>(change ? 'new' : initialTab);
  const libs = MODEL_TYPES[tool].libs;
  const [lib, setLib] = useState<number>(() => (libs.some((l) => l.lib === current?.lib) ? current!.lib! : libs[0].lib));
  const [trail, setTrail] = useState<ModelCat[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const cur = libs.find((l) => l.lib === lib) ?? libs[0];
  const all = useMemo(() => loadModels(), []);
  const pickTool = (t: ToolType) => { setTool(t); setLib(MODEL_TYPES[t].libs[0].lib); setTrail([]); setPicked(null); };
  const pickLib = (n: number) => { setLib(n); setTrail([]); setPicked(null); };
  const hits = useMemo(() => (tab === 'new' ? searchCats(cur.cats, q.trim().toLowerCase()) : []), [tab, cur, q]);
  const models = useMemo(() => {
    if (tab !== 'open') return [];
    const query = q.trim().toLowerCase();
    return all.filter((m) => (lib === -1 ? m.lib == null : m.lib === lib) && (!query || m.name.toLowerCase().includes(query))).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [tab, lib, q, all]);
  const cols: ModelCat[][] = [cur.cats, trail[0]?.children ?? [], trail[1]?.children ?? []];
  const sel = trail.at(-1);
  const confirm = () => { if (sel) onConfirm({ tooltype: tool, lib: cur.lib, library: cur.name, categoryId: sel.id, category: sel.name }); };
  const openPicked = () => { const m = models.find((x) => x.id === picked); if (m && onOpen) onOpen(m); };

  return (
    <div className="pm-modal-bg">
      <div className="pm-mt" role="dialog" aria-modal="true" aria-label={tab === 'new' ? '모델 유형 선택' : '모델 열기'}>
        <nav className="pm-mt-side" aria-label="새로 만들기 / 열기">
          <button className={tab === 'new' ? 'on' : ''} onClick={() => { setTab('new'); setQ(''); }}><span aria-hidden="true">＋</span>{change ? '유형 변경' : '새로 만들기'}</button>
          {!change && onOpen && <button className={tab === 'open' ? 'on' : ''} onClick={() => { setTab('open'); setQ(''); }}><span aria-hidden="true">▤</span>열기</button>}
        </nav>
        <div className="pm-mt-main">
          <header>
            <b>{tab === 'new' ? '모델 유형 선택' : '모델 열기'}</b>
            {fixedTool
              ? <span className="pm-mt-tool">{TOOLTYPE_LABEL[tool]}</span>
              : <div className="pm-mt-tools" role="tablist" aria-label="도구 종류">{TOOLTYPES.map((t) => <button key={t} role="tab" aria-selected={t === tool} className={t === tool ? 'on' : ''} onClick={() => pickTool(t)}>{TOOLTYPE_LABEL[t]}</button>)}</div>}
            <input className="pm-in pm-mt-q" type="search" placeholder={tab === 'new' ? '실제 분류 검색' : '모델 이름 검색'} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tab === 'new' ? '실제 분류 검색' : '모델 이름 검색'} />
            {onClose && <button className="pm-x" aria-label="닫기" onClick={onClose}>×</button>}
          </header>
          <div className="pm-mt-body">
            <ul className="pm-mt-libs">
              {libs.map((l, i) => {
                const head = i === 0 || libs[i - 1].group !== l.group ? <li key={`g-${l.group}`} className="pm-mt-group">{GROUP_LABEL[l.group]}</li> : null;
                return [head, <li key={l.lib}><button className={l.lib === lib ? 'on' : ''} title={`${l.name} (${l.zh})`} onClick={() => pickLib(l.lib)}>{l.name}</button></li>];
              })}
            </ul>
            {tab === 'new' ? (
              q.trim() ? (
                <ul className="pm-mt-hits">
                  {hits.map((p) => <li key={p.map((c) => c.id).join('/')}><button onClick={() => { setTrail(p.slice(0, 3)); setQ(''); }}>{p.map((c) => c.name).join(' / ')}<small>{p.at(-1)!.zh}</small></button></li>)}
                  {!hits.length && <li className="pm-empty">‘{q.trim()}’ 분류가 없습니다</li>}
                </ul>
              ) : (
                <div className="pm-mt-cols">
                  {cols.map((list, k) => (
                    <ul key={k} className="pm-mt-col">
                      {list.map((c) => (
                        <li key={c.id}><button className={trail[k]?.id === c.id ? 'on' : ''} title={c.zh} onClick={() => setTrail([...trail.slice(0, k), c])}>
                          {c.children ? <span className="pm-folder-ic" aria-hidden="true" /> : <span style={{ width: 18 }} aria-hidden="true" />}{c.name}{c.children && <em aria-hidden="true">›</em>}
                        </button></li>
                      ))}
                    </ul>
                  ))}
                </div>
              )
            ) : (
              <ul className="pm-mt-models">
                {models.map((m) => (
                  <li key={m.id}><button className={picked === m.id ? 'on' : ''} onClick={() => setPicked(m.id)} onDoubleClick={() => onOpen?.(m)}>
                    {m.preview ? <img src={m.preview} alt="" /> : <span className="noimg">P</span>}
                    <span><b>{m.name}</b><small>{m.category || '분류 없음'} · 부품 {m.nodes.length} · 버전 {m.version} · {new Date(m.updatedAt).toLocaleDateString('ko-KR')}</small></span>
                  </button></li>
                ))}
                {!models.length && <li className="pm-empty">이 라이브러리에 저장된 모델이 없습니다</li>}
              </ul>
            )}
          </div>
          <footer>
            {tab === 'new' ? <span>현재 선택한 분류: <b>{sel ? trail.map((c) => c.name).join(' / ') : '없음'}</b></span> : <span>{picked ? models.find((m) => m.id === picked)?.name : '열 모델을 고르세요'}</span>}
            {onClose && <button className="pm-btn" onClick={onClose}>닫기</button>}
            {tab === 'new' ? <button className="pm-primary" disabled={!sel} onClick={confirm}>확인</button> : <button className="pm-primary" disabled={!picked} onClick={openPicked}>열기</button>}
          </footer>
        </div>
      </div>
    </div>
  );
}
