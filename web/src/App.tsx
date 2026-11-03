import { useEffect, useState, useSyncExternalStore } from "react";
import { isSignedIn, onAuthChange } from "./auth";
import { loadConfig } from "./config";
import { isGuest, onSessionChange } from "./session";
import { Login } from "./views/Login";
import { Shell } from "./views/Shell";

export function App() {
  const [configured, setConfigured] = useState(false);
  const [configError, setConfigError] = useState<string>();
  const signedIn = useSyncExternalStore(onAuthChange, isSignedIn);
  const guest = useSyncExternalStore(onSessionChange, isGuest);

  useEffect(() => {
    loadConfig().then(() => setConfigured(true), (e) => setConfigError(String(e)));
  }, []);

  if (configError) return <div className="center">Couldn't load app config: {configError}</div>;
  if (!configured) return <div className="center">Loading…</div>;
  // A Guest gets the same screens; the api/ modules answer from this device for them.
  return signedIn || guest ? <Shell /> : <Login />;
}
