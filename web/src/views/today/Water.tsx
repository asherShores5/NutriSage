import { cupsAfterTap, cupsShown } from "./waterWeight";

/** Cups of water today against the water goal. Tap a cup to fill up to it; tap the top filled cup to undo. */
export function Water({ cups, goal, onChange }: { cups: number; goal: number; onChange: (cups: number) => void }) {
  return (
    <section className="card water" aria-labelledby="water-h">
      <div className="card-head">
        <h3 id="water-h">Water</h3>
        <span className="water-count">{cups} / {goal} cups</span>
      </div>
      <div className="cups">
        {Array.from({ length: cupsShown(cups, goal) }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`cup${i < cups ? " filled" : ""}${i >= goal ? " extra" : ""}`}
            aria-label={`Set water to ${cupsAfterTap(cups, i)} cups`}
            aria-pressed={i < cups}
            onClick={() => onChange(cupsAfterTap(cups, i))}
          >
            {i < cups ? "💧" : "○"}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" aria-label="Remove a cup" disabled={cups <= 0} onClick={() => onChange(Math.max(0, cups - 1))}>−</button>
        <button type="button" onClick={() => onChange(cups + 1)}>+ Cup</button>
      </div>
    </section>
  );
}
