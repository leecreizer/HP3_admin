import { useState } from 'react';
import tilePatterns from '../../data/tilePatterns.json';
import { itemsOf, type Item, type MixPart } from '../../data/contentLibrary';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { DecoShell, FolderChecks, MaterialPick, Pager, UpAlert, UpRow, type MatPick } from './decoWidgets';

/**
 * 타일 배열 패턴 업로드 (쿠지알러 拼砖样式上传) — 2026-10-07 쿠지알러에서 확인(붙임 방식 고르기 창까지, 확인 업로드·창의 저장은 누르지 않음) + 화면 번들 규칙.
 * 붙임 방식 템플릿(94종, tilePatterns.json)을 고르면 그 템플릿의 크기 항목과 타일 칸(1번 타일…)이 나오고, 칸마다 타일 상품을 고른다.
 * 쿠지알러는 고른 타일로 서버 미리보기를 그리지만 HP3 는 템플릿 그림을 보여 준다(배열 형상 계산은 서버 전용이라 옮기지 못함).
 */

type Tpl = { id: number; name: string; zh: string; img: string; cat: number; sizes: { key: string; label: string; value: number }[]; slots: { key: string; label: string; shaped: boolean }[] };
const TEMPLATES = tilePatterns as Tpl[];
const TILE_LIB = 4;
const PER_PAGE = 28;

/** 배열에 쓰는 타일 — 쿠지알러는 타일·바닥재·석재 일부(517·518·519·521·3112). HP3 는 천장판·보더 타일을 뺀 타일 상품 */
const usable = (i: Item) => i.renderCat !== '천장판' && i.renderCat !== '보더 타일' && !(i.tile?.cat ?? []).includes(3108) && !i.border && !i.tilePattern;

function PatternDialog({ value, onCancel, onOk }: { value: Tpl | null; onCancel: () => void; onOk: (t: Tpl) => void }) {
  const [sel, setSel] = useState<Tpl | null>(value);
  const [page, setPage] = useState(value ? Math.floor(TEMPLATES.indexOf(value) / PER_PAGE) + 1 : 1);
  const pages = Math.ceil(TEMPLATES.length / PER_PAGE);
  const shown = TEMPLATES.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal cl-modal xl cl-tp" role="dialog" aria-modal="true" aria-label="붙임 방식 선택" onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head"><h2 className="modal-title">붙임 방식 선택</h2><button className="cl-x" aria-label="닫기" onClick={onCancel}>×</button></div>
        <ul className="cl-tp-grid" role="listbox" aria-label="붙임 방식">
          {shown.map((t) => (
            <li key={t.id}><button type="button" role="option" aria-selected={sel?.id === t.id} className={sel?.id === t.id ? 'on' : ''} title={t.zh} onClick={() => setSel(t)} onDoubleClick={() => onOk(t)}>
              <img src={t.img} alt="" loading="lazy" /><span>{t.name}</span></button></li>
          ))}
        </ul>
        <div className="modal-actions cl-tp-foot"><Pager page={page} pages={pages} onPage={setPage} /><button className="btn-primary" disabled={!sel} onClick={() => sel && onOk(sel)}>확인</button></div>
      </div>
    </div>
  );
}

