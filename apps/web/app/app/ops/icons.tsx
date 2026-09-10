"use client";

/**
 * AmazFlow Control icon set.
 *
 * Inline SVG rather than a font or an icon dependency: decorative Unicode glyphs render as tofu
 * on any system without the right font coverage, and a webfont is another blocking request on a
 * console that should feel instant. Every icon is a 16x16 viewBox, 1.5px stroke, currentColor,
 * so it inherits text colour and optical weight from whatever it sits next to.
 */

export type IconName =
  // navigation
  | "overview"
  | "runs"
  | "approvals"
  | "attention"
  | "organizations"
  | "users"
  | "leads"
  | "workflows"
  | "studio"
  | "connections"
  | "agents"
  | "audit"
  | "support"
  | "settings"
  // ui
  | "search"
  | "refresh"
  | "sun"
  | "moon"
  | "close"
  | "chevronRight"
  | "chevronDown"
  | "plus"
  | "arrowRight"
  | "menu"
  | "external"
  | "download"
  | "power"
  | "sparkle"
  | "check"
  | "info"
  | "warning"
  | "copy"
  | "arrowUp"
  | "arrowDown"
  | "console"
  // step types / domain
  | "decision"
  | "action"
  | "branch"
  | "approval"
  | "verify"
  | "outcome"
  | "clock"
  | "empty";

