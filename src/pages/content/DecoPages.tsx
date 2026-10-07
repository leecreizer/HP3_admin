import { useState } from 'react';
import { HYBRID_RENDER_CATS } from '../../data/contentCreate';
import { itemsOf, newId } from '../../data/contentLibrary';
import { putAsset } from '../../data/assetStore';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { MB, itemLW, loadImage, mixPreview, nameMsg, readDataUrl, submitSizeMsg } from './decoUtil';
import { DecoShell, FolderChecks, KSelect, MaterialPick, SizePair, UpAlert, UpBox, UpRow, type MatPick, type UpPreview } from './decoWidgets';

/**
 * 컨텐츠 제작 — 쿠지알러 꾸밈 소재 업로드 화면(decoration-cms) 이식.
 * 2026-10-07 쿠지알러 HANSSEM 계정에서 새로 만들어 보며 확인(저장·완료 업로드는 누르지 않음) + 화면 번들의 검사 규칙.
 */

const baseName = (f: File) => f.name.replace(/\.[^.]+$/, '');

/* ───────────────────────── 혼합 재질 (混合材质上传) ───────────────────────── */

const HYBRID_EXTS = ['jpg', 'jpeg', 'png', 'bmp', 'jp2', 'jpe', 'tiff', 'tif'];
const HYBRID_TIP = ['1. 흑백 두 색으로만 된 이미지여야 올바르게 인식됩니다', `2. ${HYBRID_EXTS.map((e) => `*.${e}`).join(', ')}`, '3. 파일 크기 5MB 이하'];

/**
 * 흑백 마스크 한 장 + 검은 영역·흰 영역 재질 = 혼합 재질 (몰딩·벽판용).
 * 왼쪽에 마스크를 올리면 소재 이름이 파일 이름으로 채워지고, 미리보기는 입력한 길이×폭 비율로 늘어난다.
 * 저장하면 재질 라이브러리에 상품이 생기고, 목록 이미지는 두 재질을 마스크대로 합성한 미리보기다.
 */
