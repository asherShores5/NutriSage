import type { TrendPoint, YBounds } from "@nutrisage/shared";

const W = 600;
const H = 240;
const PAD = 28;

/**
 * A line chart of `points` (SVG, no chart library). The line lifts across null points (gaps) and
 * dots mark values above 0, as the old canvas chart did.
 */
export function TrendChart({ points, bounds, showMin, label }: { points: readonly TrendPoint[]; bounds: YBounds; showMin: boolean; label: string }) {
  const span = bounds.max - bounds.min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - PAD - ((v - bounds.min) / span) * (H - 2 * PAD);

  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) return void (pen = false);
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
  });

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="trend-axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
      <text className="trend-label" x={2} y={PAD}>{Math.round(bounds.max)}</text>
      {showMin && <text className="trend-label" x={2} y={H - PAD - 2}>{Math.round(bounds.min)}</text>}
      {d && <path className="trend-line" d={d} />}
      {points.map((p, i) =>
        p.value !== null && p.value > 0 ? (
          <circle key={p.date} className="trend-dot" cx={x(i)} cy={y(p.value)} r={3.5} data-date={p.date} data-value={p.value}>
            <title>{`${p.date}: ${p.value}`}</title>
          </circle>
        ) : null,
      )}
      {points.length > 0 && (
        <>
          <text className="trend-label" x={PAD} y={H - 8}>{points[0].date.slice(5)}</text>
          <text className="trend-label" x={W - PAD} y={H - 8} textAnchor="end">{points[points.length - 1].date.slice(5)}</text>
        </>
      )}
    </svg>
  );
}
