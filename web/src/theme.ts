// Light, dark or system theme (Profile). The choice is per device in localStorage; public/theme.js
// applies it before first paint so there's no flash, and this module changes it at runtime.
export type Theme = "system" | "light" | "dark";
export const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
/** Keep in step with public/theme.js. */
export const THEME_KEY = "nutrisage.theme";

export function readTheme(saved: string | null | undefined): Theme {
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function currentTheme(): Theme {
  return readTheme(localStorage.getItem(THEME_KEY));
}

/** "system" follows the OS (CSS media query); light/dark force it via html[data-theme]. */
export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
