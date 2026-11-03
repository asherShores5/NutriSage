import { useId } from "react";
import { trendSegments, type TrendPoint, type YBounds } from "@nutrisage/shared";

const W = 600;
const H = 240;
const PAD = 28;

/** One series and the bounds of its own axis. */
export interface ChartSeries {
  points: readonly TrendPoint[];
  bounds: YBounds;
  /** Draw the axis min label (it's implied at 0). */
  showMin: boolean;
}

/**
 * A line chart of `points` (SVG, no chart library). No-data Days get no dot; the line bridges them
 * with a dashed segment so the trend stays connected while the gap stays visible. Today is in
 * progress: a hollow dot and a faded segment into it. A goal line is drawn when `goal` falls inside
 * the bounds; with manual bounds, points outside them are clipped at the plot edge. A `second`
 * series is drawn on a right-hand axis with its own bounds, in its own color with square dots (so
 * it reads apart without color too); it shares the x positions, as both follow the same range.
 */
export function TrendChart({ points, bounds, showMin, goal = null, label, second = null, secondName = "" }: {
  points: readonly TrendPoint[];
  bounds: YBounds;
  showMin: boolean;
  goal?: number | null;
  label: string;
  second?: ChartSeries | null;
  /** The second metric's label, for its dots' tooltips. */
  secondName?: string;
}) {
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, points.length - 1);
  const yFor = (b: YBounds) => (v: number) => H - PAD - ((v - b.min) / (b.max - b.min || 1)) * (H - 2 * PAD);
  const y = yFor(bounds);
  const clip = `trend-clip${useId().replace(/[^\w-]/g, "")}`;
  const goalShown = goal !== null && goal >= bounds.min && goal <= bounds.max;
  const tip = (p: TrendPoint) => `${p.end ? `Week ${p.date} to ${p.end}, average` : p.date}: ${p.value}${p.inProgress ? " (today, in progress)" : ""}`;

  return (
    <svg className={`trend-chart${second ? " trend-overlay" : ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line className="trend-axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
      <text className="trend-label trend-label-primary" x={2} y={PAD}>{Math.round(bounds.max)}</text>
      {showMin && <text className="trend-label trend-label-primary" x={2} y={H - PAD - 2}>{Math.round(bounds.min)}</text>}
      <clipPath id={clip}>
        <rect x={0} y={PAD - 6} width={W} height={H - 2 * PAD + 12} />
      </clipPath>
      {goalShown && (
        <g className="trend-goal" data-goal={goal}>
          <line x1={PAD} y1={y(goal)} x2={W - PAD} y2={y(goal)} />
          <text className="trend-label" x={PAD + 2} y={y(goal) - 5}>{`Goal ${Math.round(goal * 10) / 10}`}</text>
        </g>
      )}
      <g clipPath={`url(#${clip})`}>
        <Line points={points} x={x} y={y} tip={tip} />
      </g>
      {second && (
        <g className="trend-second">
          <text className="trend-label" x={W - 2} y={PAD} textAnchor="end">{Math.round(second.bounds.max)}</text>
          {second.showMin && <text className="trend-label" x={W - 2} y={H - PAD - 2} textAnchor="end">{Math.round(second.bounds.min)}</text>}
          <g clipPath={`url(#${clip})`}>
            <Line points={second.points} x={x} y={yFor(second.bounds)} square tip={(p) => `${secondName} ${tip(p)}`} />
          </g>
        </g>
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

/** One series' segments and dots: circles for the primary, squares for the second. */
function Line({ points, x, y, square = false, tip }: {
  points: readonly TrendPoint[];
  x: (i: number) => number;
  y: (v: number) => number;
  square?: boolean;
  tip: (p: TrendPoint) => string;
}) {
  return (
    <>
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
      {points.map((p, i) => {
        if (p.value === null) return null;
        const cx = x(i);
        const cy = y(p.value);
        const props = { className: `trend-dot${p.inProgress ? " trend-today" : ""}`, "data-date": p.date, "data-value": p.value };
        const title = <title>{tip(p)}</title>;
        return square
          ? <rect key={p.date} {...props} x={cx - 3.5} y={cy - 3.5} width={7} height={7}>{title}</rect>
          : <circle key={p.date} {...props} cx={cx} cy={cy} r={3.5}>{title}</circle>;
      })}
    </>
  );
}
