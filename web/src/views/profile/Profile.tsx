import { useEffect, useState } from "react";
import { currentUsername, listPasskeys, registerPasskey, signOut } from "../../auth";
import { MealWindowsCard } from "./MealWindowsCard";
import { ThemePicker } from "./ThemePicker";

/** The Profile tab: who's signed in, Meal windows, theme, passkeys and sign out. */
export function Profile() {
  return (
    <div className="profile">
      <h2>Profile</h2>
      <p>Signed in as <strong>{currentUsername()}</strong></p>
      <MealWindowsCard />
      <ThemePicker />
      <Passkeys />
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

const plural = (n: number) => `${n} passkey${n === 1 ? "" : "s"}`;

/** Add a passkey after a password sign-in, so later sign-ins are Face ID (or a desktop passkey). */
function Passkeys() {
  const [count, setCount] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = () => listPasskeys().then((list) => setCount(list.length), () => {});
  useEffect(() => void load(), []);

  async function add() {
    setBusy(true);
    setError(undefined);
    try {
      await registerPasskey();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card passkeys" aria-labelledby="passkeys-h">
      <h3 id="passkeys-h">Passkeys</h3>
      {count !== undefined && <p>{count ? `${plural(count)} on your account.` : "No passkeys yet."}</p>}
      <p className="hint">Add one on each device you use, so you can sign in with Face ID instead of your password. Your password still works as a backup.</p>
      <button className="primary" disabled={busy} onClick={add}>Add a passkey</button>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
