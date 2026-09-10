"use client";

/**
 * Navigation + theme context for AmazFlow Control.
 *
 * Views never touch history directly; they call `go`, `openRun`, `openOrg` and so on. That
 * keeps every cross-entity jump consistent and makes the command palette and breadcrumbs work
 * from the same vocabulary.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { pathToView, sameView, viewToPath, type Section, type View } from "./router";

export type Theme = "light" | "dark";

type NavValue = {
  view: View;
  go: (view: View, options?: { replace?: boolean }) => void;
  goSection: (section: Section, extras?: Omit<View, "section">) => void;
  openRun: (runId: string) => void;
  openWorkflow: (workflowId: string, tab?: string) => void;
  openOrg: (slug: string, tab?: string) => void;
  openConnection: (connectionId: string) => void;
  back: () => void;

  theme: Theme;
  toggleTheme: () => void;

  /** Detail views register a human label so the breadcrumb trail can show it. */
  detailLabel: string | null;
  setDetailLabel: (label: string | null) => void;

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

const NavContext = createContext<NavValue | null>(null);

export function useNav() {
  const value = useContext(NavContext);
  if (!value) throw new Error("useNav must be used inside <NavProvider>");
  return value;
}

const THEME_KEY = "amazflow_ops_theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ section: "overview" });
  const [theme, setTheme] = useState<Theme>("light");
  const [detailLabel, setDetailLabel] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Resolve the initial view and theme on mount, after hydration, so the static export never
  // renders a mismatched tree.
  useEffect(() => {
    setView(pathToView(window.location.pathname, window.location.search));
    setTheme(initialTheme());
  }, []);

  useEffect(() => {
    const onPopState = () => setView(pathToView(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const go = useCallback((next: View, options?: { replace?: boolean }) => {
    setView((current) => {
      if (sameView(current, next)) return current;
      return next;
    });
    setDetailLabel(null);
    const path = viewToPath(next);
    if (window.location.pathname + window.location.search !== path) {
      if (options?.replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    window.scrollTo({ top: 0 });
  }, []);

  const goSection = useCallback(
    (section: Section, extras?: Omit<View, "section">) => go({ section, ...extras }),
    [go],
  );

  const value = useMemo<NavValue>(
    () => ({
      view,
      go,
      goSection,
      openRun: (runId: string) => go({ section: "runs", entityId: runId }),
      openWorkflow: (workflowId: string, tab?: string) =>
        go({ section: "workflows", entityId: workflowId, tab }),
      openOrg: (slug: string, tab?: string) => go({ section: "customers", entityId: slug, tab }),
      openConnection: (connectionId: string) => go({ section: "connections", entityId: connectionId }),
      back: () => window.history.back(),
      theme,
      toggleTheme: () =>
        setTheme((current) => {
          const next = current === "dark" ? "light" : "dark";
          try {
            window.localStorage.setItem(THEME_KEY, next);
          } catch {
            // Private browsing -- the choice just won't persist.
          }
          return next;
        }),
      detailLabel,
      setDetailLabel,
      paletteOpen,
      setPaletteOpen,
    }),
    [view, go, goSection, theme, detailLabel, paletteOpen],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** Registers the breadcrumb label for a detail view, clearing it on unmount. */
export function useDetailCrumb(label: string | null | undefined) {
  const { setDetailLabel } = useNav();
  useEffect(() => {
    setDetailLabel(label ?? null);
    return () => setDetailLabel(null);
  }, [label, setDetailLabel]);
}
