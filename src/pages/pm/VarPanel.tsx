import { useState, type ReactNode } from 'react';
import { EXT_ATTRS } from '../../pm/defs';
import { fmt, renameVar } from '../../pm/expr';
import { uid } from '../../pm/resolve';
import { loadGlobals, loadTemplates, saveTemplates } from '../../pm/store';
import type { ParamType, PmModel, PmVar, ValueType, VarOption, VarScope } from '../../pm/types';
import { materialLibs, profileLibs } from '../../pm/catalog';
import type { Item } from '../../data/contentLibrary';
import { ItemPicker, ModelPicker } from './pickers';
import { PARAM_TYPE_LABEL, VALUE_TYPES_FOR, VALUE_TYPE_LABEL, isFormulaVar } from './varMeta';
import { Confirm, Fx, Modal, Sec, Switch } from './ui';
import { previewOf, usePm } from './ctx';

const SCOPE_TITLE: Record<VarScope, string> = { system: '시스템 변수', basic: '기본 변수', custom: '사용자 정의 변수', middle: '중간 변수', report: '보고 변수' };
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * 파라미터 설정(参数配置) 탭 — 시스템 변수 · 기본 변수 · 사용자 정의 변수(그룹) · 중간 변수 · 보고 변수.
 * 행: 이름 · 참조명 · 현재값(바로 수정). 이름을 누르면 변수 편집 창, 오른쪽 클릭 메뉴(편집 · 템플릿으로 저장 · 위/아래 · 삭제).
 */
