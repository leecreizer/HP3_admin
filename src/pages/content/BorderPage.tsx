import { useEffect, useRef, useState } from 'react';
import { itemsOf, type Item, type MixPart } from '../../data/contentLibrary';
import { useConfirm } from '../../components/confirm';
import type { PageProps } from './createTypes';
import { itemLW, loadImage } from './decoUtil';
import { DecoShell, FolderChecks, MaterialPick, UpAlert, UpRow, type MatPick } from './decoWidgets';

/**
 * 보더 패턴 업로드 (쿠지알러 波打线样式上传) — 2026-10-07 쿠지알러에서 새로 만들어 보며 확인(확인 업로드는 누르지 않음) + 화면 번들 규칙.
 * 타일 상품 중에서 보더 타일(테두리 띠)과 코너 타일(모서리 칸)을 골라 ㄱ자 테두리 무늬를 만든다.
 * ‘보더 타일’ 종류면 렌더 분류가 보더 타일인 타일 상품만, ‘평붙임 타일’이면 일반 타일 상품에서 고른다.
 * 쿠지알러는 미리보기를 서버에서 그리지만 HP3 는 캔버스로 그린다.
 */

const TILE_LIB = 4;
const SIZE = 360, BAND = 72;

type Pick = { item: Item; img: string } | null;