export function HybridMaterialPage({ tab, portal, st, onClose, onCreate }: PageProps) {
  const lib = portal.lib ?? 39;
  const tree = st.trees[st.activeLibrary]?.[lib] ?? [];
  const mats = itemsOf(st).filter((i) => !i.deletedAt && i.lib === lib);
  const [mask, setMask] = useState<UpPreview | null>(null);
  const [name, setName] = useState('');
  const [len, setLen] = useState('');
  const [wid, setWid] = useState('');
  const [cat, setCat] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [black, setBlack] = useState<MatPick | null>(null);
  const [white, setWhite] = useState<MatPick | null>(null);
  const [opened, setOpened] = useState<'black' | 'white' | null>(null);
  const [busy, setBusy] = useState('');
  const [upErr, setUpErr] = useState('');
  const [alert, setAlert] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const reset = () => { setMask(null); setName(''); setLen(''); setWid(''); setCat(''); setFolders([]); setBlack(null); setWhite(null); setOpened(null); setUpErr(''); };
  const cancel = () => confirm({ title: '업로드 취소', message: '업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });

  const onFile = async (f: File) => {
    setUpErr('');
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!HYBRID_EXTS.includes(ext)) { setUpErr(`조건에 맞는 이미지를 고르세요: ${HYBRID_EXTS.map((e) => `*.${e}`).join(', ')}`); return; }
    if (f.size > 5 * MB) { setUpErr('5MB보다 작은 이미지를 올리세요'); return; }
    setBusy('이미지 올리는 중…');
    try {
      const src = await readDataUrl(f);
      const im = await loadImage(src);
      if (im.naturalWidth > 5000 || im.naturalHeight > 5000) { setUpErr('이미지 크기가 5000*5000을 넘습니다. 다시 고르세요'); return; }
      setMask({ src, w: im.naturalWidth, h: im.naturalHeight });
      setName((n) => (n.trim() ? n : baseName(f)));
    } catch {
      setUpErr(`${f.name}: 이 브라우저에서 읽을 수 없는 이미지입니다 — 다시 올려 주세요`);
    } finally { setBusy(''); }
  };

  const submit = async (keep: boolean) => {
    const msg = !mask ? '소재 텍스처를 올리세요'
      : nameMsg(name) || submitSizeMsg([len, wid]) || (!cat ? '렌더 분류를 고르세요' : '') || (!black || !white ? '재질을 고르세요' : '');
    if (msg || !mask || !black || !white) { setAlert(msg); return; }
    setBusy('저장 중…');
    try {
      const l = parseInt(len, 10), w = parseInt(wid, 10);
      const mm = (p: MatPick) => { const it = mats.find((i) => i.id === p.id); return it ? itemLW(it) : null; };
      const img = await mixPreview(mask.src, [l, w], [{ img: black.img, mm: mm(black) }, { img: white.img, mm: mm(white) }]);
      const maskId = newId('MSK');
      await putAsset(maskId, mask.src);
      const nm = name.trim();
      onCreate([{
        name: nm, lib, folder: folders[0], extraFolders: folders.length > 1 ? folders.slice(1) : undefined,
        img, texture: maskId, modelSize: `${l} X ${w} X 0 mm`, renderCat: cat, mix: { mask: maskId, black, white },
      }], `‘${nm}’ 혼합 재질을 만들었습니다`, keep ? { keep: true } : { detail: true });
      if (keep) reset();
    } catch (e) {
      setAlert(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally { setBusy(''); }
  };

  const aspect = parseFloat(len) > 0 && parseFloat(wid) > 0 ? parseFloat(len) / parseFloat(wid) : null;
  return (
    <DecoShell crumbs={[tab.label, '혼합 재질 업로드']} onCancel={cancel}>
      <UpBox title="로컬 파일을 골라 올리세요" desc="5MB 이하, 해상도 5000*5000 이하" tip={HYBRID_TIP} accept={HYBRID_EXTS.map((e) => `.${e}`).join(',')}
        onFile={(f) => void onFile(f)} preview={mask} aspect={aspect} busy={busy === '이미지 올리는 중…' ? busy : undefined} err={upErr} />
      <div className="cl-up-form">
        <ul>
          <UpRow label="소재 이름" req><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></UpRow>
          <UpRow label="크기" req top tip={['설정한 길이·폭은 10-5000mm 안']}><SizePair l={len} w={wid} onChange={(a, b) => { setLen(a); setWid(b); }} /></UpRow>
          <UpRow label="렌더 분류" req>
            <KSelect label="렌더 분류" value={cat} onChange={setCat} options={HYBRID_RENDER_CATS.map((c) => ({ value: c.value, label: c.value, title: c.zh }))} />
          </UpRow>
          <UpRow label="소속 분류">
            <FolderChecks tree={tree} rootLabel="재질 라이브러리" placeholder="재질 라이브러리(미분류)" value={folders} onChange={setFolders} />
          </UpRow>
          <UpRow label="재질" req top>
            <div className="cl-mp-list">
              <MaterialPick area="검은 영역" value={black} open={opened === 'black'} onOpen={() => setOpened('black')} onApply={(v) => { setBlack(v); setOpened(null); }} items={mats} tree={tree} />
              <MaterialPick area="흰 영역" value={white} open={opened === 'white'} onOpen={() => setOpened('white')} onApply={(v) => { setWhite(v); setOpened(null); }} items={mats} tree={tree} />
            </div>
          </UpRow>
        </ul>
        <div className="cl-up-actions">
          <button className="btn-ghost" disabled={!!busy} onClick={() => void submit(true)}>계속 올리기</button>
          <button className="btn-primary" disabled={!!busy} onClick={() => void submit(false)}>{busy === '저장 중…' ? '저장 중…' : '완료'}</button>
        </div>
      </div>
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </DecoShell>
  );
}
