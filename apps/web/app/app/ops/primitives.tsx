"use client";

/**
 * AmazFlow Control primitives.
 *
 * Small, unopinionated building blocks that every operations view composes from. They own no
 * data fetching and no business rules -- that keeps the views readable and the design
 * consistent. Everything is styled by ops.css.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";
import type { Tone } from "./terms";

/* ================================================================================= pills = */

export function Pill({
  tone = "neutral",
  dot,
  plain,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  plain?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className="ops-pill" data-tone={tone} data-plain={plain ? "true" : undefined} title={title}>
      {dot && <span className="ops-pill-dot" />}
      {children}
    </span>
  );
}

export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="ops-tag" title={title}>
      {children}
    </span>
  );
}

/** A monospace identifier that copies itself on click. */
export function IdChip({ value, label, title }: { value: string; label?: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ops-idchip"
      title={title ?? `${value} — click to copy`}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => undefined,
        );
      }}
    >
      {copied ? "copied" : (label ?? value)}
    </button>
  );
}

/* =============================================================================== buttons = */

export function Btn({
  children,
  onClick,
  variant,
  size,
  disabled,
  glyph,
  title,
  type = "button",
  href,
  download,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "accent" | "ghost" | "danger";
  size?: "sm" | "lg";
  disabled?: boolean;
  glyph?: IconName;
  title?: string;
  type?: "button" | "submit";
  href?: string;
  download?: boolean;
}) {
  const inner = (
    <>
      {glyph && <Icon name={glyph} size={13} />}
      {children}
    </>
  );
  if (href) {
    return (
      <a
        className="ops-btn"
        data-variant={variant}
        data-size={size}
        href={href}
        title={title}
        download={download}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noreferrer" : undefined}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      className="ops-btn"
      data-variant={variant}
      data-size={size}
      onClick={onClick}
      disabled={disabled}
      title={title}
      type={type}
    >
      {inner}
    </button>
  );
}

export function IconBtn({
  glyph,
  onClick,
  label,
  disabled,
  size = 14,
}: {
  glyph: IconName;
  onClick?: () => void;
  label: string;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button className="ops-iconbtn" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Icon name={glyph} size={size} />
    </button>
  );
}

/** The row-affordance chevron used at the end of a clickable table row. */
export function Chevron() {
  return (
    <span className="ops-cell-chevron">
      <Icon name="chevronRight" size={13} />
    </span>
  );
}

export function LinkBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="ops-linkbtn" onClick={onClick}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="ops-kbd">{children}</span>;
}

/* ================================================================================= inputs = */

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <span className="ops-searchinput">
      <span className="ops-searchinput-glyph" aria-hidden="true">
        <Icon name="search" size={13} />
      </span>
      <input
        ref={ref}
        className="ops-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
    </span>
  );
}

