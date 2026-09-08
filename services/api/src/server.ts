// NOT DEPLOYED. This local implementation is not connected to any AWS resource and is not
// what customers use. It exists only for local engine-logic testing. The production workflow
// engine lives entirely inside the ZipFile in infrastructure/aws-cdk/amazflow-dev.yaml.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { DemoAiProvider, WorkflowEngine, type AgentTask, type Approval, type Store } from "@amazflow/engine";
import { sampleWorkflow, workflowDefinitionSchema, roleSchema, type AmazFlowRole, type WorkflowDefinition, type WorkflowRun } from "@amazflow/workflow-schema";
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
app.onError((error,c)=>error instanceof HTTPException?error.getResponse():c.json({error:error.message},400));
type Actor = { userId:string; tenantId:string; role:AmazFlowRole };
const actor = (c:any): Actor => ({ userId:c.req.header("x-amazflow-user")??"user-demo", tenantId:c.req.header("x-amazflow-tenant")??"tenant-demo", role:roleSchema.parse(c.req.header("x-amazflow-role")??"SUPER_ADMIN") });
const requireRole = (actual:AmazFlowRole, allowed:AmazFlowRole[]) => { if(!allowed.includes(actual)) throw new HTTPException(403,{message:"This role is not permitted to perform that operation"}); };
const inTenant = (a:Actor, tenantId:string) => a.role==="SUPER_ADMIN" || a.tenantId===tenantId;
app.get("/health", c => c.json({ok:true, service:"amazflow-control-plane"}));
app.get("/me", c => c.json(actor(c)));
app.get("/workflows", c => { const a=actor(c); return c.json([...workflows.values()].filter(w=>inTenant(a,w.tenantId) && (a.role!=="FRONTLINE" || w.assignedRoles.includes("FRONTLINE")))); });
app.get("/workflows/:id", c => { const a=actor(c); const item=workflows.get(c.req.param("id")); return item&&inTenant(a,item.tenantId)&&(a.role!=="FRONTLINE"||item.assignedRoles.includes("FRONTLINE")) ? c.json(item) : c.json({error:"Not found"},404); });
app.post("/workflows", async c => { const a=actor(c); requireRole(a.role,["SUPER_ADMIN"]); const parsed=workflowDefinitionSchema.parse(await c.req.json()); workflows.set(parsed.id,parsed); return c.json(parsed,201); });
app.post("/workflows/:id/runs", async c => { const a=actor(c); const workflow=workflows.get(c.req.param("id")); if(!workflow||!inTenant(a,workflow.tenantId)||(a.role==="FRONTLINE"&&!workflow.assignedRoles.includes("FRONTLINE"))) return c.json({error:"Not found or not assigned"},404); const input=await c.req.json<Record<string,unknown>>(); return c.json(await engine.start(workflow,{...input,_actor:{userId:a.userId,role:a.role}}),201); });
app.get("/runs", c => { const a=actor(c); return c.json([...runs.values()].filter(r=>inTenant(a,r.tenantId)&&(a.role!=="FRONTLINE"||(r.context.input as any)?._actor?.userId===a.userId)).sort((x,y)=>y.createdAt.localeCompare(x.createdAt))); });
app.get("/runs/:id", c => { const a=actor(c); const item=runs.get(c.req.param("id")); const owned=(item?.context.input as any)?._actor?.userId===a.userId; return item&&inTenant(a,item.tenantId)&&(a.role!=="FRONTLINE"||owned) ? c.json(item) : c.json({error:"Not found"},404); });
app.get("/agent-tasks", c => { const a=actor(c); requireRole(a.role,["CLIENT_ADMIN","SUPER_ADMIN"]); return c.json([...tasks.values()].filter(t=>t.status==="PENDING"&&inTenant(a,t.tenantId))); });
app.post("/agent-tasks/:id/result", async c => { const task=tasks.get(c.req.param("id")); if(!task) return c.json({error:"Not found"},404); const run=runs.get(task.runId); const workflow=run && workflows.get(run.workflowId); if(!run||!workflow) return c.json({error:"Invalid task"},400); task.status="COMPLETED"; return c.json(await engine.resumeFromAgent(workflow,run,task.stepId,await c.req.json())); });
app.post("/runs/:id/approvals/:stepId", async c => { const a=actor(c); requireRole(a.role,["CLIENT_ADMIN","SUPER_ADMIN"]); const run=runs.get(c.req.param("id")); const workflow=run&&workflows.get(run.workflowId); if(!run||!workflow||!inTenant(a,run.tenantId)) return c.json({error:"Not found"},404); const body=await c.req.json<{approved:boolean}>(); return c.json(await engine.resumeFromApproval(workflow,run,c.req.param("stepId"),body.approved)); });

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) }, info => console.log(`AmazFlow API listening on http://localhost:${info.port}`));
