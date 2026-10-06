import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadContentState, type ContentState, type Item } from '../../data/contentLibrary';
import { TOOLTYPE_LABEL } from '../../pm/modelTypes';
import { makeCatalog, allItems } from '../../pm/catalog';
import { DEFS, INSERT_KEYS, defaultParams, elementDef, toolElements, type ElementDef } from '../../pm/defs';
import { fmt } from '../../pm/expr';
import { buildModel } from '../../pm/geometry';
import { exportGlb } from '../../pm/glb';
import type { ModelOpenRequest, ModelResult } from '../../pm/link';
import { registerToLibrary } from '../../pm/register';
import { PmEval, uid } from '../../pm/resolve';
import { loadModel, newModel, saveModel, withVersion } from '../../pm/store';
import type { PmModel, PmNode, PmVersion } from '../../pm/types';
import { GlobalVarsPage, SettingsPage } from './AdminPages';
import { ArrayDialog, BizDialog, DiagPanel, EnvDialog, FamilyPanel, NodeReportDialog, OutputDialog, QuoteDialog, RefsDialog, ShortcutsDialog, VersionsDialog } from './Dialogs';
import { FormulaDialog } from './FormulaDialog';
import { ElementLib, PartLib } from './LibPanels';
import { ModelPicker } from './pickers';
import { PmModelDialog, type ModelTypePick } from './PmModelDialog';
import { PmViewport } from './PmViewport';
import { SHADE_LABEL, VIEW_LABEL, type ShadeMode, type ViewMode } from './viewMeta';
import { ProfileEditor } from './ProfileEditor';
import { PropPanel, type PathEditReq } from './PropPanel';
import { StructureNav, type NavAction } from './StructureNav';
import { Confirm, Modal } from './ui';
import { PmCtx, UNV, type PmCtxValue } from './ctx';
import { ShowHiddenToggle, VarPanel } from './VarPanel';
import './pm.css';

type MenuItem = { label: string; key?: string; onClick?: () => void; disabled?: boolean; unv?: boolean; sep?: boolean };

