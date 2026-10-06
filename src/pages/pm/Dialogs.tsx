import { useMemo, useState } from 'react';
import { modelBizProps } from '../../pm/defs';
import { fmt } from '../../pm/expr';
import { referenceGraph } from '../../pm/resolve';
import type { BuildResult } from '../../pm/geometry';
import type { PmArray, PmModel, PmNode, PmNodeReport, PmOutputRow, PmVersion } from '../../pm/types';
import { BizField } from './PropPanel';
import { Fx, Modal, Unverified } from './ui';
import { previewOf, usePm } from './ctx';

type Upd = (fn: (m: PmModel) => PmModel, label?: string) => void;

/** 업무 속성 — 모델 실제 분류에 걸린 속성(라디오 + 사용자 규칙). 쿠지알러 06 캡처 */
export function BizDialog({ update, onClose }: { update: Upd; onClose: () => void }) {
  const { model } = usePm();
  const list = modelBizProps(model.categoryId);
  const [vals, setVals] = useState<Record<string, string>>(model.biz);
  return (
    <Modal title="업무 속성" sub={`모델 유형 ‘${model.category || '없음'}’ 에 걸린 생산·설계 규칙`} size="mid" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" onClick={() => { update((m) => ({ ...m, biz: vals }), '업무 속성'); onClose(); }}>확인</button></>}>
      {list.length ? (
        <div className="pm-biz">
          {list.map((b) => [
            <div key={`k${b.key}`} className="k" title={b.zh}>{b.name}</div>,
            <div key={`v${b.key}`}><BizField biz={b} value={vals[b.key]} onChange={(v) => setVals({ ...vals, [b.key]: v })} /></div>,
          ])}
        </div>
      ) : <p className="pm-empty">이 모델 유형(실제 분류)에 걸린 업무 속성이 없습니다. 모델 유형을 바꾸면 다른 속성이 나올 수 있습니다.</p>}
    </Modal>
  );
}

/** 견적 설정(Alt+B) — 견적에 쓸 모델 폭·깊이·높이 수식 */
export function QuoteDialog({ update, onClose }: { update: Upd; onClose: () => void }) {
  const { model, ev } = usePm();
  const [q, setQ] = useState(model.quote);
  const row = (k: 'x' | 'y' | 'z', label: string) => {
    const p = previewOf(ev, q[k]);
    return <div className="pm-field"><label>{label}</label><Fx title={label} value={q[k]} onChange={(v) => setQ({ ...q, [k]: v })} preview={p.text} error={p.error} /></div>;
  };
  return (
    <Modal title="견적 설정" sub="견적·목록 출력에 쓰는 크기 — 기본 #W · #D · #H (예: 문짝은 #H · #W · #D 로 바꿔 출력)" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" onClick={() => { update((m) => ({ ...m, quote: q }), '견적 설정'); onClose(); }}>확인</button></>}>
      {row('x', '모델 폭')}{row('y', '모델 깊이')}{row('z', '모델 높이')}
    </Modal>
  );
}

