import { useRef, useState, type DragEvent } from 'react';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { FolderChecks, Pager, Tip, UpAlert } from './decoWidgets';
import {
  CC_IMG_MAX, CC_IMG_MB, CC_MAX, CC_NAME_MAX, CC_PAGE, CC_PLACEHOLDER, CC_TEMPLATE_HREF, cardFilled, cardHex, cardValid, chipFileError, chipLine,
  csvToText, decodeCsv, emptyCard, fieldError, normRgb, parseCcText, previewColor, swatchImg, type CcCard, type CcField,
} from './colorCard';

/**
 * 컬러칩 업로드 (쿠지알러 色卡上传 · /vc/commodity/upload/colorCard) — 2026-10-07 쿠지알러 화면·번들로 확인(확인 업로드는 누르지 않음).
 * 위: 비우기 · 무효 수 · 총 수 · 확인 업로드 / 왼쪽: CSV 인식 · 컬러칩 이미지 인식 → 가져오기 / 오른쪽: 컬러칩 표(한 쪽 8줄).
 * 쿠지알러는 한 개씩 서버에 올리지만(2초 간격) HP3 는 컨텐츠 라이브러리 ‘컬러칩’에 바로 넣는다.
 */

const LIB = 9;
const FIELDS: CcField[] = ['r', 'g', 'b', 'name'];
const SIDES = ['CSV 인식', '컬러칩 이미지 인식'] as const;

