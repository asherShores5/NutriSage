import { useEffect, useState } from "react";
import { readWeight } from "./waterWeight";

/** The Day's one weigh-in: save a weight, or clear it. `label` names the Day ("Today's weight", "Yesterday's weight", "Weight on Wed, Oct 28"). */
export function Weight({ weight, label, onChange }: { weight: number | null; label: string; onChange: (weight: number | null) => void }) {
  const [text, setText] = useState(weight ? String(weight) : "");
  const [error, setError] = useState<string>();
  useEffect(() => setText(weight ? String(weight) : ""), [weight]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    const r = readWeight(text);
    if (!r.ok) return setError(r.error);
    setError(undefined);
    onChange(r.weight);
  }

  return (
    <section className="card weight" aria-labelledby="weight-h">
      <div className="card-head">
        <h3 id="weight-h">Weight</h3>
        <span className="weight-current">{weight ? weight : "Not logged"}</span>
      </div>
      <form className="row" onSubmit={save}>
        <input inputMode="decimal" aria-label={label} placeholder={label} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="primary">Save</button>
        {weight ? <button type="button" onClick={() => { setError(undefined); onChange(null); }}>Clear</button> : null}
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
