import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@nutrisage/shared";
import { changePassword, currentUsername } from "../../auth";

/** Swap the one-time password for one the Member picks (it stays the backup to their passkeys). */
export function PasswordCard() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(undefined);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(next, confirm, current);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      await changePassword(current, next);
      close();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card password" aria-labelledby="password-h">
      <h3 id="password-h">Password</h3>
      {done && <p role="status">Password changed. Use the new one next time you sign in with a password.</p>}
      {!open ? (
        <>
          <p className="hint">Replace the one-time password you were given with one only you know.</p>
          <button onClick={() => { setDone(false); setOpen(true); }}>Change password</button>
        </>
      ) : (
        <form className="password-form" onSubmit={submit}>
          {/* Lets a password manager tie the new password to this account. */}
          <input type="text" autoComplete="username" value={currentUsername() ?? ""} readOnly hidden />
          <input type="password" autoComplete="current-password" placeholder="Current password" aria-label="Current password"
            value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="New password" aria-label="New password"
            value={next} onChange={(e) => setNext(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="New password again" aria-label="New password again"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <p className="hint">At least {PASSWORD_MIN_LENGTH} characters, with a lowercase letter, an uppercase letter and a number.</p>
          <div className="password-actions">
            <button className="primary" disabled={busy || !current || !next || !confirm}>Save new password</button>
            <button type="button" disabled={busy} onClick={close}>Cancel</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