/** 데이터 인터페이스 출력 설정(Alt+S) — 07 캡처: 변수 · 참조명 · 출력 참조명 · [출력 조건] · 출력 값 */
export function OutputDialog({ update, onClose }: { update: Upd; onClose: () => void }) {
  const { model, ev } = usePm();
  const vars = model.vars.filter((v) => v.scope === 'system' || v.scope === 'basic' || v.scope === 'custom');
  const [rows, setRows] = useState<PmOutputRow[]>(() => vars.map((v) => model.output.find((o) => o.name === v.name) ?? { name: v.name, on: false, outName: '', cond: '', value: '' }));
  const setRow = (i: number, p: Partial<PmOutputRow>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const all = rows.length > 0 && rows.every((r) => r.on);
  return (
    <Modal title="데이터 인터페이스 출력 설정" sub="데이터 인터페이스 출력 파일(JSON · API) 내려받기에 쓰입니다" size="wide" onClose={onClose}
      footer={<>
        <span className="left"><button className="pm-link" disabled title="쿠지알러 백엔드 데이터 출력 설정 페이지 — HP3 미구현">백엔드 데이터 출력 설정</button><Unverified /></span>
        <button className="pm-btn" onClick={onClose}>취소</button>
        <button className="pm-primary" onClick={() => { update((m) => ({ ...m, output: rows.filter((r) => r.on) }), '데이터 출력 설정'); onClose(); }}>확인</button>
      </>}>
      <b>시스템 변수 · 사용자 정의 변수</b>
      <table className="pm-table">
        <thead><tr><th>변수</th><th>참조명</th><th>출력 참조명</th><th><label className="pm-check"><input type="checkbox" checked={all} onChange={(e) => setRows(rows.map((r) => ({ ...r, on: e.target.checked })))} />출력 조건</label></th><th>출력 값</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const v = vars[i];
            const cond = r.cond.trim() ? previewOf(ev, r.cond) : { text: 'true' };
            return (
              <tr key={r.name} className={r.on ? 'on' : ''}>
                <td>{v.label}</td><td><code>{v.name}</code></td>
                <td>{r.on ? <input className="pm-in mono" value={r.outName} placeholder={v.name} onChange={(e) => setRow(i, { outName: e.target.value })} aria-label={`${v.name} 출력 참조명`} /> : <span style={{ color: '#7a8494' }}>백엔드 설정</span>}</td>
                <td style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label={`${v.name} 출력`} />
                  <div style={{ flex: 1 }}><Fx title={`${v.name} 출력 조건`} value={r.cond} disabled={!r.on} placeholder="비우면 true" onChange={(c) => setRow(i, { cond: c })} preview={r.on ? cond.text : undefined} error={cond.error} /></div>
                </td>
                <td>{v.type === 'float' || v.type === 'int'
                  ? <Fx title={`${v.name} 출력 값`} value={r.value} disabled={!r.on} placeholder={`#${v.name}`} onChange={(x) => setRow(i, { value: x })} preview={r.on ? fmt(ev.try(r.value || `#${v.name}`).value) : undefined} />
                  : <span style={{ color: '#7a8494' }}>현재값</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

/** 부품 노드 보고 설정 — 하위 노드 기준으로 하위 모델 변수를 위로 보고(교체해도 규칙 유지) */
export function NodeReportDialog({ update, onClose }: { update: Upd; onClose: () => void }) {
  const { model } = usePm();
  const subs = model.nodes.filter((n) => n.sub);
  const [rows, setRows] = useState<PmNodeReport[]>(() => subs.map((n) => model.nodeReports.find((r) => r.nodeId === n.id) ?? { nodeId: n.id, report: false, toTop: false, prefix: '' }));
  const setRow = (i: number, p: Partial<PmNodeReport>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Modal title="부품 노드 보고 설정" sub="하위 노드 기준으로 하위 모델의 변수를 위로 보고합니다. 하위 모델을 교체해도 보고 규칙은 유지됩니다." size="mid" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" onClick={() => { update((m) => ({ ...m, nodeReports: rows.filter((r) => r.report) }), '부품 노드 보고'); onClose(); }}>확인</button></>}>
      {subs.length ? (
        <table className="pm-table">
          <thead><tr><th>부품 노드</th><th>보고</th><th>최상위 모델로 보고</th><th>보고 이름 접두어</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.nodeId}>
              <td>{subs[i].name}{subs[i].refName && <code style={{ color: '#7a8494' }}> @{subs[i].refName}</code>}</td>
              <td><input type="checkbox" checked={r.report} onChange={(e) => setRow(i, { report: e.target.checked })} aria-label={`${subs[i].name} 보고`} /></td>
              <td><input type="checkbox" checked={r.toTop} disabled={!r.report} onChange={(e) => setRow(i, { toTop: e.target.checked })} aria-label={`${subs[i].name} 최상위 보고`} /></td>
              <td><input className="pm-in" value={r.prefix} disabled={!r.report} onChange={(e) => setRow(i, { prefix: e.target.value })} aria-label={`${subs[i].name} 접두어`} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="pm-empty">하위 모델 부품이 없습니다. 부품 라이브러리에서 하위 모델을 넣으면 여기서 보고 규칙을 정합니다.</p>}
    </Modal>
  );
}

/** 환경 조건 — 설계 툴에 끌어 놓을 때 변수 값을 #selfPosition · #selfRotate 로 (실수 · 수식/복합 수식이 아닌 변수만, 문서 3.1.29) */
export function EnvDialog({ update, onClose }: { update: Upd; onClose: () => void }) {
  const { model } = usePm();
  const eligible = model.vars.filter((v) => (v.scope === 'custom' || v.scope === 'basic') && v.type === 'float' && v.valueType !== 'formula' && v.valueType !== 'composite');
  const [env, setEnv] = useState<Record<string, string>>(() => Object.fromEntries(eligible.map((v) => [v.id, v.env ?? ''])));
  return (
    <Modal title="환경 조건" sub="설계 툴에 끌어 놓을 때 변수를 환경 조건으로 정합니다 — #selfPosition.x/y/z (z = 바닥에서 높이) · #selfRotate.x/y/z" size="mid" onClose={onClose}
      footer={<><span className="left pm-hint">에디터에서 하위 모델로 넣을 때는 적용되지 않습니다(편집기 로직). 설계 툴에서는 회색으로 고정됩니다.</span>
        <button className="pm-btn" onClick={onClose}>취소</button>
        <button className="pm-primary" onClick={() => { update((m) => ({ ...m, vars: m.vars.map((v) => (v.id in env ? { ...v, env: env[v.id].trim() || undefined } : v)) }), '환경 조건'); onClose(); }}>확인</button></>}>
      {eligible.length ? (
        <table className="pm-table">
          <thead><tr><th>변수</th><th>참조명</th><th>환경 조건 수식</th></tr></thead>
          <tbody>{eligible.map((v) => (
            <tr key={v.id}><td>{v.label}</td><td><code>{v.name}</code></td>
              <td><Fx title={`${v.name} 환경 조건`} value={env[v.id]} placeholder="예: #selfPosition.z" onChange={(x) => setEnv({ ...env, [v.id]: x })} /></td></tr>
          ))}</tbody>
        </table>
      ) : <p className="pm-empty">환경 조건을 걸 수 있는 변수(실수 · 수식/복합 수식 아님)가 없습니다.</p>}
    </Modal>
  );
}

/** 모델 진단 — 성능 검사(노드 수 · 면 수 · 숨김 비율) · 간섭 검사(경계 상자 겹침) · 수식 진단. 08 캡처 */
export function DiagPanel({ built, onPick, onClose }: { built: BuildResult; onPick: (nodeId?: string, varName?: string) => void; onClose: () => void }) {
  const { model, ev } = usePm();
  const [tab, setTab] = useState<'perf' | 'hit' | 'expr'>('expr');
  const [at] = useState(() => Date.now());
  const diags = useMemo(() => ev.diagsAll().slice(), [ev]);
  const solids = built.parts.filter((p) => p.kind !== 'aux');
  const faces = solids.reduce((a, p) => a + p.faces, 0);
  const hiddenRatio = solids.length ? Math.round((solids.filter((p) => p.hidden).length / solids.length) * 100) : 0;
  const hits = useMemo(() => {
    const boxes = built.parts.filter((p) => p.kind !== 'aux').filter((p) => !p.hidden && p.geometry).map((p) => { p.geometry!.computeBoundingBox(); return { p, b: p.geometry!.boundingBox!.clone().applyMatrix4(p.matrix) }; });
    const out: { a: string; b: string; v: number; ai: string; bi: string }[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].p.nodeId === boxes[j].p.nodeId) continue;
      const x = boxes[i].b.clone().intersect(boxes[j].b);
      if (x.isEmpty()) continue;
      const s = x.getSize(x.min.clone());
      if (s.x > 0.5 && s.y > 0.5 && s.z > 0.5) out.push({ a: boxes[i].p.name, b: boxes[j].p.name, v: s.x * s.y * s.z, ai: boxes[i].p.nodeId, bi: boxes[j].p.nodeId });
    }
    return out.slice(0, 100);
  }, [built]);
  return (
    <div className="pm-float pm-diag" role="complementary" aria-label="모델 진단">
      <header><b>모델 진단</b><button className="pm-x" aria-label="모델 진단 닫기" onClick={onClose}>×</button></header>
      <div className="pm-diag-tabs">
        <button className={tab === 'expr' ? 'on' : ''} onClick={() => setTab('expr')}>수식 진단 {diags.length > 0 && `(${diags.length})`}</button>
        <button className={tab === 'perf' ? 'on' : ''} onClick={() => setTab('perf')}>성능 검사</button>
        <button className={tab === 'hit' ? 'on' : ''} onClick={() => setTab('hit')}>간섭 검사 {hits.length > 0 && `(${hits.length})`}</button>
      </div>
      <div className="pm-diag-body">
        {tab === 'expr' && (diags.length ? (
          <ul className="pm-diag-list">{diags.map((d, i) => (
            <li key={i} onClick={() => onPick(d.nodeId, d.varName)}><span className={`lv ${d.level}`}>{d.level === 'error' ? '오류' : '경고'}</span><span>{d.message}<small>{d.where}</small></span></li>
          ))}</ul>
        ) : <p className="pm-empty">수식 오류·경고가 없습니다.</p>)}
        {tab === 'perf' && <>
          <p className="pm-hint">모델 진단 데이터 — {new Date(at).toLocaleTimeString('ko-KR')} 생성</p>
          <div className="pm-diag-sum"><span>등급·점수 <Unverified text="쿠지알러 계산식 미확인" /></span></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="pm-btn xs" disabled title="쿠지알러 동작 미확인">하위 단계 숨김→억제 전환</button>
            <button className="pm-btn xs" disabled title="쿠지알러 동작 미확인">현재 단계 숨김→억제 전환</button>
          </div>
          <table className="pm-table"><thead><tr><th>모델 이름</th><th>노드 수</th><th>면 수</th><th>숨김 비율</th></tr></thead>
            <tbody><tr><td>{model.name}</td><td>{model.nodes.length}</td><td>{Math.round(faces)}</td><td>{hiddenRatio}%</td></tr>
              {model.nodes.filter((n) => n.sub?.kind === 'param').map((n) => {
                const ps = built.parts.filter((p) => p.nodeId === n.id && p.kind !== 'aux');
                return <tr key={n.id}><td>└ {n.name}</td><td>{ev.child(n)?.model.nodes.length ?? 0}</td><td>{Math.round(ps.reduce((a, p) => a + p.faces, 0))}</td><td>{ps.length ? Math.round((ps.filter((p) => p.hidden).length / ps.length) * 100) : 0}%</td></tr>;
              })}</tbody></table>
        </>}
        {tab === 'hit' && (hits.length ? (
          <ul className="pm-diag-list">{hits.map((h, i) => (
            <li key={i} onClick={() => onPick(h.ai)}><span className="lv warn">겹침</span><span>{h.a} ↔ {h.b}<small>경계 상자 겹침 부피 {Math.round(h.v / 1000)} cm³</small></span></li>
          ))}</ul>
        ) : <p className="pm-empty">겹치는 부품이 없습니다 (보이는 부품의 경계 상자 기준).</p>)}
      </div>
    </div>
  );
}

/** 변수 계열 — 떠 있는 패널 (‘변수 계열 없음 · 변수 계열 가져오기’) */
export function FamilyPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="pm-float pm-family" role="complementary" aria-label="변수 계열">
      <header><b>변수 계열</b><button className="pm-x" aria-label="변수 계열 닫기" onClick={onClose}>×</button></header>
      <div className="pm-diag-body">
        <p className="pm-empty">변수 계열 없음</p>
        <button className="pm-btn" disabled title="쿠지알러 변수 계열 화면 미확인">변수 계열 가져오기</button><Unverified />
      </div>
    </div>
  );
}

/** 모델 버전 — 입고 때 이력 버전으로 기록. 현재 버전 설명 · 이력(버전 · 시각 · 수정자 · 설명 · 복구). 11 캡처 */
export function VersionsDialog({ onRestore, onDesc, desc, onClose }: { onRestore: (v: PmVersion) => void; onDesc: (d: string) => void; desc: string; onClose: () => void }) {
  const { model } = usePm();
  return (
    <Modal title="모델 버전" sub="입고할 때 이력 버전으로 기록됩니다" size="wide" onClose={onClose}>
      <b>현재 버전</b>
      <input className="pm-in" value={desc} placeholder="눌러서 수정 설명 입력 — 다음 ‘저장 후 입고’ 때 기록" onChange={(e) => onDesc(e.target.value)} />
      <b>이력 버전</b>
      <table className="pm-table">
        <thead><tr><th>모델 버전</th><th>버전 시각</th><th>수정자</th><th>수정 설명</th><th>조작</th></tr></thead>
        <tbody>
          {model.versions.map((v) => (
            <tr key={v.version}><td>{v.version}</td><td>{new Date(v.at).toLocaleString('ko-KR')}</td><td>{v.by}</td><td>{v.desc || '-'}</td>
              <td><button className="pm-link" onClick={() => onRestore(v)}>복구</button></td></tr>
          ))}
          {!model.versions.length && <tr><td colSpan={5} className="pm-empty">아직 입고한 버전이 없습니다</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}

const KEYS: [string, [string, string][]][] = [
  ['삽입', [['평면 판재', 'Shift+P'], ['경사 절단 스윕', 'Shift+O'], ['모서리형 판재', 'Shift+U'], ['로프트', 'Shift+F'], ['스윕', 'Shift+S'], ['융합 (미확인)', 'Shift+R'], ['격자', 'Shift+W'],
    ['윤곽 제한', 'Shift+L'], ['직선 흡착', 'Shift+X'], ['직각 흡착', 'Shift+Z'], ['흡착 윤곽', 'Shift+K'], ['사각 내부 공간', 'Shift+N'], ['문 개구부', 'Shift+M'], ['충돌(간섭) 영역', 'Shift+C'], ['배관 연결구', 'Shift+G']]],
  ['기능', [['왼쪽 패널 전환', '~'], ['문 개구부 연결 (미확인)', 'Alt+M'], ['표시/숨김', 'H'], ['데이터 출력', 'Alt+S'], ['교체', 'C'], ['견적 출력', 'Alt+B'], ['배열', 'A'], ['배열 해제', 'Ctrl+Shift+A']]],
  ['편집', [['실행 취소', 'Ctrl+Z'], ['다시 실행', 'Ctrl+Shift+Z'], ['저장', 'Ctrl+S'], ['다른 이름으로 저장', 'Ctrl+Shift+S'], ['저장 후 입고', 'Ctrl+Alt+S'], ['복제', 'Ctrl+V'], ['비우기', 'Ctrl+E'], ['삭제', 'Delete']]],
  ['표시', [['재질', 'Ctrl+1'], ['재질+와이어프레임', 'Ctrl+2'], ['투명', 'Ctrl+3'], ['흰색', 'Ctrl+4'], ['2D 위/아래', 'T / B'], ['2D 왼/오른', 'L / R'], ['2D 앞/뒤', 'F / K'], ['3D 전환', 'V']]],
];
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="단축키" size="mid" onClose={onClose}>
      <div className="pm-grid2">
        {KEYS.map(([g, list]) => (
          <div key={g}><b>{g}</b>
            <table className="pm-table"><tbody>{list.map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}><kbd>{v}</kbd></td></tr>)}</tbody></table></div>
        ))}
      </div>
    </Modal>
  );
}

