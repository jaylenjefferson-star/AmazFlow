// Task 26.6 / requirement 29.1-29.5.
//
// React only runs an error boundary's catch path (`getDerivedStateFromError`) during real client
// rendering, not under `renderToStaticMarkup` -- that is a documented React limitation, not something
// this component controls. So the two things tested separately here are the two things actually within
// this file's control: that a NON-throwing child renders straight through unaffected, and that the
// message/code the fallback would show is derived correctly from whatever the boundary catches.

import "./jsx-global";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@amazflow/api-client";
import { describeCaughtError, ErrorBoundary } from "./error-boundary";

test("a route module that does not throw renders normally, untouched by the boundary", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorBoundary, { variant: "route" }, createElement("p", null, "content")),
  );
  assert.match(html, /content/);
  assert.doesNotMatch(html, /couldn.t load/);
});

test("an ApiError's correlation identifier produces the same support code views.tsx would show", () => {
  const error = new ApiError(500, "The control plane refused this.", "INTERNAL_ERROR", "corr-fixed-id");
  const { message, code } = describeCaughtError(error);
  assert.equal(message, "The control plane refused this.");
  assert.match(code, /^ERR-[A-Z2-9]{6}$/);
  // Same correlation identifier must always yield the same code -- it is how support goes from a
  // code read out loud back to the log line.
  assert.equal(describeCaughtError(error).code, code);
});

test("a render error with no correlation identifier still carries a support-referenceable code", () => {
  const { message, code } = describeCaughtError(new Error("no request behind this"));
  assert.equal(message, "no request behind this");
  assert.match(code, /^ERR-[A-Z2-9]{6}$/);
});

test("the fallback panel displays the message and code, not a generic apology", () => {
  const instance = new ErrorBoundary({ children: null, variant: "route" });
  (instance as unknown as { state: { error: unknown } }).state = { error: new Error("boom") };
  const html = renderToStaticMarkup(instance.render() as Parameters<typeof renderToStaticMarkup>[0]);
  assert.match(html, /This section couldn/);
  assert.match(html, /t load/);
  assert.match(html, /boom/);
  assert.match(html, /\(ERR-[A-Z2-9]{6}\)/);
});

test("the application variant offers a reload rather than an inline panel", () => {
  const instance = new ErrorBoundary({ children: null, variant: "application" });
  (instance as unknown as { state: { error: unknown } }).state = { error: new Error("boom") };
  const html = renderToStaticMarkup(instance.render() as Parameters<typeof renderToStaticMarkup>[0]);
  assert.match(html, /Something went wrong/);
  assert.match(html, /Reload/);
});
