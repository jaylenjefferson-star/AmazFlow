# Browser Extension Security Improvements

## 🚨 Critical Issue Identified

**Problem**: The browser extension currently executes ANY task from the API without checking:
1. If the current user has permission to run that workflow
2. If the workflow is assigned to their role
3. If they created the workflow run

**Risk**: A user could potentially execute workflows they shouldn't have access to.

---

## ✅ Solution: Add Permission Checks

### Backend Changes Needed (API)

The `/agent/tasks` endpoint needs to return:
```json
{
  "id": "task-123",
  "runId": "run-456",
  "workflowId": "workflow-789",
  "operation": "CLICK",
  "input": {...},
  "expiresAt": "...",
  "assignedRoles": ["SUPER_ADMIN", "CLIENT_ADMIN"],  // NEW
  "createdBy": "user-sub-123",                        // NEW
  "tenantId": "acme-corp"                             // NEW
}
```

### Frontend Changes (Extension)

**File**: `/apps/browser-agent/src/service-worker.ts`

Add validation before executing tasks:

```typescript
// Store user info when agent connects
type AgentConfig = {
  agentToken: string;
  agentId: string;
  tenantId: string;
  userSub: string;      // NEW: User who connected the agent
  userRole: string;     // NEW: Their role (SUPER_ADMIN, CLIENT_ADMIN, FRONTLINE)
  userEmail: string;    // NEW: For logging/debugging
};

// When exchanging the auth code, also get user info
const response = await fetch(
  `${apiBase}/agent-authorizations/${code}/exchange`, 
  { method: "POST" }
);
const body = await response.json();

await chrome.storage.local.set({ 
  agentToken: body.token, 
  agentId: body.agentId, 
  tenantId: body.tenantId,
  userSub: body.userSub,          // NEW
  userRole: body.userRole,        // NEW
  userEmail: body.userEmail       // NEW
});

// When polling for tasks, validate permissions
const tasks = await fetch(`${apiBase}/agent/tasks`, {
  headers: { "X-AmazFlow-Agent-Token": agentToken }
}).then(r => r.json());

// Filter tasks user is allowed to execute
const { userSub, userRole, tenantId: myTenantId } = await getConfig();

const allowedTasks = tasks.filter((task: AgentTask) => {
  // Must be same tenant
  if (task.tenantId !== myTenantId) return false;
  
  // SUPER_ADMIN can execute anything in their tenant
  if (userRole === "SUPER_ADMIN") return true;
  
  // Others can only execute if:
  // 1. They created the run, OR
  // 2. Their role is in assignedRoles
  const canExecute = 
    task.createdBy === userSub ||
    task.assignedRoles?.includes(userRole);
  
  return canExecute;
});

const task = allowedTasks.find(t => 
  new Date(t.expiresAt).getTime() > Date.now() && 
  allowed.has(t.operation)
);
```

---

## 🔒 Additional Security Improvements

### 1. **Task Signing** (Optional but Recommended)
Sign each task with a HMAC so the extension can verify it came from your API:

```typescript
// Backend generates signature
const signature = hmac(
  secret, 
  `${taskId}:${runId}:${workflowId}:${operation}`
);

// Extension verifies before executing
const expectedSig = hmac(secret, taskData);
if (signature !== expectedSig) {
  throw new Error("Invalid task signature");
}
```

### 2. **Audit Logging**
Log every task execution attempt:

```typescript
await fetch(`${apiBase}/agent/audit`, {
  method: "POST",
  body: JSON.stringify({
    taskId: task.id,
    agentId,
    userSub,
    action: "TASK_EXECUTED",
    allowed: true,
    timestamp: new Date().toISOString()
  })
});
```

### 3. **Rate Limiting**
Limit how many tasks one agent can execute per minute:

```typescript
// Track executions in memory
const executionCounts = new Map<string, number[]>();

function canExecute(agentId: string): boolean {
  const now = Date.now();
  const recent = executionCounts.get(agentId) || [];
  
  // Remove executions older than 1 minute
  const recentOnly = recent.filter(t => now - t < 60000);
  
  if (recentOnly.length >= 10) {
    return false; // Max 10 tasks per minute
  }
  
  recentOnly.push(now);
  executionCounts.set(agentId, recentOnly);
  return true;
}
```

---

## 📋 Implementation Checklist

### Backend (API):
- [ ] Update `/agent/tasks` to include `assignedRoles`, `createdBy`, `tenantId`
- [ ] Update `/agent-authorizations/:code/exchange` to return user info
- [ ] Add task permission validation middleware
- [ ] Add audit logging for task executions
- [ ] Add rate limiting per agent

### Extension:
- [ ] Store user info when connecting agent
- [ ] Filter tasks based on user permissions
- [ ] Show warning in popup if user lacks permissions
- [ ] Add audit trail logging
- [ ] Update manifest version to 0.4.0

### Testing:
- [ ] Test SUPER_ADMIN can execute all workflows in their tenant
- [ ] Test CLIENT_ADMIN can only execute assigned workflows
- [ ] Test FRONTLINE can only execute workflows they created
- [ ] Test cross-tenant isolation (user A can't see user B's tasks)
- [ ] Test expired tasks are skipped
- [ ] Test rate limiting works

---

## 🚀 Quick Fix (Minimum Viable Security)

If you need a quick fix right now before full backend changes:

**File**: `/apps/browser-agent/src/service-worker.ts`

```typescript
// At minimum, add tenant isolation
const { tenantId: myTenantId } = await getConfig();

const tasks = await fetch(`${apiBase}/agent/tasks`, {
  headers: { "X-AmazFlow-Agent-Token": agentToken }
}).then(r => r.json());

// Only execute tasks from MY tenant
const myTasks = tasks.filter(t => t.tenantId === myTenantId);

const task = myTasks.find(t => 
  new Date(t.expiresAt).getTime() > Date.now() && 
  allowed.has(t.operation)
);
```

This at least prevents cross-tenant leakage even if permission checks aren't perfect yet.

---

## 📖 Current State

**What works**:
- ✅ Agent connects securely via OAuth-like flow
- ✅ Agent only executes on explicitly enabled sites
- ✅ Agent uses allowed operation whitelist
- ✅ Agent sends heartbeat to show it's online
- ✅ Tasks have expiration times

**What needs work**:
- ❌ No role-based permission filtering
- ❌ No workflow assignment enforcement  
- ❌ Extension executes ANY task from the API
- ❌ No audit trail of what the agent executed

---

## 🎯 Recommended Approach

1. **Phase 1** (Now): Add tenant isolation to extension
2. **Phase 2** (This week): Backend returns user permissions
3. **Phase 3** (Next week): Extension enforces permissions
4. **Phase 4** (Later): Task signing + advanced audit logging

This way you get incremental security improvements without blocking deployment.
