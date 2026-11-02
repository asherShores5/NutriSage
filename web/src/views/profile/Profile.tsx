import { useEffect, useState } from "react";
import { currentUsername, listPasskeys, registerPasskey, signOut } from "../../auth";
import { isGuest, leaveGuest } from "../../session";
import { Library } from "../library/Library";
import { MealWindowsCard } from "./MealWindowsCard";
import { ThemePicker } from "./ThemePicker";

/** The Profile tab: who's signed in, Meal windows, the Library, theme, passkeys and sign out. */
export function Profile() {
  const [library, setLibrary] = useState(false);
  if (library) return <Library onClose={() => setLibrary(false)} />;
  if (isGuest()) return <GuestProfile onLibrary={() => setLibrary(true)} />;
  return (
    <div className="profile">
      <h2>Profile</h2>
      <p>Signed in as <strong>{currentUsername()}</strong></p>
      <MealWindowsCard />
      <LibraryCard onOpen={() => setLibrary(true)} />
      <ThemePicker />
      <Passkeys />
      <button onClick={() => void signOut()}>Sign out</button>
    </div>
  );
}

/** A Guest's Profile: what Guest mode means, and the way out (which deletes the Guest's data). */
function GuestProfile({ onLibrary }: { onLibrary: () => void }) {
  function leave() {
    if (confirm("Leave Guest mode? Everything you logged as a Guest is deleted from this device.")) leaveGuest();
  }
  return (
    <div className="profile">
      <h2>Profile</h2>
      <p>You're using NutriSage as a <strong>Guest</strong>.</p>
      <p className="hint">What you log stays on this device. Estimates are limited each day; typing nutrition by hand is not.</p>
      <LibraryCard onOpen={onLibrary} />
      <button className="leave-guest" onClick={leave}>Leave Guest mode</button>
    </div>
  );
}

/** The way into the Library screen (ticket 15). */
function LibraryCard({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="card" aria-labelledby="library-h">
      <h3 id="library-h">Library</h3>
      <p className="hint">{isGuest() ? "The Foods on this device." : "The Foods you both share."} Edit a name, nutrition, units or Yield ratio, or delete junk.</p>
      <button onClick={onOpen}>Open Library</button>
    </section>
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