const PATHS: Record<IconName, React.ReactNode> = {
  /* ------------------------------------------------------------------------ navigation --- */
  overview: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </>
  ),
  runs: (
    <>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" />
    </>
  ),
  approvals: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.6 8.2l1.7 1.7 3.2-3.6" />
    </>
  ),
  attention: (
    <>
      <path d="M8 2.4l5.6 10.2H2.4L8 2.4z" />
      <path d="M8 6.4v2.8M8 11.1v.05" />
    </>
  ),
  organizations: (
    <>
      <path d="M2.6 13.6V4.2l5-1.8v11.2M7.6 13.6h5.8V7.1l-5.8-1.6" />
      <path d="M4.6 6.6v.05M4.6 9v.05M4.6 11.4v.05M10.4 8.6v.05M10.4 11v.05" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="6" r="2.4" />
      <path d="M1.9 13.4c0-2.2 1.8-3.9 4.1-3.9s4.1 1.7 4.1 3.9" />
      <path d="M10.6 4.1a2.4 2.4 0 010 4M11.9 9.9c1.4.5 2.3 1.8 2.3 3.5" />
    </>
  ),
  leads: (
    <>
      <path d="M1.9 8.4h3.1l1 1.9h4l1-1.9h3.1" />
      <path d="M1.9 8.4l2.1-5.1h8l2.1 5.1v4.3a1 1 0 01-1 1H2.9a1 1 0 01-1-1V8.4z" />
    </>
  ),
  workflows: (
    <>
      <rect x="2.2" y="2.2" width="4.4" height="4.4" rx="1.1" />
      <rect x="9.4" y="9.4" width="4.4" height="4.4" rx="1.1" />
      <path d="M6.6 4.4h3.2a1.8 1.8 0 011.8 1.8v3.2" />
      <path d="M4.4 6.6v3.2a1.8 1.8 0 001.8 1.8h3.2" />
    </>
  ),
  studio: (
    <>
      <path d="M10.6 2.6l2.8 2.8L6 12.8l-3.4.6.6-3.4 7.4-7.4z" />
      <path d="M9.3 3.9l2.8 2.8" />
    </>
  ),
  connections: (
    <>
      <path d="M6.4 9.6L4.1 11.9a2.6 2.6 0 003.7 3.7" transform="translate(0,-2)" />
      <path d="M9.6 6.4l2.3-2.3a2.6 2.6 0 00-3.7-3.7" transform="translate(0,2)" />
      <path d="M6.1 9.9l3.8-3.8" />
    </>
  ),
  agents: (
    <>
      <rect x="1.9" y="2.6" width="12.2" height="9" rx="1.4" />
      <path d="M1.9 5.4h12.2M4 4v.05M5.9 4v.05" />
      <path d="M6 13.6h4" />
    </>
  ),
  audit: (
    <>
      <path d="M8 1.9l5 1.9v4c0 3.1-2.1 5.4-5 6.3-2.9-.9-5-3.2-5-6.3v-4l5-1.9z" />
      <path d="M5.9 7.9l1.6 1.6 2.7-3" />
    </>
  ),
  support: (
    <>
      <rect x="1.9" y="3.4" width="12.2" height="9.2" rx="1.4" />
      <path d="M2.4 4.4L8 8.9l5.6-4.5" />
    </>
  ),
  settings: (
    <>
      <path d="M2.4 4.4h11M2.4 8h11M2.4 11.6h11" />
      <circle cx="5.6" cy="4.4" r="1.5" fill="var(--surface)" />
      <circle cx="10.4" cy="8" r="1.5" fill="var(--surface)" />
      <circle cx="6.4" cy="11.6" r="1.5" fill="var(--surface)" />
    </>
  ),

  /* -------------------------------------------------------------------------------- ui --- */
  search: (
    <>
      <circle cx="7.1" cy="7.1" r="4.4" />
      <path d="M10.4 10.4l3.1 3.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M13.3 8a5.3 5.3 0 11-1.7-3.9" />
      <path d="M13.6 2.4v2.9h-2.9" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="2.9" />
      <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </>
  ),
  moon: <path d="M13.4 9.6A5.8 5.8 0 016.4 2.6a5.8 5.8 0 107 7z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chevronRight: <path d="M6.2 3.6L10.6 8l-4.4 4.4" />,
  chevronDown: <path d="M3.6 6.2L8 10.6l4.4-4.4" />,
  plus: <path d="M8 3.2v9.6M3.2 8h9.6" />,
  arrowRight: (
    <>
      <path d="M2.9 8h10.2" />
      <path d="M9.4 4.4L13.1 8l-3.7 3.6" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M8 13.1V2.9" />
      <path d="M4.4 6.6L8 2.9l3.6 3.7" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M8 2.9v10.2" />
      <path d="M4.4 9.4L8 13.1l3.6-3.7" />
    </>
  ),
  menu: <path d="M2.4 4.4h11.2M2.4 8h11.2M2.4 11.6h11.2" />,
  external: (
    <>
      <path d="M12.8 9.1v3.2a1.2 1.2 0 01-1.2 1.2H3.7a1.2 1.2 0 01-1.2-1.2V4.4a1.2 1.2 0 011.2-1.2h3.2" />
      <path d="M9.8 2.5h3.7v3.7M13.5 2.5L7.9 8.1" />
    </>
  ),
  download: (
    <>
      <path d="M8 2.4v7.6" />
      <path d="M4.9 7.1L8 10.2l3.1-3.1" />
      <path d="M2.6 12.9h10.8" />
    </>
  ),
  power: (
    <>
      <path d="M8 2.4v5" />
      <path d="M4.6 4.7a5 5 0 106.8 0" />
    </>
  ),
  sparkle: (
    <>
      <path d="M8 1.9l1.35 3.6L13 6.85l-3.65 1.35L8 11.8 6.65 8.2 3 6.85l3.65-1.35L8 1.9z" />
      <path d="M12.4 10.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55.55-1.45z" />
    </>
  ),
  check: <path d="M3.2 8.4l3.1 3.1 6.5-7" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 7.2v3.9M8 5.1v.05" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.4l5.6 10.2H2.4L8 2.4z" />
      <path d="M8 6.4v2.8M8 11.1v.05" />
    </>
  ),
  copy: (
    <>
      <rect x="5.6" y="5.6" width="8" height="8" rx="1.2" />
      <path d="M10.4 5.6V3.6a1.2 1.2 0 00-1.2-1.2H3.6a1.2 1.2 0 00-1.2 1.2v5.6a1.2 1.2 0 001.2 1.2h2" />
    </>
  ),
  console: (
    <>
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.4" />
      <path d="M6.1 2.9v10.2" />
    </>
  ),

  /* ---------------------------------------------------------------------- step types --- */
  decision: (
    <>
      <path d="M8 2.2l1.5 4.3 4.3 1.5-4.3 1.5L8 13.8l-1.5-4.3L2.2 8l4.3-1.5L8 2.2z" />
    </>
  ),
  action: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M6.6 5.4l3.6 2.6-3.6 2.6V5.4z" />
    </>
  ),
  branch: (
    <>
      <circle cx="4.4" cy="4" r="1.7" />
      <circle cx="11.6" cy="12" r="1.7" />
      <circle cx="4.4" cy="12" r="1.7" />
      <path d="M4.4 5.7v4.6M6.1 4.6h3.4a2 2 0 012 2v3.7" />
    </>
  ),
  approval: (
    <>
      <path d="M8 1.9l1.7 1.2 2.1-.2.7 2 1.7 1.3-.9 1.9.4 2.1-2 .7-1.3 1.7-2-.6-2 .6-1.3-1.7-2-.7.4-2.1L1.8 6.2 3.5 4.9l.7-2 2.1.2L8 1.9z" />
      <path d="M6 8.1l1.5 1.5 2.9-3.2" />
    </>
  ),
  verify: (
    <>
      <path d="M8 1.9l5 1.9v4c0 3.1-2.1 5.4-5 6.3-2.9-.9-5-3.2-5-6.3v-4l5-1.9z" />
      <path d="M5.9 7.9l1.6 1.6 2.7-3" />
    </>
  ),
  outcome: (
    <>
      <path d="M3.6 2.4v11.2" />
      <path d="M3.6 3.1h8.1l-1.4 2.7 1.4 2.7H3.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 4.8V8l2.3 1.6" />
    </>
  ),
  empty: <circle cx="8" cy="8" r="5.6" strokeDasharray="2.4 2" />,
};

export function Icon({
  name,
  size = 14,
  strokeWidth = 1.5,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Step-type glyph mapping, so the workflow vocabulary has one visual source of truth. */
export const STEP_ICON: Record<string, IconName> = {
  ai: "decision",
  action: "action",
  condition: "branch",
  approval: "approval",
  verify: "verify",
  end: "outcome",
};

/**
 * `⌘` only exists reliably on Apple platforms; everywhere else it is tofu. Resolve the modifier
 * label at runtime instead of shipping a broken glyph.
 */
export function modifierKeyLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad|iPod/.test(platform) ? "⌘" : "Ctrl";
}