/** 참조 보기 — 변수·부품이 무엇을 참조하는지(의존 그래프 목록) */
export function RefsDialog({ onPick, onClose }: { onPick: (nodeId?: string, varName?: string) => void; onClose: () => void }) {
  const { model } = usePm();
  const edges = useMemo(() => referenceGraph(model), [model]);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = edges.filter((e) => !query || e.from.toLowerCase().includes(query) || e.to.toLowerCase().includes(query));
  const pick = (k: string) => {
    if (k.startsWith('#')) onPick(undefined, k.slice(1));
    else { const n = model.nodes.find((x) => (k.startsWith('@') ? x.refName === k.slice(1) : x.name === k)); onPick(n?.id); }
  };
  return (
    <Modal title="참조 보기" sub="누가 무엇을 참조하는지 — 이름을 누르면 그 변수·부품으로 이동" size="mid" onClose={onClose}>
      <input className="pm-in" type="search" placeholder="#변수 · @부품 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="참조 검색" />
      <table className="pm-table">
        <thead><tr><th>참조하는 쪽</th><th>항목</th><th>참조 대상</th></tr></thead>
        <tbody>{list.map((e, i) => (
          <tr key={i}><td><button className="pm-link" onClick={() => pick(e.from)}>{e.from}</button></td><td>{e.via}</td><td><button className="pm-link" onClick={() => pick(e.to)}>{e.to}</button></td></tr>
        ))}</tbody>
      </table>
      {!list.length && <p className="pm-empty">참조가 없습니다</p>}
    </Modal>
  );
}

