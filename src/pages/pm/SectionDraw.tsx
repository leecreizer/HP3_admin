import { useMemo, useRef, useState } from 'react';
import type { ProfileShape } from '../../data/contentLibrary';
import { profileThumb } from '../../data/dxf';
import { sectionContext, sectionShape, sectionStartPath } from '../../pm/sections';
import { ProfileEditor } from './ProfileEditor';
import { Modal } from './ui';
import './pm.css';

/**
 * 단면 그리기 — CAD(DXF) 없이 몰딩 단면을 그려 바로 몰딩 상품으로 만든다.
 * 윤곽 편집기(단면 모드: 몰딩 단면 템플릿·점 찍어 그리기·직각 스냅·원호·둥근 모서리·모따기·300mm 몰딩 3D 미리보기)로 그리고,
 * 저장하면 단면 크기·모양을 보여 주며 이름을 정한다. ‘다시 그리기’는 방금 그린 단면을 이어서 고친다.
 */
export function SectionDraw({ init, defaultName, onDone, onClose }: {
  /** 고칠 단면 — 그린 경로(path) 또는 DXF 단면 점(points) */
  init?: { path?: string; points?: [number, number][] };
  defaultName?: string;
  onDone: (name: string, shape: ProfileShape) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState(() => sectionStartPath(init));
  const ctx = useMemo(() => sectionContext(path), [path]);
  const saved = useRef<ProfileShape | null>(null);
  const [shape, setShape] = useState<ProfileShape | null>(null);
  const [name, setName] = useState('');

  if (shape) {
    return (
      <Modal title="단면 이름" sub={`단면 ${shape.w} × ${shape.h} mm · 점 ${shape.points.length}개`} onClose={onClose}
        footer={<>
          <button className="pm-btn" onClick={() => { saved.current = null; setShape(null); }}>다시 그리기</button>
          <button className="pm-primary" disabled={!name.trim()} onClick={() => onDone(name.trim(), shape)}>몰딩 단면 만들기</button>
        </>}>
        <div className="pm-sec-done">
          <img src={profileThumb(shape)} alt="그린 단면" />
          <div className="pm-field"><label htmlFor="pm-sec-name">이름</label>
            <input id="pm-sec-name" className="pm-in" value={name} autoFocus maxLength={128} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onDone(name.trim(), shape); }} />
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <ProfileEditor ev={ctx.ev} node={ctx.node} param="section" kind="line" closedDefault title="단면 그리기" section
      onValidate={(v) => { try { sectionShape(v); return null; } catch (e) { return (e as Error).message; } }}
      onSave={(v) => { saved.current = sectionShape(v); setPath(v); }}
      onClose={() => {
        const s = saved.current;
        if (!s) { onClose(); return; }
        setName((n) => n || defaultName || `그린 단면 ${s.w}×${s.h}`);
        setShape(s);
      }} />
  );
}