export function VarPanel({ update, items, focusVar, markHidden }: {
  update: (fn: (m: PmModel) => PmModel, label?: string) => void;
  items: Item[];
  focusVar?: string | null;
  /** ‘숨김 변수 위치 표시’ — 숨김 조건이 참인 변수를 표시 */
  markHidden: boolean;
}) {
  const { model, ev, toast } = usePm();
  const [edit, setEdit] = useState<{ v: PmVar; isNew: boolean } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; v: PmVar } | null>(null);
  const [del, setDel] = useState<PmVar | null>(null);
  const [pick, setPick] = useState<PmVar | null>(null);
  const [tplImport, setTplImport] = useState<VarScope | null>(null);
  const [tplSave, setTplSave] = useState<PmVar | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [globalImport, setGlobalImport] = useState(false);

  const setVar = (id: string, patch: Partial<PmVar>, label = '변수 수정') =>
    update((m) => ({ ...m, vars: m.vars.map((v) => (v.id === id ? { ...v, ...patch } : v)) }), label);

  const save = (v: PmVar, prev?: PmVar) => {
    update((m) => {
      let vars = m.vars.some((x) => x.id === v.id) ? m.vars.map((x) => (x.id === v.id ? v : x)) : [...m.vars, v];
      let nodes = m.nodes;
      // 참조명을 바꾸면 모든 수식의 #이전이름 → #새이름
      if (prev && prev.name !== v.name) {
        const rn = (s: string | undefined) => (s ? renameVar(s, prev.name, v.name) : s);
        vars = vars.map((x) => ({ ...x, value: x.type === 'float' || x.type === 'int' || x.type === 'boolean' ? rn(x.value)! : x.value, formula: rn(x.formula), min: rn(x.min), max: rn(x.max), hidden: rn(x.hidden), options: x.options?.map((o) => ({ ...o, hidden: rn(o.hidden) })) }));
        nodes = nodes.map((n) => ({ ...n, params: Object.fromEntries(Object.entries(n.params).map(([k, s]) => [k, rn(s)!])) }));
      }
      const groups = v.group && !m.groups.includes(v.group) ? [...m.groups, v.group] : m.groups;
      return { ...m, vars, nodes, groups };
    }, prev ? `변수 ${v.name} 수정` : `변수 ${v.name} 추가`);
  };

  const move = (v: PmVar, dir: -1 | 1) => update((m) => {
    const same = m.vars.filter((x) => x.scope === v.scope && (x.group ?? '') === (v.group ?? ''));
    const i = same.findIndex((x) => x.id === v.id), j = i + dir;
    if (j < 0 || j >= same.length) return m;
    const a = m.vars.indexOf(same[i]), b = m.vars.indexOf(same[j]);
    const vars = [...m.vars];
    [vars[a], vars[b]] = [vars[b], vars[a]];
    return { ...m, vars };
  }, '변수 순서');

  const blank = (scope: VarScope, group?: string): PmVar => ({
    id: uid('v'), scope, name: '', label: '', type: 'float',
    valueType: scope === 'middle' || scope === 'report' ? 'formula' : 'range', value: scope === 'custom' ? '0' : '', min: scope === 'custom' ? '0' : undefined, max: scope === 'custom' ? '1000' : undefined,
    visible: true, editable: true, group,
  });

  const row = (v: PmVar) => {
    const r = ev.varEval(v.name);
    const fx = isFormulaVar(v);
    const hidden = !!r?.hidden && markHidden;
    const cls = `pm-vrow ${focusVar === v.name ? 'sel' : ''} ${hidden ? 'hid' : ''} ${r?.error ? 'err' : ''}`;
    let cell;
    if (v.type === 'material' || v.type === 'profile' || v.type === 'style') {
      const name = v.type === 'style' ? (v.value ? ev.opts.catalog?.model?.(v.value)?.name ?? v.value : '') : ev.nameOf(v.value, v.type);
      cell = fx ? <input className="fx" value={v.formula ?? ''} readOnly title={v.formula} onClick={() => setEdit({ v, isNew: false })} aria-label={`${v.label} 수식`} />
        : <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, cursor: 'pointer' }} onClick={() => setPick(v)} title="고르기">
          {v.type === 'material' && <span className="pm-swatch" style={/^c:/i.test(v.value) ? { background: `#${v.value.slice(2)}` } : { background: '#d8c5a8' }} />}
          <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(name || (v.value ? v.value : '선택'))}</small>
        </span>;
    } else if (fx) {
      cell = <input className="fx" value={v.formula ?? ''} title={`= ${r?.error ? r.error : fmt(r?.value)}`} aria-label={`${v.label} 수식`}
        onChange={(e) => setVar(v.id, { formula: e.target.value })} />;
    } else if (v.valueType === 'options' && v.options?.length) {
      cell = <select value={v.value} aria-label={`${v.label} 현재값`} onChange={(e) => setVar(v.id, { value: e.target.value })}>
        {(r?.options ?? v.options).map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        {!v.options.some((o) => o.value === v.value) && <option value={v.value}>{v.value}</option>}
      </select>;
    } else if (v.type === 'boolean') {
      cell = <select value={/^(true|1)$/i.test(v.value) ? 'true' : 'false'} aria-label={`${v.label} 현재값`} onChange={(e) => setVar(v.id, { value: e.target.value })}><option value="true">예</option><option value="false">아니오</option></select>;
    } else {
      cell = <input value={v.value} disabled={v.valueType === 'fixed'} aria-label={`${v.label} 현재값`} onChange={(e) => setVar(v.id, { value: e.target.value })} />;
    }
    return (
      <div key={v.id} className={cls} id={`pm-var-${v.name}`} onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, v }); }}>
        <span className="n" title={`${v.label} — 눌러서 편집`} onClick={() => setEdit({ v, isNew: false })}>{v.label || v.name}{v.globalId && ' ⓖ'}</span>
        <span className="r" title={v.name} onClick={() => setEdit({ v, isNew: false })}>{v.name}</span>
        <span className="v">{cell}</span>
      </div>
    );
  };

  const table = (list: PmVar[], empty: string, grouped = false) => {
    if (!list.length) return <p className="pm-empty" style={{ padding: '2px 4px' }}>{empty}</p>;
    const head = [<span key="h1" className="h">이름</span>, <span key="h2" className="h">참조명</span>, <span key="h3" className="h">현재값</span>];
    if (!grouped) return <div className="pm-vt">{head}{list.map(row)}</div>;
    const groups = ['', ...model.groups.filter((g) => list.some((v) => v.group === g))];
    return <div className="pm-vt">{head}{groups.map((g) => {
      const vs = list.filter((v) => (v.group ?? '') === g);
      if (!vs.length) return null;
      return [g ? <div key={`g-${g}`} className="pm-vgroup">{g}</div> : null, ...vs.map(row)];
    })}</div>;
  };

  const by = (s: VarScope) => model.vars.filter((v) => v.scope === s);
  const addBtn = (scope: VarScope, label: string) => <button className="pm-icon" title={label} aria-label={label} onClick={() => setEdit({ v: blank(scope), isNew: true })}>＋</button>;
  const importBtn = (scope: VarScope) => <button className="pm-icon" title="변수 템플릿 가져오기" aria-label={`${SCOPE_TITLE[scope]} 템플릿 가져오기`} onClick={() => setTplImport(scope)}>⇩</button>;

  return (
    <>
      <Sec title="시스템 변수" defaultOpen={by('system').length > 0}>
        {table(by('system'), '이 분류의 시스템 변수가 없습니다. (분류별 시스템 변수 정의는 쿠지알러 모델을 가져올 때 그대로 유지)')}
      </Sec>
      <Sec title="기본 변수">{table(by('basic'), '기본 변수가 없습니다')}</Sec>
      <Sec title="사용자 정의 변수" actions={<>
        <button className="pm-icon" title="사용자 그룹 관리" aria-label="사용자 그룹 관리" onClick={() => setGroupsOpen(true)}>⚙</button>
        <button className="pm-icon" title="전역 변수 가져오기" aria-label="전역 변수 가져오기" onClick={() => setGlobalImport(true)}>ⓖ</button>
        {importBtn('custom')}
        {addBtn('custom', '사용자 정의 변수 추가')}
      </>}>
        {table(by('custom'), '사용자 정의 변수가 없습니다', true)}
      </Sec>
      <Sec title="중간 변수" actions={<>{importBtn('middle')}{addBtn('middle', '중간 변수 추가')}</>}>{table(by('middle'), '중간 변수를 추가하지 않았습니다')}</Sec>
      <Sec title={<>보고 변수 <span title="하위 부품의 속성(@참조명.변수 · #참조명.paramStyle.name)을 읽어 견적·형번·코드에 쓰는 변수" aria-hidden="true">ⓘ</span></>}
        actions={<>{importBtn('report')}{addBtn('report', '보고 변수 추가')}</>}>{table(by('report'), '보고 변수를 추가하지 않았습니다')}</Sec>

      {ctx && <div className="pm-ctx" style={{ left: ctx.x, top: ctx.y }} onMouseLeave={() => setCtx(null)}>
        <button onClick={() => { setEdit({ v: ctx.v, isNew: false }); setCtx(null); }}>편집</button>
        {(ctx.v.scope === 'custom' || ctx.v.scope === 'middle' || ctx.v.scope === 'report') && <button onClick={() => { setTplSave(ctx.v); setCtx(null); }}>템플릿으로 저장</button>}
        <button onClick={() => { move(ctx.v, -1); setCtx(null); }}>위로</button>
        <button onClick={() => { move(ctx.v, 1); setCtx(null); }}>아래로</button>
        <hr />
        <button className="danger" disabled={ctx.v.scope === 'basic' || ctx.v.scope === 'system'} onClick={() => { setDel(ctx.v); setCtx(null); }}>삭제</button>
      </div>}
      {ctx && <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onMouseDown={() => setCtx(null)} />}

      {edit && <VarDialog v={edit.v} isNew={edit.isNew} model={model} onClose={() => setEdit(null)}
        onSave={(v) => { const prev = edit.isNew ? undefined : edit.v; save(v, prev); setEdit(null); }} items={items} />}
      {del && (() => {
        const used = model.vars.some((x) => x.id !== del.id && [x.value, x.formula, x.min, x.max, x.hidden].some((s) => s?.includes(`#${del.name}`)))
          || model.nodes.some((n) => Object.values(n.params).some((s) => s?.includes(`#${del.name}`)));
        return <Confirm danger text={<>변수 <b>{del.label} ({del.name})</b> 을(를) 삭제할까요?{used && <><br /><small style={{ color: '#c4402f' }}>다른 수식에서 #{del.name} 을(를) 쓰고 있습니다. 삭제하면 그 수식이 오류가 됩니다.</small></>}</>}
          ok="삭제" onCancel={() => setDel(null)} onOk={() => { update((m) => ({ ...m, vars: m.vars.filter((x) => x.id !== del.id) }), `변수 ${del.name} 삭제`); setDel(null); }} />;
      })()}
      {pick && (pick.type === 'style'
        ? <ModelPicker title={`${pick.label} — 스타일(모델) 고르기`} exclude={model.id} onClose={() => setPick(null)} onPick={(m) => setVar(pick.id, { value: m.id })} />
        : <ItemPicker title={`${pick.label} — ${pick.type === 'material' ? '재질' : '윤곽'} 고르기`} items={items} value={pick.value}
          libs={pick.type === 'material' ? materialLibs(model.tooltype) : profileLibs(model.tooltype)} filter={pick.type === 'profile' ? (i) => !!i.profile : undefined}
          allowColor={pick.type === 'material'} onClose={() => setPick(null)} onPick={(id) => setVar(pick.id, { value: id })} />)}
      {tplSave && <TemplateSave v={tplSave} onClose={() => setTplSave(null)} onDone={(name) => { toast(`변수 템플릿 ‘${name}’ 폴더에 저장했습니다`); setTplSave(null); }} />}
      {tplImport && <TemplateImport scope={tplImport} model={model} onClose={() => setTplImport(null)}
        onImport={(vars) => { update((m) => ({ ...m, vars: [...m.vars, ...vars], groups: [...m.groups, ...vars.map((v) => v.group).filter((g): g is string => !!g && !m.groups.includes(g))].filter((g, i, a) => a.indexOf(g) === i) }), '변수 템플릿 가져오기'); toast(`변수 ${vars.length}개를 가져왔습니다`); setTplImport(null); }} />}
      {groupsOpen && <GroupDialog model={model} onClose={() => setGroupsOpen(false)} onSave={(groups, renames) => {
        update((m) => ({ ...m, groups, vars: m.vars.map((v) => (v.group && renames[v.group] !== undefined ? { ...v, group: renames[v.group] || undefined } : v)) }), '사용자 그룹');
        setGroupsOpen(false);
      }} />}
      {globalImport && <GlobalImport model={model} onClose={() => setGlobalImport(false)} onImport={(vars) => { update((m) => ({ ...m, vars: [...m.vars, ...vars] }), '전역 변수 가져오기'); setGlobalImport(false); }} />}
    </>
  );
}

/* ───────────── 변수 편집 창 ───────────── */

/**
 * 변수 편집 — 문서(1.1.6 · 2.4.17/18 · 3.1.28)의 항목: 이름 · 참조명 · 변수 형식 · 값 유형(구간/선택/무제한/수식/복합 수식/고정값)
 * · 최솟값/최댓값(수식) · 선택지(이름·값·숨김 조건) · 추천값 · 현재값 · 복합 수식(값 구간 · 수식 이름 · 표현식 · 기본 상태)
 * · 숨김 조건 · 수정 가능 · 확장 속성(잠금 조건 · 등급 라벨) · 그룹 · 설명.
 * 쿠지알러 창 배치 자체는 확인하지 못해(명세서 미확인 항목) 항목만 문서대로 둔다.
 */
export function VarDialog({ v: init, isNew, model, onSave, onClose, items, global, extra }: { v: PmVar; isNew: boolean; model: PmModel; onSave: (v: PmVar) => void; onClose: () => void; items: Item[]; global?: boolean; extra?: ReactNode }) {
  const { ev } = usePm();
  const [v, setV] = useState<PmVar>(init);
  /** 고르기 대상 — 현재값 또는 선택지 번호 */
  const [pickFor, setPickFor] = useState<number | 'value' | null>(null);
  const set = (p: Partial<PmVar>) => setV((x) => ({ ...x, ...p }));
  const sys = v.scope === 'system', basic = v.scope === 'basic';
  const exprOnly = v.scope === 'middle' || v.scope === 'report';
  const types: ParamType[] = exprOnly ? ['float', 'int', 'string', 'boolean', 'multiBoolean', 'material', 'style', 'profile']
    : basic ? [v.type] : ['float', 'int', 'string', 'boolean', 'multiBoolean', 'material', 'style', 'profile'];
  const vts = VALUE_TYPES_FOR[v.type];
  const nameErr = !v.name ? '참조명을 입력하세요' : !NAME_RE.test(v.name) ? '영문자로 시작하고 영문·숫자만 쓸 수 있습니다'
    : model.vars.some((x) => x.id !== v.id && x.name === v.name) ? '이미 있는 참조명입니다' : null;
  const numeric = v.type === 'float' || v.type === 'int';
  const p = (e?: string) => previewOf(ev, e);

  const setOpt = (i: number, o: Partial<VarOption>) => set({ options: (v.options ?? []).map((x, k) => (k === i ? { ...x, ...o } : x)) });
  const pickable = v.type === 'material' || v.type === 'profile' || v.type === 'style';
  const curName = v.type === 'style' ? (v.value ? ev.opts.catalog?.model?.(v.value)?.name : '') : ev.nameOf(v.value, v.type);

  return (
    <Modal title={isNew ? `${SCOPE_TITLE[v.scope]} 추가` : `${SCOPE_TITLE[v.scope]} 편집`} sub={global ? '전역 변수 — 모델에서 가져와 통일 제어' : undefined} size="mid" onClose={onClose}
      footer={<>
        <span className="left pm-hint">{v.globalId ? '전역 변수에서 가져온 변수 — 정의는 전역 변수 페이지에서 바꿉니다' : ''}</span>
        <button className="pm-btn" onClick={onClose}>취소</button>
        <button className="pm-primary" disabled={!!nameErr || !v.label.trim()} onClick={() => onSave({ ...v, label: v.label.trim(), name: v.name.trim() })}>{isNew ? '만들기' : '확인'}</button>
      </>}>
      <div className="pm-grid2">
        <div className="pm-field"><label>이름(名称)</label><input className="pm-in" value={v.label} disabled={!!v.globalId} onChange={(e) => set({ label: e.target.value })} placeholder="설계 툴에 보이는 이름" autoFocus={isNew} /></div>
        <div className="pm-field"><label>참조명(引用名)</label><input className="pm-in mono" value={v.name} disabled={basic || sys || !!v.globalId} onChange={(e) => set({ name: e.target.value })} placeholder="예: W1" />{nameErr && v.name && <span className="err">{nameErr}</span>}</div>
        <div className="pm-field"><label>변수 형식(参数类型)</label>
          <select className="pm-sel" value={v.type} disabled={basic || sys || !!v.globalId} onChange={(e) => { const t = e.target.value as ParamType; const ok = VALUE_TYPES_FOR[t]; set({ type: t, valueType: exprOnly ? 'formula' : ok.includes(v.valueType) ? v.valueType : ok[0], value: t === 'boolean' ? 'false' : t === 'float' || t === 'int' ? '0' : '' }); }}>
            {types.map((t) => <option key={t} value={t}>{PARAM_TYPE_LABEL[t]}</option>)}
          </select></div>
        {!exprOnly && <div className="pm-field"><label>값 유형(值类型)</label>
          <select className="pm-sel" value={v.valueType} disabled={sys || !!v.globalId} onChange={(e) => set({ valueType: e.target.value as ValueType, state: e.target.value === 'composite' ? v.state ?? 'value' : v.state })}>
            {vts.map((t) => <option key={t} value={t}>{VALUE_TYPE_LABEL[t]}</option>)}
          </select></div>}
      </div>

      {!exprOnly && (v.valueType === 'range' || v.valueType === 'composite') && numeric && (
        <div className="pm-grid3">
          <div className="pm-field"><label>최솟값</label><Fx title="최솟값" value={v.min ?? ''} onChange={(x) => set({ min: x })} preview={p(v.min).text} error={p(v.min).error} /></div>
          <div className="pm-field"><label>최댓값</label><Fx title="최댓값" value={v.max ?? ''} onChange={(x) => set({ max: x })} preview={p(v.max).text} error={p(v.max).error} /></div>
          <div className="pm-field"><label>증분</label><input className="pm-in mono" value={v.step ?? ''} onChange={(e) => set({ step: e.target.value })} placeholder="예: 1" /></div>
        </div>
      )}

      {!exprOnly && v.valueType === 'options' && (
        <div className="pm-field">
          <label>선택지 (표시 이름 · 값 · 숨김 조건)</label>
          <div className="pm-opts">
            {(v.options ?? []).map((o, i) => (
              <div className="pm-opt" key={i}>
                <input className="pm-in" value={o.name} placeholder="표시 이름" onChange={(e) => setOpt(i, { name: e.target.value })} aria-label={`선택지 ${i + 1} 이름`} />
                {pickable
                  ? <button className="pm-btn xs" onClick={() => setPickFor(i)}>{o.value ? (o.name || o.value) : '고르기'}</button>
                  : <input className="pm-in mono" value={o.value} placeholder="값" onChange={(e) => setOpt(i, { value: e.target.value })} aria-label={`선택지 ${i + 1} 값`} />}
                <input className="pm-in mono" value={o.hidden ?? ''} placeholder="숨김 조건(수식)" onChange={(e) => setOpt(i, { hidden: e.target.value })} aria-label={`선택지 ${i + 1} 숨김 조건`} />
                <button className="pm-x" aria-label="선택지 삭제" onClick={() => set({ options: (v.options ?? []).filter((_, k) => k !== i) })}>×</button>
              </div>
            ))}
            <button className="pm-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => set({ options: [...(v.options ?? []), { name: '', value: '' }] })}>＋ 선택지</button>
          </div>
        </div>
      )}

      {(exprOnly || v.valueType === 'formula' || v.valueType === 'composite') && (
        <>
          {v.valueType === 'composite' && <div className="pm-field"><label>수식 이름(公式名称)</label><input className="pm-in" value={v.formulaName ?? ''} onChange={(e) => set({ formulaName: e.target.value })} placeholder="예: 좌우 최댓값" /></div>}
          <div className="pm-field"><label>{v.valueType === 'composite' ? '표현식(表达式)' : '수식'}</label>
            <Fx title={`${v.label || v.name} 수식`} value={v.formula ?? ''} onChange={(x) => set({ formula: x })} preview={p(v.formula).text} error={p(v.formula).error} /></div>
          {v.valueType === 'composite' && <div className="pm-field"><label>기본 상태 — 설계 툴에서 처음 보이는 상태</label>
            <div style={{ display: 'flex', gap: 14 }}>
              <label className="pm-radio"><input type="radio" checked={(v.state ?? 'value') === 'value'} onChange={() => set({ state: 'value' })} />값</label>
              <label className="pm-radio"><input type="radio" checked={v.state === 'formula'} onChange={() => set({ state: 'formula' })} />수식</label>
            </div></div>}
        </>
      )}

      {!exprOnly && v.valueType !== 'formula' && (
        <div className="pm-field"><label>현재값(当前值){v.valueType === 'composite' && ' — 값 상태일 때'}</label>
          {pickable ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="pm-btn" onClick={() => setPickFor('value')}>{curName || v.value || '고르기'}</button>
              {v.value && <code style={{ color: '#7a8494' }}>{v.value}</code>}
            </div>
          ) : v.valueType === 'options' ? (
            <select className="pm-sel" value={v.value} onChange={(e) => set({ value: e.target.value })}>
              <option value="">(없음)</option>
              {(v.options ?? []).map((o, i) => <option key={i} value={o.value}>{o.name || o.value}</option>)}
            </select>
          ) : v.type === 'boolean' ? (
            <select className="pm-sel" value={/^(true|1)$/i.test(v.value) ? 'true' : 'false'} onChange={(e) => set({ value: e.target.value })}><option value="true">예</option><option value="false">아니오</option></select>
          ) : (
            <input className="pm-in mono" value={v.value} onChange={(e) => set({ value: e.target.value })} placeholder={v.type === 'multiBoolean' ? '예: 10110 (자리마다 1=예, 0=아니오)' : ''} />
          )}
        </div>
      )}

      {!exprOnly && numeric && (v.valueType === 'range' || v.valueType === 'free') && (
        <div className="pm-field"><label>추천값(推荐值) — 쉼표로 구분, 설계 툴 드롭다운</label>
          <input className="pm-in mono" value={(v.recommends ?? []).join(', ')} onChange={(e) => set({ recommends: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="예: 300, 450, 600" /></div>
      )}

      {!exprOnly && !basic && (
        <div className="pm-grid2">
          <div className="pm-field"><label>숨김 조건(隐藏条件)</label><Fx title="숨김 조건" value={v.hidden ?? ''} onChange={(x) => set({ hidden: x })} placeholder="비우면 보임" preview={p(v.hidden).text} error={p(v.hidden).error} /></div>
          <div className="pm-field"><label>수정 가능(可修改)</label>
            <select className="pm-sel" value={v.editable === false ? 'false' : 'true'} onChange={(e) => set({ editable: e.target.value === 'true' })}><option value="true">예</option><option value="false">아니오 — 설계 툴에서 회색</option></select></div>
        </div>
      )}
      {basic && (
        <div className="pm-field"><label>숨김 조건(隐藏条件)</label><Fx title="숨김 조건" value={v.hidden ?? ''} onChange={(x) => set({ hidden: x })} placeholder="비우면 보임" /></div>
      )}

      {!exprOnly && (
        <details>
          <summary style={{ cursor: 'pointer', color: '#4b5563' }}>확장 속성 · 그룹 · 설명</summary>
          <div className="pm-grid2" style={{ marginTop: 10 }}>
            {EXT_ATTRS.filter((e) => e.type === 'boolean' || e.type === 'string' || (e.type === 'booleanbuf' && v.type === 'multiBoolean')).map((e) => (
              <div className="pm-field" key={e.key}><label title={e.tip}>{e.name}</label>
                {e.type === 'boolean'
                  ? <Fx title={e.name} value={v.ext?.[e.key] ?? ''} placeholder={e.tip} onChange={(x) => set({ ext: { ...(v.ext ?? {}), [e.key]: x } })} />
                  : <input className="pm-in" value={v.ext?.[e.key] ?? ''} placeholder={e.tip} onChange={(ev2) => set({ ext: { ...(v.ext ?? {}), [e.key]: ev2.target.value } })} />}
              </div>
            ))}
            {v.scope === 'custom' && <div className="pm-field"><label>사용자 그룹</label>
              <input className="pm-in" list="pm-groups" value={v.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })} placeholder="없음(기본)" />
              <datalist id="pm-groups">{model.groups.map((g) => <option key={g} value={g} />)}</datalist></div>}
            <div className="pm-field" style={{ gridColumn: '1 / -1' }}><label>설명</label><input className="pm-in" value={v.desc ?? ''} onChange={(e) => set({ desc: e.target.value })} /></div>
          </div>
        </details>
      )}
      {extra}
      {exprOnly && <div className="pm-field"><label>설명</label><input className="pm-in" value={v.desc ?? ''} onChange={(e) => set({ desc: e.target.value })} placeholder={v.scope === 'report' ? '예: 문짝 재질 이름 — 견적 조건에 사용' : ''} /></div>}

      {pickFor != null && (() => {
        const put = (id: string, name?: string) => {
          if (pickFor === 'value') set({ value: id });
          else set({ options: (v.options ?? []).map((o, k) => (k === pickFor ? { name: o.name || name || id, value: id } : o)) });
        };
        return v.type === 'style'
          ? <ModelPicker title="스타일(모델) 고르기" exclude={model.id} onClose={() => setPickFor(null)} onPick={(m) => put(m.id, m.name)} />
          : <ItemPicker title={v.type === 'material' ? '재질 고르기' : '윤곽 고르기'} items={items} value={v.value} allowColor={v.type === 'material'}
            libs={v.type === 'material' ? materialLibs(model.tooltype) : profileLibs(model.tooltype)} filter={v.type === 'profile' ? (i) => !!i.profile : undefined}
            onClose={() => setPickFor(null)} onPick={(id, it) => put(id, it?.name)} />;
      })()}
    </Modal>
  );
}

/* ───────────── 사용자 그룹 · 템플릿 · 전역 변수 가져오기 ───────────── */

function GroupDialog({ model, onSave, onClose }: { model: PmModel; onSave: (groups: string[], renames: Record<string, string>) => void; onClose: () => void }) {
  const [rows, setRows] = useState(model.groups.map((g) => ({ orig: g, name: g })));
  const renames = Object.fromEntries(rows.filter((r) => r.orig && r.orig !== r.name).map((r) => [r.orig, r.name.trim()]));
  for (const g of model.groups) if (!rows.some((r) => r.orig === g)) renames[g] = '';
  return (
    <Modal title="사용자 변수 그룹" sub="설계 툴 고급 변수의 묶음(customParamGroups)" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" onClick={() => onSave(rows.map((r) => r.name.trim()).filter((n, i, a) => n && a.indexOf(n) === i), renames)}>확인</button></>}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6 }}>
          <input className="pm-in" value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={`그룹 ${i + 1}`} />
          <button className="pm-btn xs" disabled={i === 0} onClick={() => { const n = [...rows]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setRows(n); }}>↑</button>
          <button className="pm-btn xs danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>삭제</button>
        </div>
      ))}
      <button className="pm-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { orig: '', name: `그룹 ${rows.length + 1}` }])}>＋ 그룹</button>
      <p className="pm-hint">그룹을 지우면 그 그룹의 변수는 기본(그룹 없음)으로 갑니다.</p>
    </Modal>
  );
}

