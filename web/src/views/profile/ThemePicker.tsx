import { useState } from "react";
import { THEMES, currentTheme, setTheme, type Theme } from "../../theme";

/** Light, dark or follow the system. Saved on this device. */
export function ThemePicker() {
  const [theme, set] = useState<Theme>(currentTheme);
  return (
    <section className="card" aria-labelledby="theme-h">
      <h3 id="theme-h">Theme</h3>
      <select aria-label="Theme" value={theme} onChange={(e) => { const t = e.target.value as Theme; setTheme(t); set(t); }}>
        {THEMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
    </section>
  );
}
