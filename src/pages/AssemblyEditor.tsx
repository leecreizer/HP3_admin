import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { loadParts } from '../parts/partStore';
import { loadAssembly, saveAssembly, newPlacement, type Assembly, type Placement } from '../parts/assemblyStore';
import { PartObject } from '../parts/PartObject';
import { evalExpr, buildScope } from '../parts/formula';

const MM = 0.001;
const num = (s: string, scope: Record<string, number>) => evalExpr(s, scope) ?? 0;

export function AssemblyEditor() {
  const parts = useMemo(() => loadParts(), []);
  const partMap = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const [asm, setAsm] = useState<Assembly>(loadAssembly);
  const [sel, setSel] = useState<string | null>(null);

  // localStorage 자동 저장
  useEffect(() => { saveAssembly(asm); }, [asm]);

  const asmScope = buildScope(asm.vars, {});
  // 배치별 스코프 = 조립변수 + 해당 파츠 치수(W/H/D) + 인덱스 i
  const scopeFor = (pl: Placement, i: number): Record<string, number> => {
    const p = partMap.get(pl.partId);
    return { ...asmScope, W: p?.bbox.w ?? 0, H: p?.bbox.h ?? 0, D: p?.bbox.d ?? 0, i };
  };

  const setItems = (items: Placement[]) => setAsm((a) => ({ ...a, items }));
  const setVars = (vars: Assembly['vars']) => setAsm((a) => ({ ...a, vars }));
  const addPart = (partId: string) => { const pl = newPlacement(partId); setAsm((a) => ({ ...a, items: [...a.items, pl] })); setSel(pl.id); };
  const delItem = (id: string) => { setItems(asm.items.filter((x) => x.id !== id)); if (sel === id) setSel(null); };
  const setField = (id: string, k: keyof Placement, v: string) =>
    setItems(asm.items.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const addVar = () => setVars([...asm.vars, { name: `V${asm.vars.length + 1}`, expr: '0' }]);
  const delVar = (i: number) => setVars(asm.vars.filter((_, k) => k !== i));
  const setVar = (i: number, p: Partial<{ name: string; expr: string }>) =>
    setVars(asm.vars.map((v, k) => (k === i ? { ...v, ...p } : v)));

  const th: React.CSSProperties = { textAlign: 'left', fontWeight: 600, color: 'var(--text-3)', padding: '2px 5px', fontSize: '0.7rem' };
  const td: React.CSSProperties = { padding: '1px 4px' };
  const exprIn = (id: string, k: keyof Placement) => (
    <input value={asm.items.find((x) => x.id === id)![k] as string} style={{ width: 56 }}
      onChange={(e) => setField(id, k, e.target.value)} />
  );

  return (
    <main className="main">
      <div className="page-head"><h1>조립</h1></div>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, minHeight: 560 }}>
          {/* 파츠 팔레트 */}
          <div style={{ width: 150, borderRight: '1px solid var(--line,#eee)', paddingRight: 10, overflowY: 'auto', maxHeight: 620 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>파츠 팔레트</div>
            {parts.length === 0 && <div style={{ fontSize: '0.76rem', color: '#999' }}>저장된 파츠가 없습니다. 파츠 모델러에서 먼저 만들어 저장하세요.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {parts.map((p) => (
                <button key={p.id} onClick={() => addPart(p.id)} title="클릭해서 조립에 추가"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 4, cursor: 'pointer', textAlign: 'left' }}>
                  {p.thumb ? <img src={p.thumb} width={32} height={32} alt="" style={{ borderRadius: 3 }} /> : <span style={{ width: 32 }} />}
                  <span style={{ fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3D 실시간 뷰 */}
          <div style={{ flex: 1, minHeight: 560 }}>
            <Canvas camera={{ position: [1.2, 1, 1.2], fov: 45 }} style={{ width: '100%', height: '100%', background: '#1a1c20' }}>
              <ambientLight intensity={0.6} />
              <directionalLight position={[2, 3, 2]} intensity={1} />
              <axesHelper args={[0.5]} />
              <gridHelper args={[4, 40, '#555', '#2a2a2a']} />
              <OrbitControls makeDefault />
              {asm.items.map((pl, i) => {
                const part = partMap.get(pl.partId);
                if (!part) return null;
                const sc = scopeFor(pl, i);
                const pos: [number, number, number] = [num(pl.px, sc) * MM, num(pl.py, sc) * MM, num(pl.pz, sc) * MM];
                const rot: [number, number, number] = [num(pl.rx, sc) * Math.PI / 180, num(pl.ry, sc) * Math.PI / 180, num(pl.rz, sc) * Math.PI / 180];
                return (
                  <group key={pl.id} position={pos} rotation={rot}>
                    <PartObject part={part} selected={sel === pl.id} onSelect={() => setSel(pl.id)} />
                  </group>
                );
              })}
            </Canvas>
          </div>
        </div>

        {/* 조립 변수 */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
            조립 변수 <span style={{ color: '#888', fontWeight: 400 }}>· 배치 수식에서 #이름 참조 (배치별 내장 #W/#H/#D=파츠 치수, #i=순번)</span>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead><tr><th style={th}>이름</th><th style={th}>수식</th><th style={th}>값</th><th style={th}></th></tr></thead>
            <tbody>
              {asm.vars.map((v, i) => {
                const val = asmScope[v.name.replace(/^#/, '')];
                return (
                  <tr key={i}>
                    <td style={td}><input value={v.name} style={{ width: 80 }} onChange={(e) => setVar(i, { name: e.target.value })} /></td>
                    <td style={td}><input value={v.expr} style={{ width: 130 }} onChange={(e) => setVar(i, { expr: e.target.value })} /></td>
                    <td style={{ ...td, color: val == null ? '#c33' : '#333' }}>{val == null ? '오류' : Math.round(val * 100) / 100}</td>
                    <td style={td}><button onClick={() => delVar(i)} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={addVar} style={{ marginTop: 4, fontSize: '0.8rem' }}>+ 변수 추가</button>
        </div>

        {/* 배치 목록 (위치/회전 수식) */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-2)', margin: '4px 0 6px' }}>
            배치 목록 <span style={{ color: '#888', fontWeight: 400 }}>· 위치(mm)·회전(도)에 숫자 또는 수식 (예: #gap*#i, #W/2)</span>
          </div>
          {asm.items.length === 0 && <div style={{ fontSize: '0.78rem', color: '#999' }}>팔레트에서 파츠를 클릭해 추가하세요.</div>}
          {asm.items.length > 0 && (
            <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead><tr>
                <th style={th}>파츠</th><th style={th}>X</th><th style={th}>Y</th><th style={th}>Z</th>
                <th style={th}>RX</th><th style={th}>RY</th><th style={th}>RZ</th><th style={th}></th>
              </tr></thead>
              <tbody>
                {asm.items.map((pl) => {
                  const p = partMap.get(pl.partId);
                  return (
                    <tr key={pl.id} onClick={() => setSel(pl.id)}
                      style={{ background: sel === pl.id ? 'rgba(255,179,71,0.15)' : undefined, cursor: 'pointer' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{p?.name ?? '(삭제된 파츠)'}</td>
                      <td style={td}>{exprIn(pl.id, 'px')}</td>
                      <td style={td}>{exprIn(pl.id, 'py')}</td>
                      <td style={td}>{exprIn(pl.id, 'pz')}</td>
                      <td style={td}>{exprIn(pl.id, 'rx')}</td>
                      <td style={td}>{exprIn(pl.id, 'ry')}</td>
                      <td style={td}>{exprIn(pl.id, 'rz')}</td>
                      <td style={td}><button onClick={(e) => { e.stopPropagation(); delItem(pl.id); }} style={{ color: '#c33', border: 'none', background: 'none', cursor: 'pointer' }}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}