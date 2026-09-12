import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { roleSchema, type AmazFlowRole } from "@amazflow/workflow-schema";
import { departmentSchema, teamSchema, type Department, type Team } from "./departments.js";
import { opportunitySchema, type Opportunity } from "./opportunities.js";
import { buildSendToAmazFlowHandoff } from "./handoff.js";
import { parseAggregatedSession, type AggregatedSession } from "./sessions.js";
import { assertResourceTenant, resolveTenantId, type WorkIQIdentity } from "./tenant.js";

const app = new Hono();
const departments = new Map<string, Department>();
const teams = new Map<string, Team>();
const sessions = new Map<string, AggregatedSession>();
const opportunities = new Map<string, Opportunity>();

app.use("*", cors());
app.onError((error, c) =>
  error instanceof HTTPException ? error.getResponse() : c.json({ error: error.message }, 400),
);

function identity(c: Context): WorkIQIdentity {
  return {
    tenantId: c.req.header("x-amazflow-tenant") ?? "",
    userId: c.req.header("x-amazflow-user") ?? "",
    role: roleSchema.parse(c.req.header("x-amazflow-role") ?? "FRONTLINE"),
  };
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

app.get("/health", (c) => c.json({ ok: true, service: "amazflow-workiq", boundary: "separate" }));

app.get("/me", (c) => {
  const actor = identity(c);
  resolveTenantId(actor);
  return c.json(actor);
});

app.get("/departments", (c) => {
  const actor = identity(c);
  const tenantId = resolveTenantId(actor, c.req.query("tenantId"));
  return c.json([...departments.values()].filter((item) => item.tenantId === tenantId));
});

app.post("/departments", async (c) => {
  const actor = identity(c);
  const body = await c.req.json<{ name?: string; parentDepartmentId?: string; isDemo?: boolean }>();
  const now = new Date().toISOString();
  const department = departmentSchema.parse({
    id: id("department"),
    tenantId: actor.tenantId,
    name: body.name,
    parentDepartmentId: body.parentDepartmentId,
    isDemo: body.isDemo ?? false,
    createdAt: now,
    updatedAt: now,
  });
  departments.set(department.id, department);
  return c.json(department, 201);
});

app.get("/teams", (c) => {
  const actor = identity(c);
  const tenantId = resolveTenantId(actor, c.req.query("tenantId"));
  return c.json([...teams.values()].filter((item) => item.tenantId === tenantId));
});

app.post("/teams", async (c) => {
  const actor = identity(c);
  const body = await c.req.json<{
    departmentId?: string;
    name?: string;
    managerUserId?: string;
    isDemo?: boolean;
  }>();
  const department = departments.get(body.departmentId ?? "");
  if (!department) throw new HTTPException(404, { message: "Department not found" });
  assertResourceTenant(actor, department.tenantId, "department");
  const now = new Date().toISOString();
  const team = teamSchema.parse({
    id: id("team"),
    tenantId: actor.tenantId,
    departmentId: body.departmentId,
    name: body.name,
    managerUserId: body.managerUserId,
    isDemo: body.isDemo ?? false,
    createdAt: now,
    updatedAt: now,
  });
  teams.set(team.id, team);
  return c.json(team, 201);
});

app.post("/sessions", async (c) => {
  const actor = identity(c);
  const body = await c.req.json<Record<string, unknown>>();
  const session = parseAggregatedSession({
    ...body,
    id: id("session"),
    tenantId: actor.tenantId,
  });
  sessions.set(session.id, session);
  return c.json({ id: session.id, accepted: true }, 201);
});

app.get("/sessions", (c) => {
  const actor = identity(c);
  const tenantId = resolveTenantId(actor, c.req.query("tenantId"));
  const employeeId = actor.role === "SUPER_ADMIN" ? c.req.query("employeeId") : actor.userId;
  return c.json(
    [...sessions.values()].filter(
      (item) => item.tenantId === tenantId && (!employeeId || item.employeeId === employeeId),
    ),
  );
});

app.get("/opportunities", (c) => {
  const actor = identity(c);
  const tenantId = resolveTenantId(actor, c.req.query("tenantId"));
  return c.json([...opportunities.values()].filter((item) => item.tenantId === tenantId));
});

app.post("/opportunities", async (c) => {
  const actor = identity(c);
  const body = await c.req.json<Record<string, unknown>>();
  const now = new Date().toISOString();
  const opportunity = opportunitySchema.parse({
    ...body,
    id: id("opportunity"),
    tenantId: actor.tenantId,
    confirmedByUserId: actor.userId,
    confirmedAt: body.confirmedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });
  opportunities.set(opportunity.id, opportunity);
  return c.json(opportunity, 201);
});

app.post("/opportunities/:id/send-to-amazflow", (c) => {
  const actor = identity(c);
  const opportunity = opportunities.get(c.req.param("id"));
  if (!opportunity) throw new HTTPException(404, { message: "Opportunity not found" });
  assertResourceTenant(actor, opportunity.tenantId, "opportunity");
  return c.json(
    buildSendToAmazFlowHandoff({
      opportunity,
      requestedByUserId: actor.userId,
      createdAt: new Date().toISOString(),
    }),
  );
});

export { app };

if (process.env.WORKIQ_START_SERVER === "true") {
  serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4100) }, (info) =>
    console.log(`WorkIQ service listening on http://localhost:${info.port}`),
  );
}
