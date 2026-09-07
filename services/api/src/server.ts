import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Approval, type Store } from "@amazflow/engine";
import { sampleWorkflow, workflowDefinitionSchema, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";
import { BedrockAiProvider } from "./bedrock-ai.js";

const workflows = new Map<string, WorkflowDefinition>([[sampleWorkflow.id, sampleWorkflow]]);
const runs = new Map<string, WorkflowRun>();
const tasks = new Map<string, AgentTask>();
const approvals = new Map<string, Approval>();
const store: Store = {
  getWorkflow: async id => workflows.get(id), saveRun: async run => { runs.set(run.id, structuredClone(run)); }, getRun: async id => runs.get(id),
  saveTask: async task => { tasks.set(task.id, task); }, saveApproval: async approval => { approvals.set(`${approval.runId}:${approval.stepId}`, approval); }
};
const ai = process.env.BEDROCK_MODEL_ID ? new BedrockAiProvider(process.env.BEDROCK_MODEL_ID) : new DemoAiProvider();
const engine = new WorkflowEngine(store, ai);
const app = new Hono();
app.use("*", cors());
app.onError((error,c)=>c.json({error:error.message},400));
app.get("/health", c => c.json({ok:true, service:"amazflow-control-plane"}));
app.get("/workflows", c => c.json([...workflows.values()]));
app.get("/workflows/:id", c => { const item=workflows.get(c.req.param("id")); return item ? c.json(item) : c.json({error:"Not found"},404); });
app.post("/workflows", async c => { const parsed=workflowDefinitionSchema.parse(await c.req.json()); workflows.set(parsed.id,parsed); return c.json(parsed,201); });
app.post("/workflows/:id/runs", async c => { const workflow=workflows.get(c.req.param("id")); if(!workflow) return c.json({error:"Not found"},404); return c.json(await engine.start(workflow, await c.req.json()),201); });
app.get("/runs", c => c.json([...runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))));
app.get("/runs/:id", c => { const item=runs.get(c.req.param("id")); return item ? c.json(item) : c.json({error:"Not found"},404); });
app.get("/agent-tasks", c => c.json([...tasks.values()].filter(t=>t.status==="PENDING")));
app.post("/agent-tasks/:id/result", async c => { const task=tasks.get(c.req.param("id")); if(!task) return c.json({error:"Not found"},404); const run=runs.get(task.runId); const workflow=run && workflows.get(run.workflowId); if(!run||!workflow) return c.json({error:"Invalid task"},400); task.status="COMPLETED"; return c.json(await engine.resumeFromAgent(workflow,run,task.stepId,await c.req.json())); });
app.post("/runs/:id/approvals/:stepId", async c => { const run=runs.get(c.req.param("id")); const workflow=run&&workflows.get(run.workflowId); if(!run||!workflow) return c.json({error:"Not found"},404); const body=await c.req.json<{approved:boolean}>(); return c.json(await engine.resumeFromApproval(workflow,run,c.req.param("stepId"),body.approved)); });

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, info => console.log(`AmazFlow API listening on http://localhost:${info.port}`));