/** 배열(A) — 방향 · 길이 · 방식(간격/개수) · 값. 교육 문서 2.1.21(백엽 문짝) 배열 설명 그대로 */
export function ArrayDialog({ node, onApply, onClose }: { node: PmNode; onApply: (a: PmArray) => void; onClose: () => void }) {
  const [a, setA] = useState<PmArray>(node.array ?? { dir: 'z+', length: '#H', mode: 'step', value: '100' });
  return (
    <Modal title={`배열 — ${node.name}`} sub="방향 X·Y·Z(실선 방향이 +) · 배열 길이(범위) · 방식: 간격이면 개수가, 개수면 간격이 길이에 따라 바뀜" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" onClick={() => { onApply(a); onClose(); }}>생성</button></>}>
      <div className="pm-grid2">
        <div className="pm-field"><label>배열 방향</label><select className="pm-sel" value={a.dir} onChange={(e) => setA({ ...a, dir: e.target.value as PmArray['dir'] })}>{(['x+', 'x-', 'y+', 'y-', 'z+', 'z-'] as const).map((d) => <option key={d} value={d}>{d.toUpperCase()}</option>)}</select></div>
        <div className="pm-field"><label>배열 길이</label><Fx title="배열 길이" value={a.length} onChange={(v) => setA({ ...a, length: v })} /></div>
        <div className="pm-field"><label>배열 방식</label><select className="pm-sel" value={a.mode} onChange={(e) => setA({ ...a, mode: e.target.value as PmArray['mode'] })}><option value="step">간격</option><option value="count">개수</option></select></div>
        <div className="pm-field"><label>{a.mode === 'step' ? '간격' : '개수'}</label><Fx title={a.mode === 'step' ? '간격' : '개수'} value={a.value} onChange={(v) => setA({ ...a, value: v })} /></div>
      </div>
    </Modal>
  );
}
