import test from "node:test";
import assert from "node:assert/strict";
import { app } from "./server.js";

const headers = {
  "content-type": "application/json",
  "x-amazflow-tenant": "tenant-a",
  "x-amazflow-user": "employee-a",
  "x-amazflow-role": "FRONTLINE",
};

test("session ingest derives tenant from identity instead of request body", async () => {
  const response = await app.request("/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenantId: "tenant-b",
      employeeId: "employee-a",
      applicationOrDomain: "salesforce.com",
      startedAt: "2026-09-11T10:00:00.000Z",
      endedAt: "2026-09-11T10:15:00.000Z",
      activeMinutes: 14,
      idleMinutes: 1,
      switchCount: 3,
    }),
  });
  assert.equal(response.status, 201);

  const listed = await app.request("/sessions", { headers });
  assert.equal(listed.status, 200);
  const body = (await listed.json()) as Array<{ tenantId: string }>;
  assert.equal(body.at(-1)?.tenantId, "tenant-a");
});

test("ordinary identities cannot request another tenant's records", async () => {
  const response = await app.request("/sessions?tenantId=tenant-b", { headers });
  assert.equal(response.status, 400);
  assert.match(await response.text(), /may not resolve records/);
});

test("approved opportunity handoff is narrow and tenant-scoped", async () => {
  const create = await app.request("/opportunities", {
    method: "POST",
    headers,
    body: JSON.stringify({
      classificationId: "classification-1",
      title: "Repeatable invoice lookup",
      summary: "A confirmed repeated sequence is ready for review.",
      estimatedMinutesSavedPerWeek: 45,
      status: "approved",
    }),
  });
  assert.equal(create.status, 201);
  const opportunity = (await create.json()) as { id: string };

  const handoff = await app.request(`/opportunities/${opportunity.id}/send-to-amazflow`, {
    method: "POST",
    headers,
  });
  assert.equal(handoff.status, 200);
  assert.deepEqual(Object.keys(await handoff.json()).sort(), [
    "createdAt",
    "estimatedMinutesSavedPerWeek",
    "opportunityId",
    "requestedByUserId",
    "summary",
    "tenantId",
    "title",
  ]);
});