/** ㄱ자 테두리 그림 — 위·왼쪽 띠는 보더 타일을 띠 방향으로 반복, 코너가 있으면 왼쪽 위 칸에 코너 타일, 없으면 두 띠를 45°로 맞물림 */
async function drawBorder(c: HTMLCanvasElement, edge: Pick, corner: Pick, hasCorner: boolean) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height, t = (BAND / SIZE) * W;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f2f3f5'; g.fillRect(0, 0, W, H);
  const [ei, ci] = await Promise.all([edge ? loadImage(edge.img, true).catch(() => null) : null, corner && hasCorner ? loadImage(corner.img, true).catch(() => null) : null]);
  const lw = edge ? itemLW(edge.item) : null;
  const seg = lw && lw[1] > 0 ? t * (lw[0] / lw[1]) : t * 2; // 띠 방향 타일 한 장 길이
  const band = (vertical: boolean, clip: [number, number][]) => {
    g.save();
    g.beginPath(); clip.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
    if (ei) {
      for (let s = 0; s < (vertical ? H : W); s += seg) {
        if (vertical) { g.save(); g.translate(t / 2, s + seg / 2); g.rotate(Math.PI / 2); g.drawImage(ei, -seg / 2, -t / 2, seg, t); g.restore(); }
        else g.drawImage(ei, s, 0, seg, t);
      }
    } else { g.fillStyle = '#fff'; g.fill(); }
    g.restore();
  };
  if (hasCorner) {
    band(false, [[t, 0], [W, 0], [W, t], [t, t]]);
    band(true, [[0, t], [t, t], [t, H], [0, H]]);
    g.save(); g.beginPath(); g.rect(0, 0, t, t); g.clip();
    if (ci) g.drawImage(ci, 0, 0, t, t); else { g.fillStyle = '#fff'; g.fillRect(0, 0, t, t); }
    g.restore();
  } else {
    band(false, [[0, 0], [W, 0], [W, t], [t, t]]);
    band(true, [[0, 0], [t, t], [t, H], [0, H]]);
  }
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.setLineDash([4, 3]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(t, t); g.lineTo(W, t); g.moveTo(t, t); g.lineTo(t, H);
  if (hasCorner) { g.moveTo(t, 0); g.lineTo(t, t); g.moveTo(0, t); g.lineTo(t, t); } else { g.moveTo(0, 0); g.lineTo(t, t); }
  g.stroke(); g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(0.5, 0.5, W - 1, H - 1);
  g.fillStyle = '#333'; g.font = `${Math.round(W / 26)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!ei) { g.fillText('보더 타일', (W + t) / 2, t / 2); g.fillText('보더 타일', t / 2, (H + t) / 2); }
  if (hasCorner && !ci) g.fillText('코너', t / 2, t / 2);
}

function BorderCanvas({ edge, corner, hasCorner }: { edge: Pick; corner: Pick; hasCorner: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) void drawBorder(ref.current, edge, corner, hasCorner); }, [edge, corner, hasCorner]);
  return <canvas ref={ref} width={SIZE} height={SIZE} className="cl-bd-canvas" aria-label="보더 패턴 미리보기" />;
}

const isWave = (i: Item) => i.renderCat === '보더 타일' || (i.tile?.cat ?? []).includes(3108);
/** 평붙임 타일 후보 — 쿠지알러는 타일 세부 분류(3113~3121·3127)와 바닥재·석재 일부. HP3 는 보더 타일·천장판을 뺀 타일 상품 */
const isFlat = (i: Item) => !isWave(i) && i.renderCat !== '천장판';

export function BorderPage({ tab, st, onClose, onCreate }: PageProps) {
  const tiles = itemsOf(st).filter((i) => !i.deletedAt && i.lib === TILE_LIB);
  const tree = st.trees[st.activeLibrary]?.[TILE_LIB] ?? [];
  const [name, setName] = useState('');
  const [hasCorner, setHasCorner] = useState(true);
  const [flat, setFlat] = useState(false);
  const [edge, setEdge] = useState<Pick>(null);
  const [corner, setCorner] = useState<Pick>(null);
  const [opened, setOpened] = useState<'edge' | 'corner' | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [alert, setAlert] = useState('');
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const pool = tiles.filter(flat ? isFlat : isWave);
  const toPick = (v: MatPick): Pick => { const item = tiles.find((i) => i.id === v.id); return item ? { item, img: item.img } : null; };
  const part = (p: NonNullable<Pick>): MixPart => ({ id: p.item.id, name: p.item.name, img: p.item.img });

  const submit = async () => {
    const msg = !name.trim() ? '스타일 이름을 입력하세요' : name.length > 128 ? '이름은 128자를 넘을 수 없습니다' : !edge || (hasCorner && !corner) ? '타일을 고르세요' : '';
    if (msg || !edge) { setAlert(msg); return; }
    setBusy(true);
    try {
      const c = document.createElement('canvas'); c.width = 480; c.height = 480;
      await drawBorder(c, edge, corner, hasCorner);
      const lw = itemLW(edge.item);
      onCreate([{
        name: name.trim(), lib: TILE_LIB, folder: folders[0], extraFolders: folders.length > 1 ? folders.slice(1) : undefined,
        img: c.toDataURL('image/jpeg', 0.86), renderCat: hasCorner ? '코너 있는 보더' : '코너 없는 보더', modelSize: lw ? `${lw[0]}x${lw[1]}(mm)` : '',
        border: { corner: hasCorner, flat, edge: part(edge), cornerTile: hasCorner && corner ? part(corner) : undefined },
      }], `‘${name.trim()}’ 보더 패턴을 올렸습니다`, { detail: true });
    } catch (e) { setAlert(`업로드하지 못했습니다: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  const cancel = () => confirm({ title: '업로드 취소', message: '업로드를 취소할까요?', confirmLabel: '예, 취소', onConfirm: onClose });

  return (
    <DecoShell crumbs={[tab.label, '타일 상품', '보더 패턴 업로드']} onCancel={cancel}>
      <div className="cl-ub"><div className="cl-ub-in cl-bd-in"><BorderCanvas edge={edge} corner={corner} hasCorner={hasCorner} /></div></div>
      <div className="cl-up-form">
        <ul>
          <UpRow label="스타일 이름" req><input className="inline-input cl-up-in" placeholder="소재 이름을 입력하세요" value={name} onChange={(e) => setName(e.target.value)} /></UpRow>
          <UpRow label="코너 타일" req>
            <div className="cl-bd-radios" role="radiogroup" aria-label="코너 타일">
              <label><input type="radio" name="bd-corner" checked={hasCorner} onChange={() => setHasCorner(true)} />코너 타일 있음</label>
              <label><input type="radio" name="bd-corner" checked={!hasCorner} onChange={() => { setHasCorner(false); if (opened === 'corner') setOpened(null); }} />코너 타일 없음</label>
            </div>
          </UpRow>
          <UpRow label="보더 종류" req>
            <div className="cl-bd-radios" role="radiogroup" aria-label="보더 종류">
              <label title="波打线砖"><input type="radio" name="bd-type" checked={!flat} onChange={() => { setFlat(false); setEdge(null); setCorner(null); setOpened(null); }} />보더 타일</label>
              <label title="平铺砖"><input type="radio" name="bd-type" checked={flat} onChange={() => { setFlat(true); setEdge(null); setCorner(null); setOpened(null); }} />평붙임 타일</label>
            </div>
          </UpRow>
          <UpRow label="상품 모델" req top>
            <div className="cl-mp-list">
              <MaterialPick area="보더 타일" placeholder="보더 타일" noCat value={edge ? { id: edge.item.id, name: edge.item.name, img: edge.img } : null} open={opened === 'edge'}
                onOpen={() => setOpened('edge')} onApply={(v) => { setEdge(toPick(v)); setOpened(null); }} items={pool} tree={[]} />
              {hasCorner && (
                <MaterialPick area="코너 타일" placeholder="코너 타일" noCat value={corner ? { id: corner.item.id, name: corner.item.name, img: corner.img } : null} open={opened === 'corner'}
                  onOpen={() => setOpened('corner')} onApply={(v) => { setCorner(toPick(v)); setOpened(null); }} items={pool} tree={[]} />
              )}
            </div>
          </UpRow>
          <UpRow label="소속 분류">
            <FolderChecks tree={tree} rootLabel="타일 상품" placeholder="타일 상품(미분류)" value={folders} onChange={setFolders} />
          </UpRow>
        </ul>
        <div className="cl-up-actions"><button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? '업로드 중…' : '업로드 확인'}</button></div>
      </div>
      {alert && <UpAlert msg={alert} onClose={() => setAlert('')} />}
      {confirmDialog}
    </DecoShell>
  );
}
