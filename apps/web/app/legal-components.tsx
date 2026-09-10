import Link from "next/link";
import type { ReactNode } from "react";
import { StandardPage } from "./site-components";

/**
 * Shared chrome for the legal documents.
 *
 * These pages were previously a single unbroken column of prose with five CSS rules between them.
 * That is a bad way to read a policy and a worse way to review one: a security questionnaire or a
 * privacy request needs to cite a specific clause, which means every section needs a stable anchor
 * and a way to get to it. So each document declares its sections once, and this renders them as a
 * numbered contents list with matching ids.
 *
 * The `summary` is deliberately not a legal instrument -- it is a plain-language framing of what
 * the document does, shown above it. The document itself governs, and says so.
 */

export type LegalSection = { id: string; title: string };

export function LegalDoc({
  title,
  effective,
  updated,
  summary,
  sections,
  children,
  footer,
}: {
  title: string;
  effective?: string;
  updated: string;
  summary?: ReactNode;
  sections: LegalSection[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <StandardPage>
      <article className="wrap legal-copy">
        <header className="legal-head">
          <div className="section-label">LEGAL</div>
          <h1>{title}</h1>
          <p className="updated">
            {effective ? `Effective ${effective} · ` : ""}
            Last updated {updated}
          </p>
          {summary && <div className="legal-summary">{summary}</div>}
        </header>

        <nav className="legal-toc" aria-label="Contents">
          <b>Contents</b>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="legal-body">{children}</div>

        <footer className="legal-foot">
          {footer}
          <p>
            AmazFlow, LLC · a Georgia limited liability company · <Link href="/legal">All legal
            documents</Link>
          </p>
        </footer>
      </article>
    </StandardPage>
  );
}

/** A numbered section with a stable anchor, so a reviewer can cite it. */
export function LegalSectionBlock({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="legal-section" id={id}>
      <h2>
        <span aria-hidden="true">{n}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A table for the places a policy is genuinely tabular -- cookies, subprocessors, retention
 * periods. Prose is the wrong shape for those, and a reviewer scanning for one row should not have
 * to read a paragraph to find it.
 */
export function LegalTable({
  caption,
  columns,
  rows,
}: {
  caption?: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="legal-table-wrap">
      <table className="legal-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Used where a document states a limit, an exclusion, or something we deliberately do not claim. */
export function LegalCallout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn";
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className="legal-callout" data-tone={tone}>
      <b>{title}</b>
      <div>{children}</div>
    </aside>
  );
}