function TemplateSave({ v, onClose, onDone }: { v: PmVar; onClose: () => void; onDone: (folder: string) => void }) {
  const [folders, setFolders] = useState(loadTemplates);
  const [sel, setSel] = useState(folders[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  return (
    <Modal title="변수 템플릿으로 저장" sub={`${v.label} (${v.name})`} onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" disabled={!sel} onClick={() => {
        const next = folders.map((f) => (f.id === sel ? { ...f, vars: [...f.vars.filter((x) => x.name !== v.name), { ...v, id: uid('t'), globalId: undefined }] } : f));
        saveTemplates(next);
        onDone(next.find((f) => f.id === sel)!.name);
      }}>확인</button></>}>
      <div className="pm-folder-list">
        {folders.map((f) => <button key={f.id} className={f.id === sel ? 'on' : ''} onClick={() => setSel(f.id)}><span className="pm-folder-ic" />{f.name}<small style={{ marginLeft: 'auto', color: '#7a8494' }}>{f.vars.length}</small></button>)}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="pm-in" placeholder="새 폴더 이름" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="pm-btn" disabled={!newName.trim()} onClick={() => { const f = { id: uid('tf'), name: newName.trim(), vars: [] }; const next = [...folders, f]; setFolders(next); saveTemplates(next); setSel(f.id); setNewName(''); }}>폴더 추가</button>
      </div>
    </Modal>
  );
}

