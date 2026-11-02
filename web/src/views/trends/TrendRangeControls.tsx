import { useState } from "react";
import { TREND_PRESETS, customRange, type TrendPreset, type TrendRange } from "@nutrisage/shared";

/** What the range control has picked: a preset, or a valid custom start and end. */
export type TrendRangeChoice = { preset: TrendPreset } | { custom: TrendRange };

/** The words for a choice ("Last 30 days", "2026-01-05 to 2026-02-10"). */
export function choiceLabel(choice: TrendRangeChoice): string {
  if ("custom" in choice) return `${choice.custom.from} to ${choice.custom.to}`;
  return TREND_PRESETS.find((p) => p.key === choice.preset)!.label;
}

/**
 * The Trends range row: presets (7d, 30d, 90d, 1y, All) and Custom, which shows a start and end.
 * Only a valid custom range reaches `onChange`; a bad one shows why and keeps the last good range.
 */
export function TrendRangeControls({ value, today, onChange }: { value: TrendRangeChoice; today: string; onChange: (c: TrendRangeChoice) => void }) {
  const [custom, setCustom] = useState("custom" in value);
  const [from, setFrom] = useState("custom" in value ? value.custom.from : "");
  const [to, setTo] = useState("custom" in value ? value.custom.to : today);
  const picked = customRange(from, to, today);

  const edit = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    const r = customRange(f, t, today);
    if (!("error" in r)) onChange({ custom: r });
  };

  return (
    <div className="trend-range">
      <div className="trend-presets" role="group" aria-label="Range">
        {TREND_PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={!custom && "preset" in value && value.preset === p.key} onClick={() => { setCustom(false); onChange({ preset: p.key }); }}>
            {p.key === "all" ? "All" : p.key}
          </button>
        ))}
        <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
      </div>
      {custom && (
        <div className="trend-custom">
          <label>Start <input type="date" value={from} max={today} onChange={(e) => edit(e.target.value, to)} /></label>
          <label>End <input type="date" value={to} max={today} onChange={(e) => edit(from, e.target.value)} /></label>
          {"error" in picked && <p className="hint trend-range-error" role="status">{picked.error}</p>}
        </div>
      )}
    </div>
  );
}
