// The regression this file exists for: app.amazflow.com went live, the customer app bounced a
// signed-out visitor through https://amazflow.com/login?next=https://app.amazflow.com/, and the
// relative-only guard rejected the absolute `next` so the visitor landed on /app instead. The
// first two tests are that bug. The rest are the reason the guard cannot simply be loosened.
import test from "node:test";
import assert from "node:assert/strict";
import { isSafeNext } from "./safe-next";

test("an absolute return to a known AmazFlow surface is honoured", () => {
  assert.equal(isSafeNext("https://app.amazflow.com/"), true);
  assert.equal(isSafeNext("https://app.amazflow.com/runs/r-100/"), true);
  assert.equal(isSafeNext("https://admin.amazflow.com/"), true);
  assert.equal(isSafeNext("https://admin.amazflow.com/organizations/acme/"), true);
});

test("a same-origin relative path still works, as it did before the surfaces split", () => {
  assert.equal(isSafeNext("/console/"), true);
  assert.equal(isSafeNext("/app/"), true);
  assert.equal(isSafeNext("/console/workflows/wf-1/"), true);
});

test("an absolute destination on any other origin is refused", () => {
  assert.equal(isSafeNext("https://evil.test/"), false);
  assert.equal(isSafeNext("http://app.amazflow.com/"), false, "scheme is part of the origin -- plain http is not our surface");
});

test("hosts that merely start with an allowed origin are refused", () => {
  // A startsWith check against RETURN_ORIGINS would accept every one of these.
  assert.equal(isSafeNext("https://app.amazflow.com.evil.test/"), false);
  assert.equal(isSafeNext("https://app.amazflow.com@evil.test/"), false);
  assert.equal(isSafeNext("https://app.amazflow.com.evil.test/runs/"), false);
});

test("protocol-relative and scheme-smuggling paths are refused", () => {
  assert.equal(isSafeNext("//evil.test/"), false);
  assert.equal(isSafeNext("/\\evil.test"), true, "a backslash path is same-origin once the browser normalises it");
  assert.equal(isSafeNext("/redirect?to=https://evil.test"), false, "a relative path carrying a scheme is not the relative path it looks like");
});

test("absent, empty, and unparseable values are refused", () => {
  assert.equal(isSafeNext(null), false);
  assert.equal(isSafeNext(""), false);
  assert.equal(isSafeNext("not a url"), false);
  assert.equal(isSafeNext("javascript:alert(1)"), false);
});