export function Select({
  value,
  onChange,
  options,
  label,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  width?: number;
}) {
  return (
    <select
      className="ops-select"
      value={value}
      aria-label={label}
      style={width ? { width } : undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="ops-field">
      <span className="ops-field-label">{label}</span>
      {children}
      {hint && <span className="ops-field-hint">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="ops-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ops-switch-track" />
      <span>{label}</span>
    </label>
  );
}

/* ================================================================================= panels = */

export function Panel({
  title,
  sub,
  actions,
  children,
  flush,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="ops-panel">
      {(title || actions) && (
        <header className="ops-panel-head">
          {title && <h3>{title}</h3>}
          {sub && <span className="ops-panel-head-sub">{sub}</span>}
          {actions && <div className="ops-panel-head-actions">{actions}</div>}
        </header>
      )}
      <div className="ops-panel-body" data-flush={flush ? "true" : undefined}>
        {children}
      </div>
    </section>
  );
}

export function SectionHead({
  title,
  actions,
  rule = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  rule?: boolean;
}) {
  return (
    <div className="ops-sectionhead">
      <h2>{title}</h2>
      {rule && <span className="ops-sectionhead-rule" />}
      {actions && <div className="ops-sectionhead-actions">{actions}</div>}
    </div>
  );
}

/* ================================================================================ metrics = */

export type MetricSpec = {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: Tone;
  foot?: ReactNode;
  onClick?: () => void;
  title?: string;
};

export function Metrics({ items }: { items: MetricSpec[] }) {
  return (
    <div className="ops-metrics">
      {items.map((item, index) => {
        const body = (
          <>
            <span className="ops-metric-label">{item.label}</span>
            <span className="ops-metric-value" data-tone={item.tone}>
              {item.value}
              {item.unit && <span className="ops-metric-unit">{item.unit}</span>}
            </span>
            {item.foot && <span className="ops-metric-foot">{item.foot}</span>}
          </>
        );
        return item.onClick ? (
          <button className="ops-metric" key={index} onClick={item.onClick} title={item.title}>
            {body}
          </button>
        ) : (
          <div className="ops-metric" key={index} title={item.title}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================================= tables = */

export type Column<T> = {
  /** Stable key, also used as the sort identifier. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable. Should return a stable comparator. */
  sort?: (a: T, b: T) => number;
  align?: "left" | "right" | "center";
  width?: number | string;
  nowrap?: boolean;
  primary?: boolean;
};

/** Two-line table cell: strong first line, muted second. */
export function CellStack({ top, bottom }: { top: ReactNode; bottom?: ReactNode }) {
  return (
    <span className="ops-cell-stack">
      <b>{top}</b>
      {bottom !== undefined && bottom !== null && <span>{bottom}</span>}
    </span>
  );
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  rowTone,
  emptyState,
  loading,
  loadingRows = 6,
  defaultSort,
  maxHeight,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  rowTone?: (row: T) => Tone | undefined;
  emptyState?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  maxHeight?: number;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column?.sort) return rows;
    const comparator = column.sort;
    const next = rows.slice().sort(comparator);
    return sort.dir === "desc" ? next.reverse() : next;
  }, [rows, sort, columns]);

  // Keyboard row navigation: j/k or arrows move, Enter opens. Only when the table has focus,
  // so it never competes with the command palette or a filter input.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!onRowClick || sorted.length === 0) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      setFocusIndex((current) => Math.min(sorted.length - 1, current + 1));
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      setFocusIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && focusIndex >= 0) {
      event.preventDefault();
      onRowClick(sorted[focusIndex]);
    }
  };

  useEffect(() => {
    if (focusIndex < 0) return;
    const row = bodyRef.current?.children[focusIndex] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [focusIndex]);

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: "desc" };
      if (current.dir === "desc") return { key, dir: "asc" };
      return null;
    });
  };

  if (loading) {
    return (
      <div className="ops-tablewrap">
        <div className="ops-skelrows">
          {Array.from({ length: loadingRows }).map((_, index) => (
            <div className="ops-skelrow" key={index}>
              {columns.slice(0, 5).map((column, columnIndex) => (
                <span
                  className="ops-skeleton"
                  key={column.key}
                  style={{ flex: columnIndex === 0 ? 2 : 1, maxWidth: columnIndex === 0 ? 240 : 130 }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sorted.length === 0 && emptyState) {
    return <div className="ops-tablewrap">{emptyState}</div>;
  }

  return (
    <div className="ops-tablewrap">
      <div
        className="ops-tablescroll"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setFocusIndex(-1)}
      >
        <table className="ops-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  data-align={column.align}
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    sort?.key === column.key
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {column.sort ? (
                    <button
                      className="ops-th-sortable"
                      data-active={sort?.key === column.key ? "true" : undefined}
                      onClick={() => toggleSort(column.key)}
                    >
                      {column.header}
                      <span className="ops-th-arrow" aria-hidden="true">
                        <Icon
                          name={sort?.key === column.key && sort.dir === "asc" ? "arrowUp" : "arrowDown"}
                          size={9}
                          strokeWidth={2}
                        />
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {sorted.map((row, index) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  data-clickable={onRowClick ? "true" : undefined}
                  data-selected={selectedKey === key ? "true" : undefined}
                  data-focus={focusIndex === index ? "true" : undefined}
                  data-tone={rowTone?.(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-align={column.align}
                      data-nowrap={column.nowrap ? "true" : undefined}
                      className={column.primary ? "ops-td-primary" : undefined}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="ops-toolbar">{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ops-toolbar-spacer" />;
}

export function ResultCount({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  return (
    <span className="ops-toolbar-count">
      {shown === total ? `${total} ${noun}${total === 1 ? "" : "s"}` : `${shown} of ${total} ${noun}s`}
    </span>
  );
}

/* -------------------------------------------------------------------------- saved views --- */

export type SavedView = {
  id: string;
  label: string;
  count?: number;
  tone?: Tone;
};

export function SavedViews({
  views,
  active,
  onSelect,
}: {
  views: SavedView[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ops-views" role="group" aria-label="Saved views">
      {views.map((view) => (
        <button
          className="ops-view"
          key={view.id}
          aria-pressed={active === view.id}
          onClick={() => onSelect(view.id)}
        >
          {view.label}
          {view.count !== undefined && (
            <span className="ops-view-count" data-tone={view.tone}>
              {view.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* =================================================================================== tabs = */

export type TabSpec = {
  id: string;
  label: string;
  count?: number;
  tone?: Tone;
};

export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabSpec[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ops-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          className="ops-tab"
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="ops-tab-count" data-tone={tab.tone}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ============================================================================== key/value = */

export type KVRow = { label: string; value: ReactNode; hide?: boolean };

export function KeyValue({ rows }: { rows: KVRow[] }) {
  const visible = rows.filter((row) => !row.hide);
  return (
    <dl className="ops-kv">
      {visible.map((row) => (
        <div key={row.label} style={{ display: "contents" }}>
          <dt>{row.label}</dt>
          <dd>{row.value ?? <span className="ops-kv-empty">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/* =============================================================================== timeline = */

export type TimelineItem = {
  id: string;
  time?: string;
  timeLabel?: string;
  tone?: Tone;
  current?: boolean;
  headline: ReactNode;
  message?: ReactNode;
  facts?: { label: string; value: ReactNode }[];
  extra?: ReactNode;
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="ops-timeline">
      {items.map((item) => (
        <div className="ops-tl-row" key={item.id}>
          <span className="ops-tl-time">{item.timeLabel ?? "—"}</span>
          <span className="ops-tl-rail">
            <span
              className="ops-tl-node"
              data-tone={item.tone ?? "muted"}
              data-current={item.current ? "true" : undefined}
            />
          </span>
          <div className="ops-tl-body">
            <div className="ops-tl-headline">{item.headline}</div>
            {item.message && <div className="ops-tl-msg">{item.message}</div>}
            {item.facts && item.facts.length > 0 && (
              <div className="ops-tl-facts">
                {item.facts.map((fact) => (
                  <span className="ops-tl-fact" key={fact.label}>
                    {fact.label} <b>{fact.value}</b>
                  </span>
                ))}
              </div>
            )}
            {item.extra}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================================ step strip = */

export type StepChip = {
  id: string;
  type: string;
  glyph: IconName;
  name: string;
  meta?: string;
  state: "done" | "current" | "failed" | "pending";
  onClick?: () => void;
};

export function StepStrip({ steps }: { steps: StepChip[] }) {
  return (
    <div className="ops-steps">
      {steps.map((step) => {
        const body = (
          <>
            <span className="ops-step-top">
              <span className="ops-step-glyph">
                <Icon name={step.glyph} size={12} />
              </span>
              <span className="ops-step-type">{step.type}</span>
            </span>
            <span className="ops-step-name">{step.name}</span>
            {step.meta && <span className="ops-step-meta">{step.meta}</span>}
          </>
        );
        return step.onClick ? (
          <button className="ops-step" key={step.id} data-state={step.state} onClick={step.onClick}>
            {body}
          </button>
        ) : (
          <div className="ops-step" key={step.id} data-state={step.state}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================================= charts = */

/** Minimal area sparkline. No library, no axes -- shape only. */
export function Sparkline({ values, tone = "running" }: { values: number[]; tone?: Tone }) {
  const gradientId = useId();
  if (values.length < 2) return <div className="ops-spark" />;
  const max = Math.max(...values, 1);
  const width = 100;
  const height = 30;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 2) - 1;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const stroke =
    tone === "good" ? "var(--good)" : tone === "bad" ? "var(--bad)" : tone === "waiting" ? "var(--waiting)" : "var(--running)";
  return (
    <svg className="ops-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type BarDatum = { label: string; value: number; tone?: Tone; title?: string };

/** Vertical bar chart, used for run volume by day. */
export function BarChart({ data, axis }: { data: BarDatum[]; axis?: [string, string] }) {
  const max = Math.max(...data.map((datum) => datum.value), 1);
  return (
    <div className="ops-barchart">
      <div className="ops-bars">
        {data.map((datum, index) => (
          <span
            className="ops-bar"
            key={index}
            data-tone={datum.tone}
            title={datum.title ?? `${datum.label}: ${datum.value}`}
            style={{ height: `${Math.max(datum.value === 0 ? 1 : (datum.value / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      {axis && (
        <div className="ops-barchart-axis">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
    </div>
  );
}

export type StackSegment = { tone: Tone; value: number; label: string };

/** Horizontal stacked proportion bar, for outcome mix. */
export function StackBar({ segments }: { segments: StackSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return (
      <div className="ops-stack">
        <span className="ops-stack-seg" data-tone="muted" style={{ width: "100%" }} />
      </div>
    );
  }
  return (
    <div className="ops-stack">
      {segments
        .filter((segment) => segment.value > 0)
        .map((segment) => (
          <span
            className="ops-stack-seg"
            key={segment.label}
            data-tone={segment.tone}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
    </div>
  );
}

export function Legend({ items }: { items: { tone: Tone; label: string; value?: ReactNode }[] }) {
  return (
    <div className="ops-legend">
      {items.map((item) => (
        <span className="ops-legend-item" key={item.label}>
          <span className="ops-legend-swatch" data-tone={item.tone} />
          {item.label}
          {item.value !== undefined && <b className="ops-strong">{item.value}</b>}
        </span>
      ))}
    </div>
  );
}

export function Meter({
  value,
  tone,
  label,
}: {
  value: number;
  tone?: Tone;
  label?: ReactNode;
}) {
  return (
    <div className="ops-meter">
      {label && <div className="ops-row ops-small ops-muted">{label}</div>}
      <div className="ops-meter-track">
        <div
          className="ops-meter-fill"
          data-tone={tone}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ================================================================================ overlays = */

/** Locks background scroll and wires Escape while an overlay is open. */
function useOverlay(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

export function Drawer({
  title,
  sub,
  onClose,
  actions,
  footer,
  size,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  footer?: ReactNode;
  size?: "narrow" | "wide";
  children: ReactNode;
}) {
  useOverlay(onClose);
  return (
    <>
      <div className="ops-scrim" onClick={onClose} />
      <aside className="ops-drawer" data-size={size} role="dialog" aria-modal="true">
        <header className="ops-drawer-head">
          <div className="ops-drawer-head-text">
            <div className="ops-drawer-title">{title}</div>
            {sub && <div className="ops-drawer-sub">{sub}</div>}
          </div>
          {actions}
          <IconBtn glyph="close" label="Close" onClick={onClose} />
        </header>
        <div className="ops-drawer-body">{children}</div>
        {footer && <footer className="ops-drawer-foot">{footer}</footer>}
      </aside>
    </>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useOverlay(onClose);
  return (
    <>
      <div className="ops-scrim" onClick={onClose} />
      <div className="ops-modalwrap">
        <div className="ops-modal" role="dialog" aria-modal="true">
          <div className="ops-modal-head">
            <h2>{title}</h2>
          </div>
          <div className="ops-modal-body">{children}</div>
          {footer && <div className="ops-modal-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

/* ================================================================= empty / loading / error = */

export function EmptyState({
  glyph = "empty",
  title,
  body,
  actions,
  inline,
}: {
  glyph?: IconName;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div className="ops-empty" data-inline={inline ? "true" : undefined}>
      <span className="ops-empty-glyph" aria-hidden="true">
        <Icon name={glyph} size={16} />
      </span>
      <b>{title}</b>
      {body && <p>{body}</p>}
      {actions && <div className="ops-empty-actions">{actions}</div>}
    </div>
  );
}

export function Alert({
  tone = "neutral",
  glyph,
  title,
  children,
  actions,
}: {
  tone?: Tone;
  glyph?: IconName;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const defaultGlyph: IconName =
    tone === "bad" || tone === "waiting" ? "warning" : tone === "good" ? "check" : "info";
  return (
    <div className="ops-alert" data-tone={tone}>
      <span className="ops-alert-glyph" aria-hidden="true">
        <Icon name={glyph ?? defaultGlyph} size={13} />
      </span>
      <div className="ops-alert-body">
        {title && <b>{title}</b>}
        {title && children ? <> — {children}</> : children}
        {actions && <div className="ops-alert-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ width, height }: { width?: number | string; height?: number }) {
  return <span className="ops-skeleton" style={{ width, height }} />;
}

export function SkeletonPanel({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ops-col ops-gap-sm">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} width={index === 0 ? "45%" : index % 2 ? "82%" : "68%"} />
      ))}
    </div>
  );
}

/* ============================================================== disclosure / technical view = */

/**
 * The escape hatch for engineering detail. Operator-facing views never show raw backend
 * identifiers; they go here, behind an explicit click.
 */
export function TechnicalDetail({
  label = "Technical detail",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="ops-disclosure">
      <summary>
        <span className="ops-disclosure-arrow" aria-hidden="true">
          <Icon name="chevronRight" size={11} />
        </span>
        {label}
      </summary>
      <div className="ops-disclosure-body">{children}</div>
    </details>
  );
}

export function CodeBlock({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="ops-code">{text}</pre>;
}

/* ================================================================================= toasts = */

type Toast = { id: number; message: string; tone?: Tone };

const ToastContext = createContext<{ push: (message: string, tone?: Tone) => void }>({
  push: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone?: Tone) => {
    const id = ++counter.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="ops-toasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div className="ops-toast" key={toast.id} data-tone={toast.tone}>
              <span className="ops-toast-glyph" aria-hidden="true">
                <Icon
                  name={toast.tone === "bad" ? "warning" : toast.tone === "good" ? "check" : "info"}
                  size={13}
                />
              </span>
              <span>{toast.message}</span>
              <button
                className="ops-toast-close"
                aria-label="Dismiss"
                onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
