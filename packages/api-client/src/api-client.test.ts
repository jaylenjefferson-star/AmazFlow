// Unit tests for the shared control-plane client (task 9.3).
//
// No network and no identity provider: the transport and `fetch` are both injected, which is the
// point of the extraction. What is asserted is the behaviour that used to live in one surface and now
// has to hold for three -- exactly one refresh then one retry, a deactivated account ending the
// session rather than rendering an error, and the correlation identifier riding in both directions.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, ApiError, supportCode, newCorrelationId, type ApiSession } from "./index.ts";

const session = (over: Partial<ApiSession> = {}): ApiSession => ({
  idToken: "token-1",
  refreshToken: "refresh-1",
  tenantId: "acme",
  ...over,
});

const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function transportSpy() {
  const calls = { refresh: 0, endSession: 0, persist: 0 };
  return {
    calls,
    transport: {
      refresh: async (s: ApiSession) => {
        calls.refresh++;
        return { ...s, idToken: `token-${calls.refresh + 1}` };
      },
      endSession: async () => {
        calls.endSession++;
      },
      persist: () => {
        calls.persist++;
      },
    },
  };
}

test("a successful call returns the parsed body", async () => {
  const client = createApiClient("https://api.test", session(), transportSpy().transport, async () =>
    response(200, { ok: true, items: [1, 2] }),
  );
  const body = await client.get<{ items: number[] }>("/runs");
  assert.deepEqual(body.items, [1, 2]);
});

test("the bearer token and a correlation identifier are both sent", async () => {
  let seen: Headers | undefined;
  const client = createApiClient("https://api.test", session(), transportSpy().transport, async (_u, init) => {
    seen = new Headers((init as RequestInit).headers);
    return response(200, {});
  });
  await client.get("/me");
  assert.equal(seen?.get("authorization"), "Bearer token-1");
  assert.ok(seen?.get("x-correlation-id"), "a correlation identifier is always sent");
});

test("a 401 triggers exactly one refresh and one retry", async () => {
  const spy = transportSpy();
  let calls = 0;
  const client = createApiClient("https://api.test", session(), spy.transport, async () => {
    calls++;
    return calls === 1 ? response(401, { error: "expired" }) : response(200, { ok: true });
  });
  await client.get("/runs");
  assert.equal(spy.calls.refresh, 1, "refreshed once");
  assert.equal(calls, 2, "retried once");
  assert.equal(spy.calls.persist, 1, "the renewed session was persisted");
});

test("a second 401 after the retry ends the session rather than looping", async () => {
  const spy = transportSpy();
  let calls = 0;
  const client = createApiClient("https://api.test", session(), spy.transport, async () => {
    calls++;
    return response(401, { error: "expired" });
  });
  // The client deliberately never resolves after signing out, so race it against a timer.
  const settled = await Promise.race([
    client.get("/runs").then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("pending"), 40)),
  ]);
  assert.equal(settled, "pending", "the caller is not handed a value after sign-out");
  assert.equal(spy.calls.refresh, 1, "exactly one refresh attempt, not a loop");
  assert.equal(calls, 2, "exactly one retry");
  assert.equal(spy.calls.endSession, 1);
});

test("a deactivated account ends the session instead of throwing a permission error", async () => {
  const spy = transportSpy();
  const client = createApiClient("https://api.test", session(), spy.transport, async () =>
    response(403, { code: "ACCOUNT_DISABLED", error: "This account is disabled" }),
  );
  const settled = await Promise.race([
    client.get("/runs").then(() => "resolved"),
    new Promise((r) => setTimeout(() => r("pending"), 40)),
  ]);
  assert.equal(settled, "pending");
  assert.equal(spy.calls.endSession, 1);
});

test("an error carries the envelope's code, message and correlation identifier", async () => {
  const client = createApiClient("https://api.test", session(), transportSpy().transport, async () =>
    response(409, { error: { code: "ORG_PAUSED", message: "Runs are paused", correlationId: "abc-123" } }),
  );
  await assert.rejects(
    () => client.post("/workflows/w1/runs", {}),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "ORG_PAUSED");
      assert.equal(error.message, "Runs are paused");
      assert.equal(error.correlationId, "abc-123");
      return true;
    },
  );
});

test("the flat legacy error field is still read when there is no envelope", async () => {
  const client = createApiClient("https://api.test", session(), transportSpy().transport, async () =>
    response(400, { error: "Slug is required" }),
  );
  await assert.rejects(
    () => client.post("/organizations", {}),
    (error: unknown) => (error as ApiError).message === "Slug is required",
  );
});

test("a session without a refresh token does not attempt a refresh", async () => {
  const spy = transportSpy();
  const client = createApiClient(
    "https://api.test",
    session({ refreshToken: undefined }),
    spy.transport,
    async () => response(401, {}),
  );
  await Promise.race([client.get("/runs"), new Promise((r) => setTimeout(r, 40))]);
  assert.equal(spy.calls.refresh, 0);
  assert.equal(spy.calls.endSession, 1);
});

test("the support code is stable, readable, and free of ambiguous characters", () => {
  const id = newCorrelationId();
  const first = supportCode(id);
  assert.equal(first, supportCode(id), "the same request always yields the same code");
  assert.match(String(first), /^ERR-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$/);
  assert.equal(supportCode(null), null, "no identifier, no fabricated code");
});