export function TilePatternPage({ tab, st, onClose, onCreate }: PageProps) {
  const tiles = itemsOf(st).filter((i) => !i.deletedAt && i.lib === TILE_LIB && usable(i));
  const tree = st.trees[st.activeLibrary]?.[TILE_LIB] ?? [];
  const [tpl, setTpl] = useState<Tpl | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [name, setName] = useState('');
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, MatPick>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [alert, setAlert] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const choose = (t: Tpl) => {
    setTpl(t);
    setSizes(Object.fromEntries(t.sizes.map((s) => [s.key, String(s.value)])));
    setPicks((p) => Object.fromEntries(t.slots.filter((s) => p[s.key]).map((s) => [s.key, p[s.key]])));
    setOpened(null); setChoosing(false);
  };
  const submit = () => {
    const sizeBad = tpl ? tpl.sizes.some((s) => !(parseInt(sizes[s.key] ?? '', 10) > 0) || !/^\d+$/.test((sizes[s.key] ?? '').trim())) : false;
    const msg = !tpl ? '붙임 방식을 고르세요!' : !name.trim() ? '스타일 이름을 입력하세요!' : name.length > 128 ? '이름은 128자를 넘을 수 없습니다'
      : sizeBad ? '올바른 크기를 입력하세요!' : tpl.slots.some((s) => !picks[s.key]) ? '타일을 모두 고르세요' : '';
    if (msg || !tpl) { setAlert(msg); return; }
    const part = (p: MatPick): MixPart => ({ id: p.id, name: p.name, img: p.img });
    onCreate([{
      name: name.trim(), lib: TILE_LIB, folder: folders[0], extraFolders: folders.length > 1 ? folders.slice(1) : undefined,
      img: tpl.img, renderCat: '타일 배열 패턴', modelSize: tpl.sizes.map((s) => `${s.label} ${parseInt(sizes[s.key], 10)}`).join(' · ') + ' mm',
      tilePattern: { templateId: tpl.id, template: tpl.name, sizes: Object.fromEntries(tpl.sizes.map((s) => [s.key, parseInt(sizes[s.key], 10)])), tiles: Object.fromEntries(tpl.slots.map((s) => [s.key, part(picks[s.key])])) },
    }], `‘${name.trim()}’ 타일 배열 패턴을 올렸습니다`, { detail: true });
  };
  const cancel = () => confirm({ title: '업로드 취소', message: '업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });

  return (
    <DecoShell crumbs={[tab.label, '타일 상품', '타일 배열 패턴 업로드']} onCancel={cancel}>
      <div className="cl-ub">
        <div className="cl-ub-in cl-tp-prev">
          {tpl ? (
            <>
              <img src={tpl.img} alt={`${tpl.name} 붙임 방식`} />
              <button type="button" className="btn-ghost cl-tp-change" onClick={() => setChoosing(true)}>붙임 방식 바꾸기</button>
            </>
          ) : <button type="button" className="btn-ghost" onClick={() => setChoosing(true)}>+ 붙임 방식 선택</button>}
        </div>
        {tpl && <p className="cl-muted cl-tp-cap">{tpl.name} <small>{tpl.zh}</small> — 고른 타일로 그린 미리보기는 쿠지알러 서버 기능이라 HP3 는 템플릿 그림을 보여 줍니다</p>}
      </div>
      <div className="cl-up-form">
        <ul>
          <UpRow label="스타일 이름" req><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" value={name} onChange={(e) => setName(e.target.value)} /></UpRow>
          <UpRow label="크기" req top={!!tpl} tip={['붙임 방식마다 정해진 크기 항목 (mm, 양의 정수)']}>
            {tpl ? (
              <ul className="cl-tp-sizes">
                {tpl.sizes.map((s) => (
                  <li key={s.key}><span>{s.label}</span><input className="inline-input" inputMode="numeric" value={sizes[s.key] ?? ''} aria-label={`${s.label} mm`} onChange={(e) => setSizes({ ...sizes, [s.key]: e.target.value })} /><em>mm</em></li>
                ))}
              </ul>
            ) : <button type="button" className="btn-ghost cl-tp-first" onClick={() => setChoosing(true)}>+ 먼저 붙임 방식을 고르세요</button>}
          </UpRow>
          <UpRow label="상품 모델" req top={!!tpl}>
            {tpl ? (
              <div className="cl-mp-list">
                {tpl.slots.map((s) => (
                  <MaterialPick key={s.key} area={s.label} placeholder={s.label} noCat value={picks[s.key] ?? null} open={opened === s.key}
                    onOpen={() => setOpened(s.key)} onApply={(v) => { setPicks({ ...picks, [s.key]: v }); setOpened(null); }} items={tiles} tree={[]} />
                ))}
                {tpl.slots.some((s) => s.shaped) && <p className="cl-muted cl-tp-note">이 붙임 방식은 쿠지알러에서 이형 타일(큰 타일·작은 타일 형상 값이 맞는 것)만 고를 수 있습니다 — HP3 에는 이형 타일 형상 정보가 없어 일반 타일 상품에서 고릅니다</p>}
              </div>
            ) : <button type="button" className="btn-ghost cl-tp-first" onClick={() => setChoosing(true)}>+ 먼저 붙임 방식을 고르세요</button>}
          </UpRow>
          <UpRow label="소속 분류">
            <FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={folders} onChange={setFolders} />
          </UpRow>
        </ul>
        <div className="cl-up-actions"><button className="btn-primary" onClick={submit}>업로드 확인</button></div>
      </div>
      {choosing && <PatternDialog value={tpl} onCancel={() => setChoosing(false)} onOk={choose} />}
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </DecoShell>
  );
}