/** 변수 템플릿 가져오기 — 폴더 선택 → 변수 체크 → 다음 → 참조명 바꾸기(선택) → 가져오기 (문서 3.1.3) */
function TemplateImport({ scope, model, onImport, onClose }: { scope: VarScope; model: PmModel; onImport: (vars: PmVar[]) => void; onClose: () => void }) {
  const [folders] = useState(loadTemplates);
  const [sel, setSel] = useState(folders[0]?.id ?? '');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<1 | 2>(1);
  const [names, setNames] = useState<Record<string, string>>({});
  const folder = folders.find((f) => f.id === sel);
  const picked = folders.flatMap((f) => f.vars).filter((v) => checked.has(v.id));
  const clash = (id: string, n: string) => !NAME_RE.test(n) || model.vars.some((x) => x.name === n) || picked.some((p) => p.id !== id && (names[p.id] ?? p.name) === n);
  return (
    <Modal title="변수 템플릿 가져오기" sub={SCOPE_TITLE[scope]} size="mid" onClose={onClose}
      footer={step === 1
        ? <><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" disabled={!checked.size} onClick={() => { setNames(Object.fromEntries(picked.map((v) => [v.id, v.name]))); setStep(2); }}>다음</button></>
        : <><button className="pm-btn" onClick={() => setStep(1)}>이전</button><button className="pm-primary" disabled={picked.some((v) => clash(v.id, names[v.id] ?? v.name))}
          onClick={() => onImport(picked.map((v) => ({ ...v, id: uid('v'), scope, name: names[v.id] ?? v.name })))}>가져오기</button></>}>
      {step === 1 ? (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, minHeight: 260 }}>
          <div className="pm-folder-list">{folders.map((f) => <button key={f.id} className={f.id === sel ? 'on' : ''} onClick={() => setSel(f.id)}><span className="pm-folder-ic" />{f.name}</button>)}</div>
          <div>
            {folder?.vars.map((v) => (
              <label key={v.id} className="pm-check" style={{ padding: '5px 0' }}>
                <input type="checkbox" checked={checked.has(v.id)} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(v.id); else n.delete(v.id); setChecked(n); }} />
                {v.label} <code style={{ color: '#7a8494' }}>{v.name}</code> <small style={{ color: '#7a8494' }}>{PARAM_TYPE_LABEL[v.type]} · {VALUE_TYPE_LABEL[v.valueType]}</small>
              </label>
            ))}
            {!folder?.vars.length && <p className="pm-empty">이 폴더에 템플릿이 없습니다. 변수에서 오른쪽 클릭 › ‘템플릿으로 저장’.</p>}
          </div>
        </div>
      ) : (
        <table className="pm-table"><thead><tr><th>이름</th><th>원래 참조명</th><th>가져올 참조명</th></tr></thead><tbody>
          {picked.map((v) => { const n = names[v.id] ?? v.name; return (
            <tr key={v.id}><td>{v.label}</td><td><code>{v.name}</code></td><td>
              <input className="pm-in mono" value={n} onChange={(e) => setNames({ ...names, [v.id]: e.target.value })} aria-label={`${v.label} 참조명`} />
              {clash(v.id, n) && <span className="err" style={{ color: '#c4402f', fontSize: 11 }}>사용 중이거나 형식이 맞지 않습니다</span>}
            </td></tr>); })}
        </tbody></table>
      )}
    </Modal>
  );
}