function Menu({ label, icon, items }: { label: string; icon: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="pm-menu" ref={ref}>
      <button className={`pm-tool ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"><i aria-hidden="true">{icon}</i>{label}<span className="caret" aria-hidden="true">▾</span></button>
      {open && (
        <div className="pm-pop" role="menu">
          {items.map((it, i) => it.sep ? <hr key={`s${i}`} /> : (
            <button key={it.label} role="menuitem" disabled={it.disabled || it.unv} title={it.unv ? UNV : undefined} onClick={() => { setOpen(false); it.onClick?.(); }}>
              <span>{it.label}{it.unv && <small> (미확인)</small>}</span>{it.key && <kbd>{it.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 캡처 이미지를 저장용으로 줄이기 (긴 변 480px JPEG) — localStorage 용량 */
function shrinkImage(url: string, max = 480): Promise<string> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      if (!g) { res(url); return; }
      g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => res(url);
    img.src = url;
  });
}

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};


/**
 * 파라메트릭 모델 에디터 — 쿠지알러 参数化模型编辑器를 참고해 홈플래너3 어드민에 새로 만든 에디터(기존 에디터를 대체).
 *  상단: 실행 취소 · 다시 실행 · 비우기 | 변수&속성 · 도구 · 조작 · 검증 · 플러그인 | 변수 위치 검색 | 새 기능 · 도움말 · 파일 · 설정
 *  왼쪽: 파라미터 설정 · 요소 라이브러리 · 부품 라이브러리   가운데: 3D/2D · 구조 탐색 · 모델 진단   오른쪽: 속성
 */
export function PmEditor({ request, userName = 'HP3 관리자', onClose, onRegister }: {
  request?: ModelOpenRequest;
  userName?: string;
  onClose?: () => void;
  /** 컨텐츠 라이브러리에서 연 경우 — ‘저장 후 입고’ 결과를 그 화면이 반영 (없으면 저장본에 직접 입고) */
  onRegister?: (r: ModelResult) => void | Promise<void>;
}) {
  const [hist, setHist] = useState<{ list: PmModel[]; labels: string[]; i: number } | null>(() => {
    if (request?.mode === 'edit') { const m = loadModel(request.id); if (m) return { list: [m], labels: ['열기'], i: 0 }; }
    return null;
  });
  const model = hist ? hist.list[hist.i] : null;
  const [saved, setSaved] = useState<PmModel | null>(model);
  const [typeDlg, setTypeDlg] = useState<{ tab: 'new' | 'open'; change?: boolean } | null>(() => (model ? null : { tab: 'new' }));
  const [content, setContent] = useState<ContentState | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [focusVar, setFocusVar] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'param' | 'element' | 'part'>('param');
  const [leftOpen, setLeftOpen] = useState(true);
  const [view, setView] = useState<ViewMode>('3d');
  const [shade, setShade] = useState<ShadeMode>('mat');
  const [showHidden, setShowHidden] = useState(false);
  const [showAux, setShowAux] = useState(true);
  const [explode, setExplode] = useState(0);
  const [fit, setFit] = useState(0);
  const [navOpen, setNavOpen] = useState(true);
  const [diagOpen, setDiagOpen] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [locateHidden, setLocateHidden] = useState(false);
  const [dlg, setDlg] = useState<null | 'biz' | 'quote' | 'output' | 'report' | 'env' | 'versions' | 'keys' | 'refs' | 'saveAs'>(null);
  const [admin, setAdmin] = useState<null | 'globals' | 'settings'>(null);
  const [formula, setFormula] = useState<{ title: string; value: string; onSave: (v: string) => void; hint?: string } | null>(null);
  const [pathEdit, setPathEdit] = useState<PathEditReq | null>(null);
  const [arrayFor, setArrayFor] = useState<PmNode | null>(null);
  const [replaceFor, setReplaceFor] = useState<PmNode | null>(null);
  const [confirm, setConfirm] = useState<{ text: ReactNode; ok: string; danger?: boolean; run: () => void } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(() => (request?.mode === 'edit' && !loadModel(request.id) ? '편집할 모델을 찾을 수 없습니다 — 새로 만들거나 열기에서 고르세요' : null));
  const [busy, setBusy] = useState('');
  const [verDesc, setVerDesc] = useState('');
  const [search, setSearch] = useState('');
  const [saveAsName, setSaveAsName] = useState('');
  const capture = useRef<(() => string) | null>(null);

  useEffect(() => { let on = true; loadContentState().then((s) => { if (on) setContent(s); }).catch(() => undefined); return () => { on = false; }; }, []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToastMsg(null), 3200); return () => clearTimeout(t); }, [toastMsg]);

  const items: Item[] = useMemo(() => allItems(content), [content]);
  // 하위 모델은 저장본을 읽으므로, 저장할 때마다 다시 만든다
  const [catalogSeq, setCatalogSeq] = useState(0);
  const catalog = useMemo(() => { void catalogSeq; return makeCatalog(content); }, [content, catalogSeq]);
  const ev = useMemo(() => (model ? new PmEval(model, { catalog }) : null), [model, catalog]);
  const built = useMemo(() => (ev ? buildModel(ev, { profile: (id) => catalog.profile?.(id), product: (id) => catalog.product?.(id) }) : null), [ev, catalog]);
  const dirty = !!model && model !== saved;

  const update = useCallback((fn: (m: PmModel) => PmModel, label = '편집') => {
    setHist((h) => {
      if (!h) return h;
      const next = fn(h.list[h.i]);
      if (next === h.list[h.i]) return h;
      return { list: [...h.list.slice(0, h.i + 1), next].slice(-120), labels: [...h.labels.slice(0, h.i + 1), label].slice(-120), i: Math.min(h.i + 1, 119) };
    });
  }, []);
  const undo = () => setHist((h) => (h && h.i > 0 ? { ...h, i: h.i - 1 } : h));
  const redo = () => setHist((h) => (h && h.i < h.list.length - 1 ? { ...h, i: h.i + 1 } : h));
  const openModel = (m: PmModel) => { setHist({ list: [m], labels: ['열기'], i: 0 }); setSaved(m); setSel(null); setFit((f) => f + 1); setTypeDlg(null); setLeftTab('param'); };

  /* ── 모델 유형 선택 ── */
  const applyType = (p: ModelTypePick) => {
    if (typeDlg?.change && model) {
      update((m) => ({ ...m, tooltype: p.tooltype, lib: p.lib, library: p.library, categoryId: p.categoryId, category: p.category }), '모델 유형 변경');
      setToastMsg(`모델 유형을 ${p.library} › ${p.category}(으)로 바꿨습니다`);
      setTypeDlg(null);
      return;
    }
    const m = newModel({ tooltype: p.tooltype, lib: p.lib, library: p.library, categoryId: p.categoryId, category: p.category, name: `새 ${p.category}` });
    openModel(m);
    setSaved(null);
    setLeftTab('element');
  };

  /* ── 노드 ── */
  const nextName = (base: string) => {
    if (!model) return base;
    let n = 1;
    while (model.nodes.some((x) => x.name === `${base}-${n}`)) n++;
    return `${base}-${n}`;
  };
  const insertElement = (d: ElementDef) => {
    if (!model) return;
    const node: PmNode = { id: uid('n'), def: d.id, name: nextName(d.name), params: defaultParams(d, model.tooltype) };
    update((m) => ({ ...m, nodes: [...m.nodes, node] }), `${d.name} 넣기`);
    setSel(node.id);
  };
  const insertModel = (pm: PmModel) => {
    if (!model) return;
    const child = new PmEval(pm, { catalog });
    const val = (n: string) => fmt(child.varTyped(n)) || '0';
    const node: PmNode = { id: uid('n'), def: 'instance', name: nextName(pm.name), sub: { kind: 'param', id: pm.id, name: pm.name },
      params: { ...defaultParams(DEFS.instance), W: val('W'), D: val('D'), H: val('H') } };
    update((m) => ({ ...m, nodes: [...m.nodes, node] }), `${pm.name} 넣기`);
    setSel(node.id);
  };
  const insertMesh = (i: Item) => {
    const s = /([\d.]+)\s*X\s*([\d.]+)\s*X\s*([\d.]+)/i.exec(i.modelSize || i.size || '');
    const node: PmNode = { id: uid('n'), def: 'instance', name: nextName(i.name), sub: { kind: 'mesh', id: i.id, name: i.name },
      params: { ...defaultParams(DEFS.instance), W: s?.[1] ?? '600', D: s?.[2] ?? '500', H: s?.[3] ?? '720' } };
    update((m) => ({ ...m, nodes: [...m.nodes, node] }), `${i.name} 넣기`);
    setSel(node.id);
  };
  const refUsed = (n: PmNode) => !!n.refName && !!model && (model.nodes.some((x) => x.id !== n.id && Object.values(x.params).some((s) => s?.includes(`@${n.refName}.`) || s?.includes(`@self${n.refName}.`)))
    || model.vars.some((v) => v.formula?.includes(`@${n.refName}.`)));
  const nodeAction = (a: NavAction, n: PmNode) => {
    switch (a) {
      case 'copy': {
        const c: PmNode = { ...structuredClone(n), id: uid('n'), name: `${n.name}-사본`, refName: undefined };
        update((m) => { const i = m.nodes.findIndex((x) => x.id === n.id); const nodes = [...m.nodes]; nodes.splice(i + 1, 0, c); return { ...m, nodes }; }, '복제');
        setSel(c.id);
        break;
      }
      case 'replace': if (n.sub?.kind === 'param') setReplaceFor(n); break;
      case 'array': setArrayFor(n); break;
      case 'unarray': update((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, array: undefined } : x)) }), '배열 해제'); break;
      case 'toggle': update((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, viewHidden: !x.viewHidden } : x)) }), '보기 숨김'); break;
      case 'up': case 'down': update((m) => {
        const i = m.nodes.findIndex((x) => x.id === n.id), j = i + (a === 'up' ? -1 : 1);
        if (j < 0 || j >= m.nodes.length) return m;
        const nodes = [...m.nodes]; [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; return { ...m, nodes };
      }, '순서'); break;
      case 'delete':
        setConfirm({ danger: true, ok: '삭제', text: <>‘{n.name}’ 을(를) 삭제할까요?{refUsed(n) && <><br /><small style={{ color: '#c4402f' }}>다른 수식이 @{n.refName} 을(를) 참조합니다. 삭제하면 그 수식이 오류가 됩니다.</small></>}</>,
          run: () => { update((m) => ({ ...m, nodes: m.nodes.filter((x) => x.id !== n.id), nodeReports: m.nodeReports.filter((r) => r.nodeId !== n.id) }), '삭제'); setSel(null); } });
        break;
      case 'rename': break;
    }
  };

  /* ── 파일 ── */
  const doSave = (m = model): PmModel | null => {
    if (!m) return null;
    const s = saveModel(m);
    setHist((h) => (h ? { ...h, list: h.list.map((x, k) => (k === h.i ? s : x)) } : h));
    setSaved(s);
    setCatalogSeq((x) => x + 1);
    return s;
  };
  const save = () => { if (doSave()) setToastMsg('저장했습니다'); };
  const saveAndRegister = async () => {
    if (!model || !built) return;
    if (model.lib == null) { setToastMsg('모델 유형(소속 라이브러리)이 없습니다 — 오른쪽 모델 속성에서 ‘변경’으로 고르세요'); return; }
    const errs = ev?.diagsAll().filter((d) => d.level === 'error') ?? [];
    if (errs.length) { setDiagOpen(true); setToastMsg(`수식 오류 ${errs.length}건 — 모델 진단에서 고친 뒤 입고하세요`); return; }
    setBusy('입고 중…');
    try {
      const out = await exportGlb(built);
      const size = built.frame.getSize(built.frame.min.clone());
      const v = withVersion({ ...model, preview: model.preview ?? out.thumb }, userName, verDesc);
      const s = doSave(v);
      setVerDesc('');
      const r: ModelResult = {
        kind: 'param', id: s!.id, name: s!.name, tooltype: s!.tooltype, lib: s!.lib, categoryId: s!.categoryId, category: s!.category,
        thumb: s!.preview ?? out.thumb, glb: out.glb, bbox: { w: Math.round(size.x), d: Math.round(size.y), h: Math.round(size.z) },
      };
      if (onRegister) await onRegister(r);
      else setToastMsg(await registerToLibrary(r, userName));
    } catch (e) { setToastMsg(`입고 실패: ${(e as Error).message}`); }
    finally { setBusy(''); }
  };
  const restoreVersion = (v: PmVersion) => {
    setConfirm({ ok: '복구', text: <>버전 {v.version} ({new Date(v.at).toLocaleString('ko-KR')}) 으로 되돌릴까요? 현재 편집 내용은 실행 취소로 되돌릴 수 있습니다.</>,
      run: () => { const snap = JSON.parse(v.snapshot) as PmModel; update((m) => ({ ...snap, id: m.id, versions: m.versions, version: m.version, preview: m.preview, markImage: m.markImage }), `버전 ${v.version} 복구`); setDlg(null); } });
  };
  const withDirtyCheck = (run: () => void, what: string) => {
    if (dirty) setConfirm({ ok: '계속', text: `저장하지 않은 변경이 있습니다. ${what}할까요?`, run }); else run();
  };
  const doCapture = (kind: 'preview' | 'mark') => {
    const grab = () => {
      const url = capture.current?.();
      if (url) void shrinkImage(url).then((small) => update((m) => ({ ...m, [kind === 'preview' ? 'preview' : 'markImage']: small }), kind === 'preview' ? '미리보기 이미지' : '표기도'));
    };
    if (kind === 'mark' && view !== 'F') {
      const prev = view;
      setView('F'); setFit((f) => f + 1);
      requestAnimationFrame(() => requestAnimationFrame(() => { grab(); setView(prev); setFit((f) => f + 1); }));
    } else grab();
  };

  /* ── 단축키 ── */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!model || typing(e) || formula || pathEdit || typeDlg || admin) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      const selNode = sel ? model.nodes.find((n) => n.id === sel) : undefined;
      const hit = (fn: () => void) => { e.preventDefault(); fn(); };
      if (ctrl && e.altKey && k === 's') return hit(() => { void saveAndRegister(); });
      if (ctrl && e.shiftKey && k === 's') return hit(() => { setSaveAsName(`${model.name}-사본`); setDlg('saveAs'); });
      if (ctrl && k === 's') return hit(save);
      if (ctrl && e.shiftKey && k === 'z') return hit(redo);
      if (ctrl && k === 'z') return hit(undo);
      if (ctrl && e.shiftKey && k === 'a') return hit(() => selNode && nodeAction('unarray', selNode));
      if (ctrl && k === 'v') return hit(() => selNode && nodeAction('copy', selNode));
      if (ctrl && k === 'e') return hit(() => setConfirm({ danger: true, ok: '비우기', text: '모델의 모든 부품·보조 구조를 지울까요? (변수는 남습니다)', run: () => { update((m) => ({ ...m, nodes: [], nodeReports: [] }), '비우기'); setSel(null); } }));
      if (ctrl && ['1', '2', '3', '4'].includes(k)) return hit(() => setShade((['mat', 'wire', 'trans', 'white'] as ShadeMode[])[Number(k) - 1]));
      if (e.altKey && k === 'b') return hit(() => setDlg('quote'));
      if (e.altKey && k === 's') return hit(() => setDlg('output'));
      if (e.shiftKey && !ctrl) {
        const id = Object.entries(INSERT_KEYS).find(([, v]) => v.toLowerCase() === `shift+${k}`)?.[0];
        const { elements, aux } = toolElements(model.tooltype);
        const d = id ? [...elements, ...aux].find((x) => x.id === id) : undefined;
        if (d) return hit(() => insertElement(d));
      }
      if (ctrl || e.altKey || e.shiftKey) return;
      if (e.key === 'Delete' && selNode) return hit(() => nodeAction('delete', selNode));
      if (e.key === '`' || e.key === '~') return hit(() => setLeftOpen((o) => !o));
      if (k === 'h' && selNode) return hit(() => nodeAction('toggle', selNode));
      if (k === 'c' && selNode?.sub?.kind === 'param') return hit(() => nodeAction('replace', selNode));
      if (k === 'a' && selNode) return hit(() => setArrayFor(selNode));
      if (k === 'v') return hit(() => { setView('3d'); setFit((f) => f + 1); });
      const v2 = ({ t: 'T', b: 'B', l: 'L', r: 'R', f: 'F', k: 'K' } as Record<string, ViewMode>)[k];
      if (v2) return hit(() => { setView(v2); setFit((f) => f + 1); });
    };
  });
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  const ctx: PmCtxValue | null = model && ev ? {
    model, ev, catalog,
    openFormula: (o) => setFormula(o),
    toast: (m) => setToastMsg(m),
  } : null;

  const searchHits = search.trim() && model ? model.vars.filter((v) => v.name.toLowerCase().includes(search.trim().toLowerCase()) || v.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20) : [];
  const gotoVar = (name: string) => {
    setLeftOpen(true); setLeftTab('param'); setFocusVar(name); setSearch('');
    requestAnimationFrame(() => document.getElementById(`pm-var-${name}`)?.scrollIntoView({ block: 'center' }));
  };

  if (!model || !ctx || !built) {
    return (
      <div className="pm-shell">
        <div className="pm-top"><div className="pm-brand"><b>파라메트릭 모델 에디터</b><span>모델 유형을 고르거나 저장한 모델을 여세요</span></div>
          <div className="pm-tools" />{onClose && <button className="pm-btn" onClick={onClose}>닫기</button>}</div>
        <div style={{ display: 'grid', placeItems: 'center', color: '#7a8494' }}>
          <button className="pm-primary" onClick={() => setTypeDlg({ tab: 'new' })}>모델 유형 선택</button>
        </div>
        {typeDlg && <PmModelDialog tooltype={request?.mode === 'new' ? request.tooltype : 'cabinet'} fixedTool={request?.mode === 'new'} initialTab={typeDlg.tab}
          onConfirm={applyType} onOpen={openModel} onClose={() => setTypeDlg(null)} />}
      </div>
    );
  }

  const selNode = sel && sel !== '__frame' ? model.nodes.find((n) => n.id === sel) : undefined;
  const pathNode = pathEdit ? (pathEdit.nodeId === '__frame' ? undefined : model.nodes.find((n) => n.id === pathEdit.nodeId)) : undefined;

  return (
    <PmCtx.Provider value={ctx}>
      <div className="pm-shell">
        <div className="pm-top">
          <div className="pm-brand">
            <b>파라메트릭 모델 에디터 <small style={{ color: '#7a8494', fontWeight: 400 }}>· {TOOLTYPE_LABEL[model.tooltype]}</small></b>
            <span title={model.name}>{model.name}{dirty && <em> · 저장 안 됨</em>}</span>
          </div>
          <div className="pm-tools">
            <button className="pm-tool" disabled={hist!.i === 0} onClick={undo} title={`실행 취소 (Ctrl+Z)${hist!.i > 0 ? ` — ${hist!.labels[hist!.i]}` : ''}`}><i>↶</i>실행 취소</button>
            <button className="pm-tool" disabled={hist!.i >= hist!.list.length - 1} onClick={redo} title="다시 실행 (Ctrl+Shift+Z)"><i>↷</i>다시 실행</button>
            <button className="pm-tool" disabled={!model.nodes.length} onClick={() => setConfirm({ danger: true, ok: '비우기', text: '모델의 모든 부품·보조 구조를 지울까요? (변수는 남습니다)', run: () => { update((m) => ({ ...m, nodes: [], nodeReports: [] }), '비우기'); setSel(null); } })} title="비우기 (Ctrl+E)"><i>⌫</i>비우기</button>
            <span className="pm-sep" />
            <Menu label="변수&속성" icon="⇄" items={[
              { label: '전역 변수', onClick: () => setAdmin('globals') }, { label: '변수 계열', onClick: () => setFamilyOpen(true) },
              { label: '업무 속성', onClick: () => setDlg('biz') }, { label: '견적 설정', key: 'Alt+B', onClick: () => setDlg('quote') }, { label: '데이터 출력 설정', key: 'Alt+S', onClick: () => setDlg('output') },
            ]} />
            <Menu label="도구" icon="🔧" items={[
              { label: '극속 모델링', unv: true }, { label: '문 개구부 연결', key: 'Alt+M', unv: true },
              { label: '부품 노드 보고 설정', onClick: () => setDlg('report') }, { label: '환경 조건', onClick: () => setDlg('env') },
            ]} />
            <Menu label="조작" icon="⇥" items={[{ label: '숨김 → 억제 전환 ▸', unv: true }, { label: '부품 동명 변수 참조', unv: true }]} />
            <Menu label="검증" icon="◎" items={[{ label: '모델 진단', onClick: () => setDiagOpen(true) }, { label: '참조 보기', onClick: () => setDlg('refs') }]} />
            <Menu label="플러그인" icon="✚" items={[{ label: '플러그인 불러오기', unv: true }, { label: '플러그인 내려받기', unv: true }, { label: '플러그인 닫기', unv: true }]} />
            <div className="pm-search">
              <input type="search" placeholder="여기서 변수 위치 검색" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="변수 위치 검색" />
              {searchHits.length > 0 && <div className="pm-search-pop">{searchHits.map((v) => <button key={v.id} onClick={() => gotoVar(v.name)}><span>{v.label}</span><small>#{v.name}</small></button>)}</div>}
            </div>
          </div>
          <div className="pm-tools right">
            <Menu label="도움말" icon="?" items={[
              { label: '모델링 교육 (명세서)', onClick: () => window.open(`${import.meta.env.BASE_URL}kujiale-param-editor-spec.html`, '_blank', 'noopener') },
              { label: '단축키', onClick: () => setDlg('keys') }, { label: '설문 피드백', unv: true }, { label: '로컬 로그 업로드', unv: true },
            ]} />
            <Menu label="파일" icon="▤" items={[
              { label: '새로 만들기', onClick: () => withDirtyCheck(() => setTypeDlg({ tab: 'new' }), '새로 만들기') },
              { label: '열기', onClick: () => withDirtyCheck(() => setTypeDlg({ tab: 'open' }), '다른 모델을 열기') },
              { sep: true, label: '-' },
              { label: '저장', key: 'Ctrl+S', onClick: save },
              { label: '저장 후 입고', key: 'Ctrl+Alt+S', onClick: () => { void saveAndRegister(); } },
              { label: '다른 이름으로 저장', key: 'Ctrl+Shift+S', onClick: () => { setSaveAsName(`${model.name}-사본`); setDlg('saveAs'); } },
              { label: '모델 버전', onClick: () => setDlg('versions') },
            ]} />
            <button className="pm-tool" onClick={() => setAdmin('settings')} title="파라메트릭 모델링 설정"><i>⚙</i>설정</button>
            {onClose && <button className="pm-btn" onClick={() => withDirtyCheck(onClose, '닫기')}>닫기</button>}
          </div>
        </div>

        <div className={`pm-body ${leftOpen ? '' : 'noleft'}`}>
          <div className="pm-left">{leftOpen && <>
            <div className="pm-tabs" role="tablist">
              <button role="tab" aria-selected={leftTab === 'param'} className={leftTab === 'param' ? 'on' : ''} onClick={() => setLeftTab('param')}><i>▤</i>파라미터 설정</button>
              <button role="tab" aria-selected={leftTab === 'element'} className={leftTab === 'element' ? 'on' : ''} onClick={() => setLeftTab('element')}><i>◇</i>요소 라이브러리</button>
              <button role="tab" aria-selected={leftTab === 'part'} className={leftTab === 'part' ? 'on' : ''} onClick={() => setLeftTab('part')}><i>▦</i>부품 라이브러리</button>
            </div>
            <div className="pm-left-body">
              {leftTab === 'param' && <VarPanel update={update} items={items} focusVar={focusVar} markHidden={locateHidden} />}
              {leftTab === 'element' && <ElementLib tool={model.tooltype} onInsert={insertElement} />}
              {leftTab === 'part' && <PartLib model={model} items={items} onInsertModel={insertModel} onInsertMesh={insertMesh} />}
            </div>
            {leftTab === 'param' && <ShowHiddenToggle on={locateHidden} onChange={setLocateHidden} />}
          </>}</div>

          <div className="pm-view">
            <PmViewport result={built} selected={sel} onSelect={setSel} showHidden={showHidden} showAux={showAux} explode={explode} view={view} shade={shade} fit={fit}
              onCapture={(fn) => { capture.current = fn; }} />
            {view !== '3d' && <div className="pm-viewname">2D · {VIEW_LABEL[view]}</div>}
            <div className="pm-vtoggles">
              <button className={diagOpen ? 'on' : ''} title="모델 진단" aria-label="모델 진단" onClick={() => setDiagOpen((o) => !o)}>⚕</button>
              <button className={navOpen ? 'on' : ''} title="구조 탐색" aria-label="구조 탐색" onClick={() => setNavOpen((o) => !o)}>☰</button>
            </div>
            {navOpen && <StructureNav sel={sel} onSelect={setSel} onAction={nodeAction} onClose={() => setNavOpen(false)}
              onRename={(n, name) => update((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === n.id ? { ...x, name } : x)) }), '이름 바꾸기')} />}
            {diagOpen && <DiagPanel built={built} onClose={() => setDiagOpen(false)} onPick={(nodeId, varName) => { if (nodeId) setSel(nodeId); if (varName) gotoVar(varName); }} />}
            {familyOpen && <FamilyPanel onClose={() => setFamilyOpen(false)} />}
            <div className="pm-vbar">
              <div className="grp">
                <Menu label={view === '3d' ? '2D' : `2D ${VIEW_LABEL[view]}`} icon="▭" items={(['T', 'B', 'L', 'R', 'F', 'K'] as ViewMode[]).map((v) => ({ label: `${VIEW_LABEL[v]}`, key: v, onClick: () => { setView(v); setFit((f) => f + 1); } }))} />
                <Menu label="3D" icon="◈" items={[
                  { label: '3D 보기', key: 'V', onClick: () => { setView('3d'); setFit((f) => f + 1); } }, { sep: true, label: '-' },
                  ...(['mat', 'wire', 'trans', 'white'] as ShadeMode[]).map((s, i) => ({ label: `${shade === s ? '● ' : ''}${SHADE_LABEL[s]}`, key: `Ctrl+${i + 1}`, onClick: () => setShade(s) })),
                ]} />
              </div>
              <div className="grp">
                <button className={`pm-tool ${showHidden ? 'on' : ''}`} title="숨김 조건이 참인 부품 흐리게 보기" onClick={() => setShowHidden((s) => !s)}><i>👁</i>숨김 보기</button>
                <button className={`pm-tool ${showAux ? 'on' : ''}`} title="보조 구조(흡착선·내부 공간·간섭 영역 …) 보기" onClick={() => setShowAux((s) => !s)}><i>⬚</i>보조 구조</button>
                <button className={`pm-tool ${diagOpen ? 'on' : ''}`} title="모델 진단" onClick={() => setDiagOpen((o) => !o)}><i>!</i>진단{ev!.diags.some((d) => d.level === 'error') ? ' ●' : ''}</button>
                <button className="pm-tool" title="화면 맞춤" onClick={() => setFit((f) => f + 1)}><i>⛶</i>맞춤</button>
              </div>
            </div>
            <div className="pm-explode"><span>분해 거리</span><input type="range" min={0} max={1.5} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} aria-label="분해 거리" /></div>
            {busy && <div className="pm-toast">{busy}</div>}
            {toastMsg && <div className="pm-toast" onClick={() => setToastMsg(null)}>{toastMsg}</div>}
          </div>

          <PropPanel sel={sel} update={update} items={items} onEditPath={setPathEdit}
            onChangeType={() => setTypeDlg({ tab: 'new', change: true })} onCapture={doCapture} onBiz={() => setDlg('biz')} onQuote={() => setDlg('quote')} />
        </div>

        {admin === 'globals' && <GlobalVarsPage items={items} onClose={() => { setAdmin(null); setCatalogSeq((x) => x + 1); }} />}
        {admin === 'settings' && <SettingsPage onClose={() => setAdmin(null)} />}

        {formula && <FormulaDialog title={formula.title} value={formula.value} hint={formula.hint} ev={ev!} onSave={formula.onSave} onClose={() => setFormula(null)} />}
        {pathEdit && pathNode && <ProfileEditor ev={ev!} node={pathNode} param={pathEdit.param} kind={pathEdit.kind} closedDefault={pathEdit.closed} title={pathEdit.title}
          onClose={() => setPathEdit(null)} onSave={(v) => update((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === pathNode.id ? { ...n, params: { ...n.params, [pathEdit.param]: v } } : n)) }), pathEdit.title)} />}
        {dlg === 'biz' && <BizDialog update={update} onClose={() => setDlg(null)} />}
        {dlg === 'quote' && <QuoteDialog update={update} onClose={() => setDlg(null)} />}
        {dlg === 'output' && <OutputDialog update={update} onClose={() => setDlg(null)} />}
        {dlg === 'report' && <NodeReportDialog update={update} onClose={() => setDlg(null)} />}
        {dlg === 'env' && <EnvDialog update={update} onClose={() => setDlg(null)} />}
        {dlg === 'versions' && <VersionsDialog desc={verDesc} onDesc={setVerDesc} onRestore={restoreVersion} onClose={() => setDlg(null)} />}
        {dlg === 'keys' && <ShortcutsDialog onClose={() => setDlg(null)} />}
        {dlg === 'refs' && <RefsDialog onClose={() => setDlg(null)} onPick={(nodeId, varName) => { setDlg(null); if (nodeId) setSel(nodeId); if (varName) gotoVar(varName); }} />}
        {dlg === 'saveAs' && (
          <Modal title="다른 이름으로 저장" onClose={() => setDlg(null)} footer={<><button className="pm-btn" onClick={() => setDlg(null)}>취소</button>
            <button className="pm-primary" disabled={!saveAsName.trim()} onClick={() => {
              const copy: PmModel = { ...model, id: uid('PM'), name: saveAsName.trim(), version: 0, versions: [], createdAt: Date.now() };
              const s = saveModel(copy); setCatalogSeq((x) => x + 1);
              setHist({ list: [s], labels: ['다른 이름으로 저장'], i: 0 }); setSaved(s); setDlg(null); setToastMsg(`‘${s.name}’(으)로 저장했습니다`);
            }}>저장</button></>}>
            <div className="pm-field"><label>모델 이름</label><input className="pm-in" value={saveAsName} autoFocus onChange={(e) => setSaveAsName(e.target.value)} /></div>
          </Modal>
        )}
        {arrayFor && <ArrayDialog node={arrayFor} onClose={() => setArrayFor(null)} onApply={(a) => update((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === arrayFor.id ? { ...x, array: a } : x)) }), '배열')} />}
        {replaceFor && <ModelPicker title={`${replaceFor.name} 교체`} exclude={model.id} tool={model.tooltype} onClose={() => setReplaceFor(null)}
          onPick={(pm) => update((m) => ({ ...m, nodes: m.nodes.map((x) => (x.id === replaceFor.id ? { ...x, sub: { kind: 'param', id: pm.id, name: pm.name } } : x)) }), '교체')} />}
        {typeDlg && <PmModelDialog tooltype={model.tooltype} fixedTool={!!typeDlg.change} initialTab={typeDlg.tab} change={typeDlg.change} current={{ lib: model.lib, categoryId: model.categoryId }}
          onConfirm={applyType} onOpen={openModel} onClose={() => setTypeDlg(null)} />}
        {confirm && <Confirm text={confirm.text} ok={confirm.ok} danger={confirm.danger} onCancel={() => setConfirm(null)} onOk={() => { const r = confirm.run; setConfirm(null); r(); }} />}
        {selNode && elementDef(selNode.def) == null && <div className="pm-toast">정의를 찾을 수 없는 부품: {selNode.def}</div>}
      </div>
    </PmCtx.Provider>
  );
}
