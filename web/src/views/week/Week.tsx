import { dateKey, lastDays, streak, weekGoals, weekKeys, weekStats } from "@nutrisage/shared";
import { Bars } from "../../components/Bars";
import { useGoals } from "../goals/useGoals";
import { useDays } from "./useDays";
import "./week.css";

/** How far back the streak looks. A longer run shows as "365+". */
export const STREAK_WINDOW = 365;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The Week tab: the logging streak, daily averages over logged Days, and the week total against goal x7. */
export function Week() {
  const today = dateKey(new Date());
  const { days, error } = useDays(lastDays(today, STREAK_WINDOW + 1)[0], today);
  const { goals } = useGoals();
  const keys = weekKeys(today);

  if (error) return <div className="week"><h2>Week</h2><p className="error" role="alert">{error}</p></div>;
  if (!days) return <div className="week"><h2>Week</h2><p className="empty">Loading…</p></div>;

  const n = streak(days, today);
  const stats = weekStats(days, today);
  return (
    <div className="week">
      <h2>Week</h2>
      <section className="card streak" aria-label="Streak">
        <div className="streak-big">{n ? `🔥 ${n >= STREAK_WINDOW ? `${STREAK_WINDOW}+` : n}` : "—"}</div>
        <p className="hint">{n ? `${n === 1 ? "day" : "days"} logged in a row. Keep it going!` : "No active streak. Log a Day to start one."}</p>
      </section>

      <section className="week-section" aria-labelledby="week-avg-h">
        <h3 id="week-avg-h">Daily average</h3>
        <p className="hint">{stats.logged ? `Averaged over ${plural(stats.logged, "logged Day")} this week.` : "No Days logged this week yet."}</p>
        <Bars label="Daily average" totals={stats.avg} goals={goals} />
      </section>

      <section className="week-section" aria-labelledby="week-total-h">
        <h3 id="week-total-h">Week total</h3>
        <p className="hint">{keys[0]} → {keys[6]}</p>
        <Bars label="Week total" totals={stats.total} goals={weekGoals(goals)} />
      </section>
    </div>
  );
}
