import test from "node:test";
import assert from "node:assert/strict";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Approval, type Store } from "./index.ts";
import { sampleWorkflow, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";

test("a configured workflow pauses for a browser agent", async () => {
  let run: WorkflowRun | undefined; let task: AgentTask | undefined;
  const store: Store = { getWorkflow: async()=>sampleWorkflow, saveRun: async v=>{run=v}, getRun: async()=>run, saveTask: async v=>{task=v}, saveApproval: async(_v:Approval)=>{} };
  const engine = new WorkflowEngine(store, new DemoAiProvider());
  const result = await engine.start(sampleWorkflow, { employee: { id: "E-100" }, request: "DISABLE" });
  assert.equal(result.status, "WAITING_AGENT");
  assert.equal(task?.operation, "SET_EMPLOYEE_STATUS");
});
