import { useState } from "react";
import { TABS } from "../tabs";

/** The signed-in app: the current tab and the bottom tab bar. */
export function Shell() {
  const [tabId, setTabId] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];
  return (
    <>
      <main>
        <tab.Component />
      </main>
      <nav className="tabbar" aria-label="Tabs">
        {TABS.map((t) => (
          <button key={t.id} aria-current={t.id === tab.id ? "page" : undefined} onClick={() => setTabId(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );
}
