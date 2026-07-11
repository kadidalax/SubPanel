export type ThemeMode = "light" | "dark" | "system";

const KEY = "subpanel-theme";

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export function resolveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
  document.documentElement.dataset.theme = resolved;
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
}

export function cycleTheme(mode: ThemeMode): ThemeMode {
  const next: ThemeMode = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  setTheme(next);
  return next;
}

export function initTheme(): ThemeMode {
  const mode = getStoredTheme();
  applyTheme(mode);
  return mode;
}