/** 끌어 놓기 글상자 — 눌러도 파일 창은 열지 않고(글을 쓰는 곳이라 — 쿠지알러 같음) 끌어 놓은 파일만 받는다 */
function DropText({ value, onChange, onFiles, label }: { value: string; onChange: (v: string) => void; onFiles: (f: File[]) => void; label: string }) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  return (
    <div className={`cl-ck-drop${over ? ' over' : ''}`}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); }}>
      <textarea className="cl-ck-ta" aria-label={label} placeholder={CC_PLACEHOLDER} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function ColorCardPage({ tab, st, onClose, onCreate, onReveal }: PageProps) {
  const tree = st.trees[st.activeLibrary]?.[LIB] ?? [];
  const [cards, setCards] = useState<CcCard[]>(() => [emptyCard()]);
  /** 오류를 보여 줄 칸 — 흐림(blur)·가져오기·올리기 뒤 */
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  const [side, setSide] = useState(0);
  const [csvText, setCsvText] = useState('');
  const [imgText, setImgText] = useState('');
  const [csvFolders, setCsvFolders] = useState<string[]>([]);
  const [imgFolders, setImgFolders] = useState<string[]>([]);
  const [spin, setSpin] = useState<{ i: number; n: number } | null>(null);
  const runRef = useRef(0);
  const [errs, setErrs] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(0);
  const [done, setDone] = useState<{ ok: number; ids: string[] } | null>(null);
  const [alert, setAlert] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const pages = Math.max(1, Math.ceil(cards.length / CC_PAGE));
  const cur = Math.min(page, pages);
  const tkey = (id: string, f: CcField) => `${id}:${f}`;
  const touch = (id: string, f: CcField) => setTouched((t) => (t.has(tkey(id, f)) ? t : new Set(t).add(tkey(id, f))));
  const touchAll = (list: CcCard[]) => setTouched((t) => { const n = new Set(t); for (const c of list) for (const f of FIELDS) n.add(tkey(c.id, f)); return n; });
  const errOf = (c: CcCard, f: CcField) => (touched.has(tkey(c.id, f)) ? fieldError(c, f) : '');
  const setField = (id: string, f: CcField, v: string) => setCards((cs) => cs.map((x) => { if (x.id !== id) return x; const n = { ...x }; n[f] = v; return n; }));
  const setFolders = (id: string, folders: string[]) => setCards((cs) => cs.map((x) => (x.id === id ? { ...x, folders } : x)));

  /** 새 컬러칩 — 맨 위에 빈 줄 (쿠지알러 新增色卡) */
  const addCard = () => {
    if (cards.length >= CC_MAX) { setAlert(`추가하지 못했습니다 — 상품이 ${CC_MAX}개를 넘습니다`); return; }
    setCards((cs) => [emptyCard(), ...cs]);
    setPage(1);
  };
  /** 가져오기 — 지금 탭의 글상자를 줄로 나눠 맨 위에 넣고, 모든 줄을 검사 (쿠지알러 导入) */
  const importText = () => {
    if (side === 1) setErrs([]);
    const list = parseCcText(side === 0 ? csvText : imgText, side === 0 ? csvFolders : imgFolders);
    if (!list.length) return;
    if (cards.length + list.length > CC_MAX) { setAlert(`가져오지 못했습니다 — 상품이 ${CC_MAX}개를 넘습니다`); return; }
    const next = [...list, ...cards];
    setCards(next);
    setPage(1);
    if (side === 0) setCsvText(''); else setImgText('');
    touchAll(next);
  };
  /** CSV 끌어 놓기 — .csv 한 개만 (여러 개면 무시), 첫 줄 건너뛰고 글상자를 바꾼다 */
  const onCsvFiles = async (fs: File[]) => {
    const csv = fs.filter((f) => f.name.toLowerCase().endsWith('.csv'));
    if (csv.length !== 1) return;
    setCsvText(csvToText(decodeCsv(await csv[0].arrayBuffer())));
  };
  /** 컬러칩 사진 끌어 놓기 — 한 장씩 가운데 색을 읽어 ‘r,g,b,이름’ 줄로, 못 읽은 파일은 경고 목록 */
  const onImgFiles = async (fs: File[]) => {
    if (!fs.length) return;
    if (fs.length > CC_IMG_MAX) { setAlert(`한 번에 인식할 수 있는 수(${CC_IMG_MAX}개)를 넘었습니다. 다시 고르세요`); return; }
    const run = ++runRef.current;
    setSpin({ i: 0, n: fs.length });
    const lines: string[] = [], bad: string[] = [];
    for (let k = 0; k < fs.length; k++) {
      const e = chipFileError(fs[k]);
      if (e) bad.push(e);
      else { try { lines.push(await chipLine(fs[k])); } catch (x) { bad.push((x as Error).message); } }
      if (runRef.current !== run) return; // 취소
      setSpin({ i: k + 1, n: fs.length });
    }
    setSpin(null);
    if (lines.length) setImgText(lines.join('\n'));
    setErrs(bad);
  };
  const cancelSpin = () => { runRef.current++; setSpin(null); setErrs([]); };

  const delCard = (id: string) => confirm({
    title: '삭제', message: '이 컬러칩을 삭제할까요?', confirmLabel: '예, 삭제',
    onConfirm: () => {
      const left = cards.length - 1;
      setCards((cs) => cs.filter((c) => c.id !== id));
      if (cur > 1 && left < (cur - 1) * CC_PAGE + 1) setPage(cur - 1); // 그 쪽 마지막 줄이면 앞 쪽으로
    },
  });
  const clearAll = () => confirm({
    title: '비우기', message: '컬러칩을 모두 비울까요?', confirmLabel: '예, 비우기',
    onConfirm: () => { setCards([emptyCard()]); setPage(1); setInvalid(0); setTouched(new Set()); },
  });
  /** 확인 업로드 — 올바른 줄만 상품으로, 나머지는 ‘N개 무효’로 표에 남긴다 (쿠지알러 handleUploadAll) */
  const upload = () => {
    const ok = cards.filter(cardValid), bad = cards.filter((c) => !cardValid(c));
    setInvalid(bad.length);
    touchAll(bad);
    if (!ok.length) return;
    const ids = onCreate(ok.map((c) => {
      const hex = cardHex(c);
      return {
        name: c.name.trim(), lib: LIB, folder: c.folders[0], extraFolders: c.folders.length > 1 ? c.folders.slice(1) : undefined,
        img: swatchImg(hex), renderCat: '컬러칩', colorCard: { color: hex },
      };
    }), `컬러칩 ${ok.length}개를 올렸습니다`, { keep: true });
    setCards(bad);
    setPage(1);
    setDone({ ok: ok.length, ids });
  };
  const close = () => {
    if (!cards.some(cardFilled) && !csvText.trim() && !imgText.trim()) { onClose(); return; }
    confirm({ title: '업로드 취소', message: '올리지 않은 컬러칩이 있습니다. 업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });
  };

  const row = (c: CcCard, i: number) => {
    const bg = previewColor(c);
    const nameErr = errOf(c, 'name');
    return (
      <tr key={c.id}>
        <td className="cl-ck-idx">{i + 1}</td>
        <td className="cl-ck-pv"><span className="cl-ck-prev" role="img" aria-label={`${i + 1}번 미리보기${bg ? ` ${bg}` : ' 없음'}`} style={bg ? { background: bg } : undefined} /></td>
        {(['r', 'g', 'b'] as const).map((f) => {
          const e = errOf(c, f);
          return (
            <td key={f} className="cl-ck-rgb">
              <input className={e ? 'bad' : ''} inputMode="numeric" autoComplete="off" aria-label={`${i + 1}번 ${f.toUpperCase()}`} aria-invalid={!!e}
                value={c[f]} onChange={(ev) => setField(c.id, f, normRgb(ev.target.value, c[f]))} onBlur={() => touch(c.id, f)} />
              {e && <small className="cl-ck-err">{e}</small>}
            </td>
          );
        })}
        <td className="cl-ck-name">
          <input className={nameErr ? 'bad' : ''} autoComplete="off" maxLength={CC_NAME_MAX} aria-label={`${i + 1}번 이름`} aria-invalid={!!nameErr}
            value={c.name} onChange={(ev) => setField(c.id, 'name', ev.target.value)} onBlur={() => touch(c.id, 'name')} />
          {nameErr && <small className="cl-ck-err">{nameErr}</small>}
        </td>
        <td className="cl-ck-cat">
          <FolderChecks tree={tree} rootLabel="컬러칩" placeholder="컬러칩(미분류)" value={c.folders} onChange={(v) => setFolders(c.id, v)} label={`${i + 1}번 분류`} />
        </td>
        <td className="cl-ck-op"><button type="button" className="link-mini" aria-label={`${i + 1}번 삭제`} onClick={() => delCard(c.id)}>삭제</button></td>
      </tr>
    );
  };

  return (
    <div className="cl-cp" role="dialog" aria-modal="true" aria-label="컬러칩 업로드">
      <header className="cl-cp-head">
        <nav className="cl-cp-crumb" aria-label="위치"><span>{tab.label}</span><span className="cur">컬러칩</span></nav>
        <button className="cl-x" aria-label="닫기" onClick={close}>×</button>
      </header>
      <div className="cl-ck">
        <div className="cl-ck-bar">
          <button className="btn-ghost" disabled={!cards.length} onClick={clearAll}>비우기</button>
          <span className="cl-ck-sum">
            {invalid > 0 && <b className="cl-ck-bad">{invalid}개 무효</b>}
            <span>총 {cards.length}개 컬러칩</span>
          </span>
          <button className="btn-primary" disabled={!cards.length} onClick={upload}>확인 업로드</button>
        </div>
        <div className="cl-ck-main">
          <aside className="cl-ck-side" aria-label="한꺼번에 넣기">
            <div className="cl-ck-tabs" role="tablist" aria-label="인식 방식">
              {SIDES.map((t, k) => <button key={t} type="button" role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>{t}</button>)}
            </div>
            {side === 0 ? (
              <div className="cl-ck-pane" role="tabpanel" aria-label={SIDES[0]}>
                <p className="cl-ck-info"><span aria-hidden="true">🔔</span>CSV 파일을 끌어 놓아 한꺼번에 인식<Tip lines={['.csv 형식 표 파일을 끌어 놓을 수 있습니다', '첫 줄(머리)은 건너뜁니다 — 표 템플릿 참고']} /></p>
                <a className="link-mini cl-ck-tpl" href={CC_TEMPLATE_HREF} download="표 템플릿.csv">표 템플릿.csv</a>
                <FolderChecks tree={tree} rootLabel="컬러칩" placeholder="컬러칩(미분류)" value={csvFolders} onChange={setCsvFolders} label="CSV 가져올 분류" />
                <DropText value={csvText} onChange={setCsvText} onFiles={(fs) => void onCsvFiles(fs)} label="CSV 컬러칩 정보" />
              </div>
            ) : (
              <div className="cl-ck-pane" role="tabpanel" aria-label={SIDES[1]}>
                <p className="cl-ck-info"><span aria-hidden="true">🔔</span>컬러칩 이미지를 끌어 놓아 한꺼번에 인식<Tip lines={['jpg/png 형식 컬러칩만 지원합니다', `한 번에 최대 ${CC_IMG_MAX}개, 한 장 ${CC_IMG_MB}MB 이하`, '그림 가운데 점의 색을 읽습니다']} /></p>
                <FolderChecks tree={tree} rootLabel="컬러칩" placeholder="컬러칩(미분류)" value={imgFolders} onChange={setImgFolders} label="이미지 가져올 분류" />
                <div className="cl-ck-spinwrap">
                  <DropText value={imgText} onChange={setImgText} onFiles={(fs) => void onImgFiles(fs)} label="이미지 컬러칩 정보" />
                  {spin && <div className="cl-ck-spin" role="status"><span>컬러칩 인식 중.. {spin.i}/{spin.n}</span><button type="button" className="link-mini" onClick={cancelSpin}>취소</button></div>}
                </div>
              </div>
            )}
            <button type="button" className="btn-ghost cl-ck-import" onClick={importText}>가져오기</button>
            {errs.length > 0 && (
              <div className="cl-ck-warn" role="alert">
                <button type="button" className="cl-ck-warn-x" aria-label="경고 닫기" onClick={() => setErrs([])}>×</button>
                <b>{errs.length}개 파일을 인식하지 못했습니다.</b>
                {errs.map((e, k) => <p key={k}>{e}</p>)}
              </div>
            )}
          </aside>
          <div className="cl-ck-list">
            <table className="cl-ck-table">
              <thead><tr><th className="cl-ck-idx">번호</th><th className="cl-ck-pv">컬러칩 미리보기</th><th>R</th><th>G</th><th>B</th><th>이름</th><th>분류</th><th className="cl-ck-op">작업</th></tr></thead>
              <tbody>{cards.slice((cur - 1) * CC_PAGE, cur * CC_PAGE).map((c, k) => row(c, (cur - 1) * CC_PAGE + k))}</tbody>
            </table>
            <div className="cl-ck-foot">
              <button type="button" className="btn-ghost cl-ck-add" onClick={addCard}>＋ 새 컬러칩</button>
              {pages > 1 && <Pager page={cur} pages={pages} onPage={setPage} />}
            </div>
          </div>
        </div>
      </div>
      {done && (
        <div className="modal-backdrop"><div className="modal confirm-modal" role="alertdialog" aria-label="업로드 완료">
          <h2 className="modal-title">✓ 업로드 완료</h2>
          <p className="cl-up-alert-msg">상품 {done.ok}개를 올렸습니다</p>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={() => { const id = done.ids[0]; setDone(null); if (id) onReveal(id); else onClose(); }}>상품 목록 보기</button>
            <button className="btn-primary" style={{ marginLeft: 0 }} onClick={() => setDone(null)}>계속 올리기</button>
          </div>
        </div></div>
      )}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </div>
  );
}
