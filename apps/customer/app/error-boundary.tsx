"use client";

// Task 26.6 / requirement 29.1-29.5: a throwing route module must leave the shell rendering and must
// confine the failure to itself, and whatever is shown must carry a code a support conversation can
// use to find the exact occurrence.
//
// `ApiError` already carries the correlation identifier the control plane logged the request under
// (`packages/api-client`), and `views.tsx`'s mutation-feedback path already turns that into an
// `ERR-XXXXXX` code with `supportCode()`. A render error is different: it has no request behind it, so
// there is no correlation identifier to derive a code from. It still needs SOME code, or "a
// support-referenceable error code" would quietly mean "...except for the errors this boundary
// catches" -- so an uncorrelated render error gets a freshly generated identifier run through the same
// `supportCode()` alphabet. It will not match a control-plane log line, but it is still one stable
// label a person can read out and support can ask "when did you see this" against, which is strictly
// more useful than no code at all.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { ApiError, newCorrelationId, supportCode } from "@amazflow/api-client";
import { Alert, Btn } from "@amazflow/ui";

/** Exported for `error-boundary.test.tsx` only: React does not run error boundaries' catch path under
 * `renderToStaticMarkup` (only real client rendering does), so the message/code derivation is tested
 * directly rather than through a thrown-error render. */
export function describeCaughtError(error: unknown): { message: string; code: string } {
  const correlationId = error instanceof ApiError ? error.correlationId : null;
  const code = supportCode(correlationId) ?? supportCode(newCorrelationId()) ?? "ERR-UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  return { message, code };
}

type Props = {
  children?: ReactNode;
  /** The fallback confines itself to an inline panel; the application boundary takes the full page. */
  variant?: "route" | "application";
  /**
   * Changing this remounts a boundary that has already caught an error, so navigating away from a
   * broken view and back to it gets a fresh attempt rather than a permanently tripped boundary.
   */
  resetKey?: unknown;
};

type State = { error: unknown };

const CLEAR: State = { error: null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = CLEAR;

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Confined, not silent (requirement 29.2): the failure still reaches the log, it just does not
    // take the rest of the shell down with it.
    console.error("view failed to render", error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) this.setState(CLEAR);
  }

  render() {
    if (this.state.error === null) return this.props.children;

    const { message, code } = describeCaughtError(this.state.error);

    if (this.props.variant === "application")
      return (
        <div className="ops-boot" role="alert">
          <h1>Something went wrong</h1>
          <p>
            {message} ({code})
          </p>
          <Btn onClick={() => window.location.reload()}>Reload</Btn>
        </div>
      );

    return (
      <Alert tone="bad" title="This section couldn't load">
        {message} ({code})
      </Alert>
    );
  }
}
