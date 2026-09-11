import "./jsx-global";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiClient } from "@amazflow/api-client";
import type { Principal } from "@amazflow/permissions";
import { BROWSER_ACTIONS, DESKTOP_ACTIONS, type WorkflowDefinition } from "@amazflow/workflow-schema";
import { WorkflowWorkspace } from "./workflow-workspace";

const HERE = path.dirname(new URL(import.meta.url).pathname);

const principal: Principal = {
  kind: "user", userId: "builder", orgId: "acme", group: "CLIENT_ADMIN", role: "WORKFLOW_BUILDER", teamIds: [], isStaff: false,
};
const client: ApiClient = {
  request: async <T,>() => null as T,
  get: async <T,>() => null as T,
  post: async <T,>() => null as T,
  put: async <T,>() => null as T,
  del: async <T,>() => null as T,
  session: () => ({ idToken: "token", tenantId: "acme" }),
};

const workflow: WorkflowDefinition = {
  id: "wf_dual", tenantId: "acme", name: "Onboard a person", description: "Creates access.", version: 3, status: "draft",
  dataClass: "INTERNAL", assignedRoles: ["CLIENT_ADMIN"], startAt: "browser",
  allowedProviders: ["browser", "desktop"],
  steps: [
    { id: "browser", name: "Open the people page", type: "action", provider: "browser", executionTarget: "browser_extension", operation: "NAVIGATE", input: { url: "https://example.test/people" }, next: "desktop" },
    { id: "desktop", name: "Open the desktop app", type: "action", provider: "desktop", executionTarget: "desktop_agent", operation: "desktop.open_app", input: { app: "TextEdit" }, next: "done" },
    { id: "done", name: "Finish", type: "end", outcome: "success" },
  ],
};

test("workflow workspace states that AmazFlow publishes and derives required surfaces from steps", () => {
  const html = renderToStaticMarkup(createElement(WorkflowWorkspace, {
    workflowId: workflow.id,
    principal,
    client,
    navigate: () => {},
    refresh: async () => {},
    session: { idToken: "token", tenantId: "acme", sub: "builder", email: "builder@acme.example", expiresAt: Date.now() + 60_000 },
    slots: { workflows: { value: [workflow], state: "ready", error: null, loadedAt: new Date().toISOString() } },
  }));
  assert.match(html, /AmazFlow contact publishes this workflow/i);
  assert.doesNotMatch(html, />Publish</, "customer builders must not see a control the API refuses");
  assert.match(html, /Chrome Extension/);
  assert.match(html, /Desktop App/);
  assert.match(html, /Page address/, "browser action inputs are edited as fields");
  assert.match(html, /App name/, "desktop action inputs are edited as fields");
});

test("the customer builder covers every supported browser and desktop action vocabulary", () => {
  const source = readFileSync(path.join(HERE, "workflow-builder.tsx"), "utf8");
  for (const action of [...BROWSER_ACTIONS, ...DESKTOP_ACTIONS]) {
    const key = action.includes(".") ? '"' + action + '"' : action;
    assert.ok(source.includes(key + ":"), action + " has no field-level builder definition");
  }
  assert.match(source, /targetForProvider\(step\.provider\)/, "the builder must derive its surface from the provider");
  assert.match(source, /ACTIONS_BY_TARGET\[target\]\.includes\(step\.operation\)/, "the builder must reject an action outside that surface vocabulary");
});

test("the customer workspace sends a structured draft, never the plain-language description", () => {
  const source = readFileSync(path.join(HERE, "workflow-workspace.tsx"), "utf8");
  assert.match(source, /saveWorkflowDraft\(workflowId\)\.path, draft/, "saving must submit the structured draft");
  assert.match(source, /generateWorkflow\(\)\.path, \{ sop: sop\.trim\(\) \}/, "generation sends only the description to the generator");
});

