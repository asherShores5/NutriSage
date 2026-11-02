import { trendSegments, type TrendPoint, type YBounds } from "@nutrisage/shared";

const W = 600;
const H = 240;
const PAD = 28;

/**
 * A line chart of `points` (SVG, no chart library). No-data Days get no dot; the line bridges them
 * with a dashed segment so the trend stays connected while the gap stays visible. Today is in
 * progress: a hollow dot and a faded segment into it.
 */
export function TrendChart({ points, bounds, showMin, label }: { points: readonly TrendPoint[]; bounds: YBounds; showMin: boolean; label: string }) {
  const span = bounds.max - bounds.min || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - PAD - ((v - bounds.min) / span) * (H - 2 * PAD);

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="trend-axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
      <text className="trend-label" x={2} y={PAD}>{Math.round(bounds.max)}</text>
      {showMin && <text className="trend-label" x={2} y={H - PAD - 2}>{Math.round(bounds.min)}</text>}
      {trendSegments(points).map((s) => (
        <line
          key={points[s.to].date}
          className={`trend-line${s.bridged ? " trend-bridge" : ""}${s.inProgress ? " trend-today" : ""}`}
          x1={x(s.from)}
          y1={y(points[s.from].value!)}
          x2={x(s.to)}
          y2={y(points[s.to].value!)}
          data-bridged={s.bridged || undefined}
        />
      ))}
      {points.map((p, i) =>
        p.value !== null ? (
          <circle key={p.date} className={`trend-dot${p.inProgress ? " trend-today" : ""}`} cx={x(i)} cy={y(p.value)} r={3.5} data-date={p.date} data-value={p.value}>
            <title>{`${p.end ? `Week ${p.date} to ${p.end}, average` : p.date}: ${p.value}${p.inProgress ? " (today, in progress)" : ""}`}</title>
          </circle>
        ) : null,
      )}
      {points.length > 0 && (
        <>
          {/* Month-day, with the year too when the range crosses years (1y, All). */}
          <text className="trend-label" x={PAD} y={H - 8}>{points[0].date.slice(0, 4) === points[points.length - 1].date.slice(0, 4) ? points[0].date.slice(5) : points[0].date}</text>
          <text className="trend-label" x={W - PAD} y={H - 8} textAnchor="end">{points[points.length - 1].inProgress ? "Today" : points[points.length - 1].date.slice(5)}</text>
        </>
      )}
    </svg>
  );
}
