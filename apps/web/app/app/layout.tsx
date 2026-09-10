import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AmazFlow Control Plane",
  description: "Operate the AmazFlow execution control plane.",
};

/**
 * Resolves the console theme onto <html> during HTML parse, before the first paint.
 *
 * This is a static export, so the shipped markup carries no theme: React could only apply one
 * after hydration, which meant every load flashed the light console before switching to dark.
 * Setting the attribute here instead makes <html> the single source of truth -- the token sets
 * in ops.css key off it, so the correct theme is in effect before anything is drawn, and the
 * page background underneath the console matches rather than showing marketing cream on
 * overscroll.
 *
 * Runs only under /app, because this layout does. The customer console and marketing site are
 * light-only by design and never receive the attribute.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem("amazflow_ops_theme");var t=(s==="light"||s==="dark")?s:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- a fixed literal, no interpolation */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      {children}
    </>
  );
}