/** 전역 변수 가져오기 — 모델에서 전역 변수를 불러 쓰기(문서 3.1.10 ‘建模调用’). 연결된 변수는 정의를 전역에서 받는다 */
function GlobalImport({ model, onImport, onClose }: { model: PmModel; onImport: (vars: PmVar[]) => void; onClose: () => void }) {
  const [globals] = useState(loadGlobals);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const usable = globals.filter((g) => !model.vars.some((v) => v.globalId === g.id || v.name === g.name));
  return (
    <Modal title="전역 변수 가져오기" sub="변수&속성 › 전역 변수에서 만든 변수를 이 모델에서 씁니다" size="mid" onClose={onClose}
      footer={<><button className="pm-btn" onClick={onClose}>취소</button><button className="pm-primary" disabled={!checked.size}
        onClick={() => onImport(usable.filter((g) => checked.has(g.id)).map((g) => ({ ...g, id: uid('v'), scope: 'custom', globalId: g.id })))}>가져오기</button></>}>
      {usable.map((g) => (
        <label key={g.id} className="pm-check" style={{ padding: '5px 0' }}>
          <input type="checkbox" checked={checked.has(g.id)} onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(g.id); else n.delete(g.id); setChecked(n); }} />
          {g.label} <code style={{ color: '#7a8494' }}>{g.name}</code> <small style={{ color: '#7a8494' }}>{PARAM_TYPE_LABEL[g.type]} · {VALUE_TYPE_LABEL[g.valueType]} · {g.hideMode === 'local' ? '숨김 로컬 설정' : '숨김 통일 제어'}</small>
        </label>
      ))}
      {!usable.length && <p className="pm-empty">가져올 전역 변수가 없습니다. 변수&속성 › 전역 변수에서 만드세요.</p>}
    </Modal>
  );
}

export function ShowHiddenToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <div className="pm-left-foot"><Switch on={on} onChange={onChange} label="숨김 변수 위치 표시" />숨김 변수 위치 표시</div>;
}
