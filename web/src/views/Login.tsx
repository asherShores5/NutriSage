import { useState } from "react";
import { lastUsername, signInWithPasskey, signInWithPassword } from "../auth";
import { enterGuest } from "../session";

/**
 * Sign-in: a passkey first (Face ID on iPhone; iCloud Keychain or a phone QR on desktop), with the
 * password one tap away as the backup and for a Member's first sign-in.
 */
export function Login() {
  const [username, setUsername] = useState(lastUsername() ?? "");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(e: React.FormEvent, signIn: () => Promise<void>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function switchTo(password: boolean) {
    setUsePassword(password);
    setPassword("");
    setError(undefined);
  }

  return (
    <form className="login" onSubmit={(e) => run(e, () => (usePassword ? signInWithPassword(username, password) : signInWithPasskey(username)))}>
      <h1>NutriSage</h1>
      <input autoComplete={usePassword ? "username" : "username webauthn"} placeholder="Username" aria-label="Username" value={username}
        onChange={(e) => setUsername(e.target.value)} autoFocus={!username} autoCapitalize="none" />
      {usePassword ? (
        <>
          <input type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button className="primary" disabled={busy || !username.trim() || !password}>Sign in with password</button>
          <button type="button" className="link" onClick={() => switchTo(false)}>Use a passkey instead</button>
        </>
      ) : (
        <>
          <button className="primary" disabled={busy || !username.trim()}>Sign in with passkey</button>
          <p className="hint">Face ID on iPhone. On a computer, use its passkey or scan the QR code with your phone.</p>
          <button type="button" className="link" onClick={() => switchTo(true)}>Use password instead</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="guest-entry">
        <button type="button" onClick={enterGuest}>Try it as a Guest</button>
        <p className="hint">No sign-in. Demo Days to start with; what you log stays on this device.</p>
      </div>
    </form>
  );
}
