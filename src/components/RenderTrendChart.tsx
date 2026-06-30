import { useMemo } from 'react';

type RenderTrendChartProps = {
  done: number[];
  fail: number[];
};

const W = 640;
const H = 220;
const PL = 42;
const PR = 10;
const PT = 14;
const PB = 26;
const MAX_Y = 1400;
const FAIL_SCALE = 10; // 실패 건수가 완료 대비 너무 작아 바 높이만 확대 표시

export function RenderTrendChart({ done, fail }: RenderTrendChartProps) {
  const { gridLines, areaPath, linePath, points, failBars, xLabels } = useMemo(() => {
    const xs = (i: number) => PL + (i * (W - PL - PR)) / (done.length - 1);
    const ys = (v: number) => PT + (H - PT - PB) * (1 - v / MAX_Y);

    const gridLines = [];
    for (let v = 0; v <= MAX_Y; v += 350) {
      gridLines.push({ y: ys(v), label: v.toLocaleString() });
    }

    const linePath = done.map((v, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(v)}`).join(' ');
    const areaPath = `${linePath} L${xs(done.length - 1)},${ys(0)} L${xs(0)},${ys(0)} Z`;
    const points = done.map((v, i) => ({ x: xs(i), y: ys(v) }));
    const failBars = fail.map((v, i) => ({
      x: xs(i) - 3,
      y: ys(v * FAIL_SCALE),
      h: ys(0) - ys(v * FAIL_SCALE),
    }));

    const today = new Date();
    const xLabels = done
      .map((_, i) => {
        if (i % 2) return null;
        const d = new Date(today);
        d.setDate(d.getDate() - (done.length - 1 - i));
        return { x: xs(i), label: `${d.getMonth() + 1}/${d.getDate()}` };
      })
      .filter((l): l is { x: number; label: string } => l !== null);

    return { gridLines, areaPath, linePath, points, failBars, xLabels };
  }, [done, fail]);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="최근 14일 렌더 완료 및 실패 추이 차트">
        {gridLines.map((g) => (
          <g key={g.y}>
            <line x1={PL} y1={g.y} x2={W - PR} y2={g.y} stroke="rgba(30,42,58,0.07)" />
            <text className="axis" x={PL - 8} y={g.y + 3} textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="#1E2A3A" opacity={0.07} />
        <path d={linePath} fill="none" stroke="#1E2A3A" strokeWidth={2.2} strokeLinejoin="round" />
        {points.map((p) => (
          <circle key={p.x} cx={p.x} cy={p.y} r={2.6} fill="#1E2A3A" />
        ))}
        {failBars.map((b) => (
          <rect key={b.x} x={b.x} y={b.y} width={6} height={b.h} rx={2} fill="#C77E5E" opacity={0.8} />
        ))}
        {xLabels.map((l) => (
          <text key={l.x} className="axis" x={l.x} y={H - 8} textAnchor="middle">
            {l.label}
          </text>
        ))}
      </svg>
    </div>
  );
}