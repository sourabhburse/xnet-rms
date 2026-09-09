import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

function getInitial(): Theme {
  try {
    const saved = localStorage.getItem("xnet-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitial);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("xnet-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return { theme, setTheme, toggle };
}
