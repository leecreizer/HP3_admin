import { useState } from 'react';
import type { Item } from '../../data/contentLibrary';
import { DEFS, PANEL_GROUPS, elementBizProps, elementDef, type DefTree, type ElementDef, type ParamDef } from '../../pm/defs';
import { fmt, renameRef } from '../../pm/expr';
import { materialLibs, profileLibs } from '../../pm/catalog';
import type { PmArray, PmModel, PmNode } from '../../pm/types';
import { ItemPicker, ModelPicker } from './pickers';
import { SectionDraw } from './SectionDraw';
import { Fx, Sec, Unverified } from './ui';
import { previewOf, usePm } from './ctx';

export type PathEditReq = { nodeId: string; param: string; kind: 'plank' | 'line'; closed: boolean; title: string };

const PATH_TYPES: Record<string, PathEditReq['kind']> = { plankpath: 'plank', plankmodelprofile: 'line', loftpath: 'line', auxiliaryLinePath: 'line', auxiliaryPlanePath: 'line', connectFacePath: 'line' };
const CLOSED_PATH = new Set(['plankpath', 'plankmodelprofile', 'auxiliaryPlanePath', 'connectFacePath']);
const AXIS = ['x', 'y', 'z'] as const;

/** 정의 변수 한 칸 — 값 형식별 입력 */
function ParamField({ node, pd, onChange, onEditPath, items, tool, childVars }: {
  node: PmNode; pd: ParamDef; onChange: (v: string) => void; onEditPath: (r: PathEditReq) => void; items: Item[]; tool: PmModel['tooltype'];
  childVars?: { name: string; label: string }[];
}) {
  const { ev, model, addProfile } = usePm();
  const [pick, setPick] = useState(false);
  const [draw, setDraw] = useState(false);
  const raw = node.params[pd.name] ?? pd.value ?? '';
  const value = raw === 'None' ? '' : raw;
  const label = pd.label;
  const pv = previewOf(ev, value);
  const unit = pd.format === 5 ? '°' : undefined;

  const optSelect = (opts: { name: string; value: string }[], allowFormula = true) => {
    const isOpt = value === '' || opts.some((o) => o.value === value);
    return isOpt ? (
      <select className="pm-sel" value={value} aria-label={label} onChange={(e) => onChange(e.target.value === '__fx' ? '#' : e.target.value)}>
        {!opts.some((o) => o.value === '') && value === '' && <option value="">미선택</option>}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
        {allowFormula && <option value="__fx">수식…</option>}
      </select>
    ) : (
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Fx title={label} value={value} onChange={onChange} preview={pv.text} error={pv.error} /></div>
        <button className="pm-btn xs" title="선택지로" onClick={() => onChange(opts[0]?.value ?? '')}>선택</button>
      </div>
    );
  };

  switch (pd.type) {
    case 'float': case 'int':
      if (pd.options?.length) return optSelect(pd.options);
      return <Fx title={label} value={value} onChange={onChange} unit={unit} preview={pv.text} error={pv.error} />;
    case 'string':
      if (pd.options?.length) return optSelect(pd.options);
      return <Fx title={label} value={value} onChange={onChange} preview={pv.text} error={pv.error} />;
    case 'boolean':
      return optSelect([{ name: '예', value: 'true' }, { name: '아니오', value: 'false' }]);
    case 'positive':
      return optSelect([{ name: '양(+) 방향', value: 'true' }, { name: '음(−) 방향', value: 'false' }], false);
    case 'numberparamname':
      return optSelect(model.vars.filter((v) => v.type === 'float' || v.type === 'int').map((v) => ({ name: `${v.label} (${v.name})`, value: v.name })), false);
    case 'material': {
      const ref = /^[#@(]/.test(value.trim()) || value.trim() === '';
      const name = !ref && value ? ev.nameOf(value) : '';
      return (
        <>
          <div className="pm-row2">
            <select className="pm-sel" value={ref ? 'ref' : 'pick'} aria-label={`${label} 방식`} onChange={(e) => (e.target.value === 'ref' ? onChange('#CZ') : setPick(true))}>
              <option value="ref">참조</option><option value="pick">선택</option>
            </select>
            {ref ? <div><Fx title={label} value={value} onChange={onChange} preview={pv.text} error={pv.error} /></div>
              : <button className="pm-btn" onClick={() => setPick(true)} title={value}>{String(name || value)}</button>}
          </div>
          {pick && <ItemPicker title={`${label} 고르기`} items={items} libs={materialLibs(tool)} value={value} allowColor onClose={() => setPick(false)} onPick={(id) => onChange(id)} />}
        </>
      );
    }
    case 'float3': case 'float2': {
      let o: Record<string, string> = {};
      try { o = value ? JSON.parse(value) : {}; } catch { /* 깨진 값 */ }
      const axes = pd.type === 'float2' ? AXIS.slice(0, 2) : AXIS;
      if (pd.options?.length) return optSelect(pd.options, false);
      return (
        <>
          {axes.map((a) => {
            const p = previewOf(ev, o[a]);
            return (
              <div key={a} className="pm-field">
                <span className="lbl">{label}<b className={`ax ax-${a}`}>{a.toUpperCase()}</b></span>
                <Fx title={`${label} ${a.toUpperCase()}`} value={o[a] ?? ''} unit={unit} onChange={(x) => onChange(JSON.stringify({ ...Object.fromEntries(axes.map((k) => [k, o[k] ?? '0'])), [a]: x }))} preview={p.text} error={p.error} />
              </div>
            );
          })}
        </>
      );
    }
    case 'shape': {
      const ref = /^[#@(]/.test(value.trim());
      const prof = !ref ? ev.opts.catalog?.profile?.(value) : undefined;
      return (
        <>
          <div className="pm-row2">
            <select className="pm-sel" value={ref ? 'ref' : 'pick'} aria-label={`${label} 방식`} onChange={(e) => (e.target.value === 'ref' ? onChange('#') : setPick(true))}>
              <option value="pick">선택</option><option value="ref">윤곽 변수</option>
            </select>
            {ref ? <div><Fx title={label} value={value} onChange={onChange} preview={pv.text} error={pv.error} /></div>
              : <div className="pm-shape-pick">
                <button className="pm-btn" onClick={() => setPick(true)} title={value}>{prof?.name ?? (value ? '쿠지알러 기본 단면' : '고르기')}</button>
                {addProfile && <button className="pm-btn" title={prof ? '단면 그리기 — 이 단면에서 시작해 고친 뒤 새 몰딩 단면으로' : '단면 그리기 — CAD 없이 단면을 그려 바로 씁니다'} aria-label={`${label} 단면 그리기`} onClick={() => setDraw(true)}>✎</button>}
              </div>}
          </div>
          {!ref && !prof && <span className="pm-hint">쿠지알러 기본 단면은 형상 데이터를 받을 수 없어 18×18 사각형으로 그립니다. 컨텐츠 라이브러리 몰딩(DXF 단면)을 고르거나{addProfile ? ' ✎ 로 단면을 그리세요.' : ' 컨텐츠 라이브러리에서 에디터를 열면 단면을 그릴 수 있습니다.'}</span>}
          {pick && <ItemPicker title="단면(몰딩) 고르기" items={items} libs={profileLibs(tool)} filter={(i) => !!i.profile} value={value} onClose={() => setPick(false)} onPick={(id) => onChange(id)} />}
          {draw && addProfile && (() => {
            const cur = items.find((i) => i.id === value)?.profile;
            return <SectionDraw init={cur ? { path: cur.path, points: cur.points } : undefined} onClose={() => setDraw(false)}
              onDone={(name, shape) => { const id = addProfile(name, shape); setDraw(false); if (id) onChange(id); }} />;
          })()}
        </>
      );
    }
    case 'businessType': {
      const flat: { name: string; value: string }[] = [];
      const walk = (l: DefTree[], path: string[]) => l.forEach((t) => { const p = [...path, t.name]; flat.push({ name: p.join(' › '), value: t.value }); if (t.children) walk(t.children, p); });
      walk(pd.btOptions ?? [], []);
      let arr: string[];
      try { const j = JSON.parse(value || '[]'); arr = Array.isArray(j) ? j.map(String) : [String(j)]; } catch { arr = value ? [value] : []; }
      const cur = arr[arr.length - 1] ?? (value && !value.startsWith('[') ? value : '');
      return (
        <select className="pm-sel" value={cur} aria-label={label} onChange={(e) => onChange(value.trim().startsWith('[') || !value ? JSON.stringify(e.target.value ? [e.target.value] : []) : e.target.value)}>
          <option value="">미선택</option>
          {flat.map((o, i) => <option key={`${o.value}-${i}`} value={o.value}>{o.name}</option>)}
        </select>
      );
    }
    case 'instanceOverride': {
      let j: { notOverridableParams?: string[] } = {};
      try { j = JSON.parse(value || '{}'); } catch { /* 기본 */ }
      const locked = new Set(j.notOverridableParams ?? []);
      const list = childVars ?? model.vars.filter((v) => v.scope === 'custom').map((v) => ({ name: v.name, label: v.label }));
      if (!list.length) return <span className="pm-hint">사용자 정의 변수가 없습니다</span>;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {list.map((v) => (
            <label key={v.name} className="pm-check"><input type="checkbox" checked={!locked.has(v.name)} onChange={(e) => {
              const n = new Set(locked); if (e.target.checked) n.delete(v.name); else n.add(v.name);
              onChange(JSON.stringify({ ...j, notOverridableParams: [...n] }));
            }} />{v.label} <code style={{ color: '#7a8494' }}>{v.name}</code></label>
          ))}
          <span className="pm-hint">체크 해제 = 부모 모델·설계 툴에서 수정할 수 없음(notOverridableParams)</span>
        </div>
      );
    }
    default:
      if (PATH_TYPES[pd.type]) {
        const kind = PATH_TYPES[pd.type];
        const isProfile = kind === 'plank' || pd.type === 'plankmodelprofile' || pd.type === 'auxiliaryPlanePath';
        return (
          <button className="pm-shape-btn" onClick={() => onEditPath({ nodeId: node.id, param: pd.name, kind, closed: CLOSED_PATH.has(pd.type), title: isProfile ? '윤곽 편집' : '경로 편집' })}>
            ⌗ {isProfile ? '윤곽 편집' : '경로 편집'}
          </button>
        );
      }
      return (
        <>
          <input className="pm-in mono" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
          <span className="pm-hint">값 형식 ‘{pd.type}’ — 쿠지알러 입력 화면 미확인, 저장 문자열 그대로 편집<Unverified /></span>
        </>
      );
  }
}

/** 업무 속성 한 줄 (요소·모델 공용) — 선택지 + 사용자 규칙(수식) */
export function BizField({ biz, value, onChange }: { biz: (typeof DEFS.bizProps)[number]; value: string | undefined; onChange: (v: string) => void }) {
  const v = value ?? biz.def ?? '';
  const opts = biz.options.filter((o) => o.name !== '');
  const isOpt = opts.some((o) => o.value === v);
  if (!opts.length) return <Fx title={biz.name} value={v} onChange={onChange} />;
  return (
    <div className="pm-radio-col">
      {opts.map((o) => <label key={o.value} className="pm-radio"><input type="radio" name={`biz-${biz.key}`} checked={v === o.value} onChange={() => onChange(o.value)} />{o.name}</label>)}
      {biz.formula && biz.formulaName && (
        <>
          <label className="pm-radio"><input type="radio" name={`biz-${biz.key}`} checked={!isOpt && v !== ''} onChange={() => onChange(isOpt ? '#' : v)} />{biz.formulaName}</label>
          {!isOpt && v !== '' && <Fx title={`${biz.name} ${biz.formulaName}`} value={v} onChange={onChange} />}
        </>
      )}
    </div>
  );
}

/** 오른쪽 속성 패널 — 선택 없음 = 모델 속성, 외곽 틀, 요소·보조 구조·하위 모델 */
export function PropPanel({ sel, update, items, onEditPath, onChangeType, onCapture, onBiz, onQuote }: {
  sel: string | null;
  update: (fn: (m: PmModel) => PmModel, label?: string) => void;
  items: Item[];
  onEditPath: (r: PathEditReq) => void;
  onChangeType: () => void;
  onCapture: (kind: 'preview' | 'mark') => void;
  onBiz: () => void;
  onQuote: () => void;
}) {
  const { model, ev } = usePm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);

  if (!sel) return <ModelProps update={update} onChangeType={onChangeType} onCapture={onCapture} onBiz={onBiz} onQuote={onQuote} />;

  if (sel === '__frame') {
    return (
      <div className="pm-right">
        <div className="head"><span>모델 외곽 틀</span></div>
        {PANEL_GROUPS.map((g) => {
          const ps = DEFS.frame.params.filter((p) => p.group === g.id && p.visible);
          if (!ps.length) return null;
          return <Sec key={g.id} title={g.label}>{ps.map((pd) => (
            <div key={pd.name} className="pm-field">{pd.type !== 'float3' && <span className="lbl">{pd.label}</span>}
              <ParamField node={{ id: '__frame', def: DEFS.frame.id, name: '외곽 틀', params: model.frame }} pd={pd} tool={model.tooltype} items={items} onEditPath={onEditPath}
                onChange={(v) => update((m) => ({ ...m, frame: { ...m.frame, [pd.name]: v } }), '외곽 틀 수정')} />
            </div>))}</Sec>;
        })}
      </div>
    );
  }

  const node = model.nodes.find((n) => n.id === sel);
  if (!node) return <div className="pm-right"><p className="pm-empty">선택한 항목이 없습니다</p></div>;
  const def = elementDef(node.def) as ElementDef;
  const setParam = (k: string, v: string) => update((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === node.id ? { ...n, params: { ...n.params, [k]: v } } : n)) }), `${node.name} 수정`);
  const setNode = (p: Partial<PmNode>, label: string) => update((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === node.id ? { ...n, ...p } : n)) }), label);
  const child = node.sub?.kind === 'param' ? ev.child(node) : null;
  const childCustom = child?.model.vars.filter((v) => v.scope === 'custom') ?? [];
  const refErr = node.refName && !/^[A-Za-z][A-Za-z0-9_]*$/.test(node.refName) ? '영문자로 시작, 영문·숫자만' : node.refName && model.nodes.some((n) => n.id !== node.id && n.refName === node.refName) ? '이미 있는 참조명' : null;
  const bizList = elementBizProps(def);

  const field = (pd: ParamDef) => (
    <div key={pd.name} className="pm-field">
      {pd.type !== 'float3' && pd.type !== 'float2' && <span className="lbl" title={pd.zh}>{pd.label}</span>}
      <ParamField node={node} pd={pd} onChange={(v) => setParam(pd.name, v)} onEditPath={onEditPath} items={items} tool={model.tooltype}
        childVars={pd.type === 'instanceOverride' && child ? childCustom.map((v) => ({ name: v.name, label: v.label })) : undefined} />
    </div>
  );
  const childVarField = (name: string, label: string) => {
    const r = child?.varEval(name);
    const cur = node.params[name] ?? '';
    const pv = previewOf(ev, cur);
    return (
      <div key={name} className="pm-field">
        <span className="lbl">{label} <code style={{ color: '#9aa2ad' }}>{name}</code></span>
        <Fx title={label} value={cur} placeholder={`하위 모델 값 ${fmt(r?.value)}`} onChange={(v) => setParam(name, v)} preview={pv.text} error={pv.error} />
      </div>
    );
  };

  return (
    <div className="pm-right">
      <div className="head">
        {renaming != null
          ? <input value={renaming} autoFocus aria-label="이름" onChange={(e) => setRenaming(e.target.value)} onBlur={() => { if (renaming.trim()) setNode({ name: renaming.trim() }, '이름 바꾸기'); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          : <span title={node.name}>{node.name}</span>}
        <button className="pm-icon" title="이름 바꾸기" aria-label="이름 바꾸기" onClick={() => setRenaming(node.name)}>✎</button>
      </div>
      <div style={{ padding: '8px 12px 2px' }} className="pm-field">
        <span className="lbl">참조명(引用名) — 다른 수식에서 @참조명.변수</span>
        <input className="pm-in mono" value={node.refName ?? ''} placeholder="예: MB" onChange={(e) => {
          const nv = e.target.value.trim() || undefined;
          update((m) => ({ ...m, nodes: m.nodes.map((n) => {
            if (n.id === node.id) return { ...n, refName: nv };
            if (!node.refName || !nv) return n;
            return { ...n, params: Object.fromEntries(Object.entries(n.params).map(([k, s]) => [k, renameRef(s, node.refName!, nv)])) };
          }), vars: node.refName && nv ? m.vars.map((v) => ({ ...v, formula: v.formula ? renameRef(v.formula, node.refName!, nv) : v.formula })) : m.vars }), '참조명');
        }} />
        {refErr && <span className="err">{refErr}</span>}
      </div>
      {node.sub && (
        <Sec title={node.sub.kind === 'param' ? '하위 모델' : '3D 모델 (메시 부품)'}>
          <div className="pm-prop-line"><span>원본</span><b>{node.sub.name}</b></div>
          {node.sub.kind === 'param' && <>
            <div className="pm-field"><span className="lbl">스타일 변수 — 이 부품을 바꿀 스타일 변수(#CM 등)</span>
              <Fx title="스타일 변수" value={node.params.paramStyle ?? ''} placeholder="비우면 원본 모델" onChange={(v) => setParam('paramStyle', v)} /></div>
            <button className="pm-btn xs" onClick={() => setSwap(true)}>교체 (C)</button>
          </>}
        </Sec>
      )}
      {PANEL_GROUPS.map((g) => {
        let ps = def.params.filter((p) => p.group === g.id && p.visible);
        if (node.sub?.kind === 'mesh') ps = ps.filter((p) => !['modelPackage', 'instanceOverride'].includes(p.name));
        const extra = g.id === 0 && child ? childCustom.filter((v) => v.type !== 'material') : g.id === 2 && child ? childCustom.filter((v) => v.type === 'material') : [];
        if (!ps.length && !extra.length) return null;
        return (
          <Sec key={g.id} title={g.label}>
            {ps.map(field)}
            {extra.length > 0 && <div className="pm-sub-h">하위 모델 변수</div>}
            {extra.map((v) => childVarField(v.name, v.label))}
          </Sec>
        );
      })}
      {bizList.length > 0 && (
        <Sec title="업무 속성" defaultOpen={false}>
          {bizList.map((b) => (
            <div key={b.key} className="pm-field"><span className="lbl" title={b.zh}>{b.name}</span>
              <BizField biz={b} value={node.biz?.[b.key]} onChange={(v) => setNode({ biz: { ...(node.biz ?? {}), [b.key]: v } }, '업무 속성')} /></div>
          ))}
        </Sec>
      )}
      {node.array && <ArraySec array={node.array} onChange={(a) => setNode({ array: a }, '배열')} />}
      {swap && <ModelPicker title={`${node.name} 교체 — 모델 고르기`} exclude={model.id} tool={model.tooltype} onClose={() => setSwap(false)} onPick={(m) => setNode({ sub: { kind: 'param', id: m.id, name: m.name } }, '부품 교체')} />}
    </div>
  );
}

export function ArraySec({ array, onChange }: { array: PmArray; onChange: (a: PmArray | undefined) => void }) {
  const { ev } = usePm();
  return (
    <Sec title="배열 (阵列)">
      <div className="pm-field"><span className="lbl">배열 방향 — 축과 부호(실선 방향이 +)</span>
        <select className="pm-sel" value={array.dir} onChange={(e) => onChange({ ...array, dir: e.target.value as PmArray['dir'] })}>
          {(['x+', 'x-', 'y+', 'y-', 'z+', 'z-'] as const).map((d) => <option key={d} value={d}>{d.toUpperCase()}</option>)}
        </select></div>
      <div className="pm-field"><span className="lbl">배열 길이 — 배열 범위</span><Fx title="배열 길이" value={array.length} onChange={(v) => onChange({ ...array, length: v })} preview={previewOf(ev, array.length).text} /></div>
      <div className="pm-field"><span className="lbl">배열 방식</span>
        <select className="pm-sel" value={array.mode} onChange={(e) => onChange({ ...array, mode: e.target.value as PmArray['mode'] })}><option value="step">간격 — 개수는 길이에 따라</option><option value="count">개수 — 간격은 길이에 따라</option></select></div>
      <div className="pm-field"><span className="lbl">{array.mode === 'step' ? '간격' : '개수'}</span><Fx title={array.mode === 'step' ? '간격' : '개수'} value={array.value} onChange={(v) => onChange({ ...array, value: v })} preview={previewOf(ev, array.value).text} /></div>
      <button className="pm-btn xs danger" onClick={() => onChange(undefined)}>배열 해제 (Ctrl+Shift+A)</button>
    </Sec>
  );
}

/** 모델 속성(선택 없음) — 상품 · 이미지 설정 · 부품 속성(기본) · 프론트 사용 속성 */
function ModelProps({ update, onChangeType, onCapture, onBiz, onQuote }: { update: (fn: (m: PmModel) => PmModel, label?: string) => void; onChangeType: () => void; onCapture: (k: 'preview' | 'mark') => void; onBiz: () => void; onQuote: () => void }) {
  const { model } = usePm();
  const setProp = (k: string, v: string) => update((m) => ({ ...m, props: { ...m.props, [k]: v } }), '모델 속성');
  const node: PmNode = { id: '__model', def: DEFS.model.id, name: model.name, params: model.props };
  const tri = (pd: ParamDef) => {
    const v = model.props[pd.name] ?? '';
    if (pd.type === 'boolean') return (
      <select className="pm-sel" value={v === 'true' || v === 'false' ? v : ''} aria-label={pd.label} onChange={(e) => setProp(pd.name, e.target.value)}>
        <option value="">미선택</option><option value="true">예</option><option value="false">아니오</option>
      </select>
    );
    return null;
  };
  return (
    <div className="pm-right">
      <div className="head"><span title={model.name}>{model.name}</span></div>
      <Sec title="상품">
        <div className="pm-field"><span className="lbl">모델 이름</span><input className="pm-in" value={model.name} onChange={(e) => update((m) => ({ ...m, name: e.target.value }), '모델 이름')} /></div>
        <div className="pm-prop-line"><span>입고 버전</span><b>{model.version || '입고 전'}</b></div>
      </Sec>
      <Sec title="이미지 설정">
        <div className="pm-field"><span className="lbl">미리보기 이미지</span>
          <div className="pm-imgbox">{model.preview ? <img src={model.preview} alt="미리보기" /> : <button className="pm-btn" onClick={() => onCapture('preview')}>만들기</button>}</div>
          {model.preview && <button className="pm-btn xs" onClick={() => onCapture('preview')}>다시 만들기</button>}</div>
        <div className="pm-field"><span className="lbl">표기도</span>
          <div className="pm-imgbox">{model.markImage ? <img src={model.markImage} alt="표기도" /> : <button className="pm-btn" onClick={() => onCapture('mark')}>만들기</button>}</div>
          {model.markImage && <button className="pm-btn xs" onClick={() => onCapture('mark')}>다시 만들기</button>}</div>
      </Sec>
      <Sec title="부품 속성">
        <div className="pm-sub-h">기본 속성</div>
        <div className="pm-prop-line"><span>소속 라이브러리</span><b>{model.library || '-'}</b></div>
        <div className="pm-prop-line"><span>모델 유형</span><span style={{ display: 'flex', gap: 6 }}><b>{model.category || '-'}</b><button className="pm-link" onClick={onChangeType}>변경</button></span></div>
        {DEFS.model.params.filter((p) => p.group === 2 && p.visible).map((pd) => (
          <div key={pd.name} className="pm-field"><span className="lbl">{pd.label}</span>
            <select className="pm-sel" value={model.props[pd.name] ?? ''} aria-label={pd.label} onChange={(e) => setProp(pd.name, e.target.value)}>
              <option value="">미선택</option>{pd.options?.map((o) => <option key={o.value} value={o.value}>{o.name}</option>)}
            </select></div>
        ))}
      </Sec>
      <Sec title="프론트 사용 속성">
        <div className="pm-field"><span className="lbl">모델 교체 시 상속 속성 <Unverified /></span><button className="pm-btn" disabled title="쿠지알러 선택 창 미확인">선택</button></div>
        {DEFS.model.params.filter((p) => p.group === 4 && p.visible).map((pd) => (
          <div key={pd.name} className="pm-field"><span className="lbl" title={pd.zh}>{pd.label}</span>
            {tri(pd) ?? (pd.type === 'textureremap'
              ? <><input className="pm-in mono" value={model.props[pd.name] ?? '{}'} onChange={(e) => setProp(pd.name, e.target.value)} /><span className="pm-hint">텍스처 통일 설정 창 미확인 — 저장 문자열 그대로<Unverified /></span></>
              : <ParamField node={node} pd={pd} onChange={(v) => setProp(pd.name, v)} onEditPath={() => undefined} items={[]} tool={model.tooltype} />)}
          </div>
        ))}
      </Sec>
      <Sec title="모델 설정">
        <button className="pm-btn block" onClick={onBiz}>업무 속성…</button>
        <button className="pm-btn block" onClick={onQuote}>견적 설정… (Alt+B)</button>
      </Sec>
    </div>
  );
}
