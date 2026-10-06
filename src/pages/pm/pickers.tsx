import { useMemo, useState } from 'react';
import type { Item } from '../../data/contentLibrary';
import { loadModels } from '../../pm/store';
import type { PmModel } from '../../pm/types';
import { Modal } from './ui';

/** 컨텐츠 라이브러리 상품 고르기 — 재질(재질 라이브러리) · 단면(몰딩 라이브러리) · 3D 모델 */
export function ItemPicker({ title, items, libs, filter, value, onPick, onClose, allowColor }: {
  title: string; items: Item[]; libs?: number[]; filter?: (i: Item) => boolean; value?: string;
  onPick: (id: string, item?: Item) => void; onClose: () => void; allowColor?: boolean;
}) {
  const [q, setQ] = useState('');
  const [color, setColor] = useState(/^c:[0-9a-f]{6}$/i.test(value ?? '') ? `#${value!.slice(2)}` : '#d8c5a8');
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => (!libs || libs.includes(i.lib)) && (!filter || filter(i)) && (!query || i.name.toLowerCase().includes(query) || i.code?.toLowerCase().includes(query))).slice(0, 300);
  }, [items, libs, filter, q]);
  return (
    <Modal title={title} size="mid" onClose={onClose}
      footer={<>
        {allowColor && <span className="left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          단색 <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="단색" />
          <button className="pm-btn xs" onClick={() => { onPick(`c:${color.slice(1)}`); onClose(); }}>단색으로</button>
        </span>}
        <button className="pm-btn" onClick={onClose}>취소</button>
      </>}>
      <input className="pm-in" type="search" placeholder="이름·코드 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" autoFocus />
      <div className="pm-parts" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {list.map((i) => (
          <button key={i.id} className="pm-part" style={i.id === value ? { borderColor: '#2266e8' } : undefined} onClick={() => { onPick(i.id, i); onClose(); }} title={`${i.name} (${i.id})`}>
            {i.img ? <img src={i.img} alt="" /> : <span className="noimg">▦</span>}
            <span>{i.name}</span><small>{i.code || i.id}</small>
          </button>
        ))}
      </div>
      {!list.length && <p className="pm-empty">해당 라이브러리에 상품이 없습니다. 컨텐츠 라이브러리에서 소재를 만들면 여기에 나옵니다.</p>}
    </Modal>
  );
}

/** 새 에디터 모델 고르기 — 부품 라이브러리 · 스타일 변수 · 교체 */
export function ModelPicker({ title, exclude, onPick, onClose, tool }: { title: string; exclude?: string; tool?: string; onPick: (m: PmModel) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => loadModels().filter((m) => m.id !== exclude && (!tool || m.tooltype === tool) && (!q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))), [exclude, q, tool]);
  return (
    <Modal title={title} size="mid" onClose={onClose} footer={<button className="pm-btn" onClick={onClose}>취소</button>}>
      <input className="pm-in" type="search" placeholder="모델 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색" autoFocus />
      <div className="pm-parts" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {list.map((m) => (
          <button key={m.id} className="pm-part" onClick={() => { onPick(m); onClose(); }} title={m.name}>
            {m.preview ? <img src={m.preview} alt="" /> : <span className="noimg">P</span>}
            <span>{m.name}</span><small>{m.category || '분류 없음'}</small>
          </button>
        ))}
      </div>
      {!list.length && <p className="pm-empty">저장된 모델이 없습니다.</p>}
    </Modal>
  );
}
