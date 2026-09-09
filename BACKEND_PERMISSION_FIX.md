# Backend Permission Check Implementation

## Security Issue
Browser extension currently executes ANY workflow in the tenant regardless of:
- User role (SUPER_ADMIN, CLIENT_ADMIN, FRONTLINE)
- Workflow assignment (assignedRoles)
- Workflow creator

## Root Cause
- Agent tokens are tenant-scoped, not user-scoped
- Multiple users can share same agent/token
- `/agent/tasks` endpoint returns all pending tasks for tenant
- No permission filtering happens in backend or extension

## Solution: User-Scoped Agent Credentials

### 1. Update Agent Authorization Flow

**Current Flow:**
```
User clicks "Connect" → Opens /agent-authorize → Creates agent code → 
Extension exchanges code → Gets tenant-scoped token
```

**New Flow:**
```
User clicks "Connect" → Opens /agent-authorize → Creates agent code WITH user context →
Extension exchanges code → Gets user-scoped token WITH role/userSub
```

### 2. Backend Changes

#### A. Update `createAgentAndCode` (line ~264)
Store the authorizing user's info in the agent code:
```javascript
const codeDoc = {
  code,
  agentId: agent.id,
  tenantId,
  userId: createdBy,        // NEW: who authorized this agent
  userRole: a.role,         // NEW: their role at authorization time
  status: 'PENDING',
  createdAt: now(),
  expiresAt: new Date(Date.now() + settings.agentCodeExpiryMs).toISOString()
};
```

#### B. Update `exchangeAgentCode` (line ~273)
Return user context to extension:
```javascript
return {
  token,
  agentId: codeDoc.agentId,
  tenantId: codeDoc.tenantId,
  userId: codeDoc.userId,          // NEW
  userRole: codeDoc.userRole        // NEW
};
```

#### C. Update agent credentials storage (line ~282)
Store user context in credentials:
```javascript
const cred = {
  agentId: codeDoc.agentId,
  tenantId: codeDoc.tenantId,
  userId: codeDoc.userId,            // NEW
  userRole: codeDoc.userRole,        // NEW
  createdAt: now(),
  status: 'active'
};
```

#### D. Update `agentAuth` (line ~288)
Return user context:
```javascript
const agentAuth = async (e) => {
  // ... existing validation ...
  return {
    agentId: cred.agentId,
    tenantId: cred.tenantId,
    userId: cred.userId,              // NEW
    userRole: cred.userRole,          // NEW
    agent
  };
};
```

### 3. Extension Changes

#### A. Update service-worker.ts
Store user info from exchange:
```typescript
const response = await fetch(`${apiBase}/agent-authorizations/${encodeURIComponent(code)}/exchange`, {
  method: "POST"
});
const body = await response.json();
if (!response.ok) throw new Error(body.error || "Exchange failed");

await chrome.storage.local.set({
  agentToken: body.token,
  agentId: body.agentId,
  tenantId: body.tenantId,
  userId: body.userId,          // NEW
  userRole: body.userRole        // NEW
});
```

#### B. Filter tasks by permissions:
```typescript
const { tenantId: myTenantId, userRole } = await chrome.storage.local.get(["tenantId", "userRole"]);

const validTasks = tasks.filter((t) => {
  // Must be from our tenant
  if (myTenantId && t.tenantId && t.tenantId !== myTenantId) return false;
  
  // Must be an allowed operation
  if (!allowed.has(t.operation)) return false;
  
  // Must not be expired
  if (new Date(t.expiresAt).getTime() <= Date.now()) return false;
  
  // Permission check: workflow must be assigned to user's role
  if (t.assignedRoles && !t.assignedRoles.includes(userRole)) return false;
  
  return true;
});
```

### 4. Task Creation (Already Fixed)
Tasks now include workflow metadata:
```javascript
const task = {
  // ... existing fields ...
  workflowId: workflow.id,
  assignedRoles: workflow.assignedRoles || [],
  createdBy: run.createdBy
};
```

### 5. Permission Matrix

| User Role     | Can Execute                                        |
|---------------|---------------------------------------------------|
| SUPER_ADMIN   | All workflows (no filtering)                      |
| CLIENT_ADMIN  | Workflows with CLIENT_ADMIN or FRONTLINE in assignedRoles |
| FRONTLINE     | Only workflows with FRONTLINE in assignedRoles    |

## Implementation Status

✅ Engine updated - AgentTask type includes workflowId, assignedRoles, createdBy
✅ Server.ts updated - passes createdBy in workflow runs
✅ Lambda updated - task creation includes workflow metadata
✅ Extension type updated - AgentTask includes new fields

⏳ Lambda agent flow - needs user context updates
⏳ Extension service worker - needs permission filtering

## Testing Plan

1. Create 3 test users (SUPER_ADMIN, CLIENT_ADMIN, FRONTLINE)
2. Create workflows with different assignedRoles:
   - Workflow A: [FRONTLINE, CLIENT_ADMIN]
   - Workflow B: [CLIENT_ADMIN]
   - Workflow C: [SUPER_ADMIN]
3. Connect extension with each user
4. Verify each user only sees/executes their assigned workflows

## Migration Notes

- Existing agent credentials will NOT have user context
- They'll continue working but won't have permission filtering
- Users need to disconnect and reconnect extension to get user-scoped tokens
- Consider adding migration to revoke old credentials
