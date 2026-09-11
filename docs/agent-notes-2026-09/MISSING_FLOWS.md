# Superseded — historical missing-flows analysis

> This September 2026 snapshot is retained as historical context only. Its agent-authorization
> finding is false for the current product: browser agents self-authenticate through the supported
> authorization-code exchange. Do not use this file to prioritize work. The current implementation
> plan is `.kiro/specs/platform-restructure/tasks.md`; honesty-remediation status is recorded in
> `docs/HONESTY_REMEDIATIONS.md`.

# AmazFlow - Missing Flows & Gaps Analysis

## Critical Missing Features

### 1. **Agent Authorization Flow** ❌
- **Location**: `/app/agent-authorize/`
- **Issue**: The Chrome extension mentions "Connect to AmazFlow" but the authorization page doesn't exist
- **Impact**: Users cannot actually connect their browser agent
- **Required**: OAuth-like flow to authorize agent with session token

### 2. **Password Reset Flow** ⚠️
- **Location**: `/forgot-password/`, `/reset-password/`
- **Issue**: Routes exist but may be incomplete
- **Required**: Full email verification + password reset

### 3. **Customer Console - Workflow Submission** ⚠️
- **Issue**: Frontend expects `description` field but workflow input schemas are generic
- **Required**: Proper input form for each workflow type

### 4. **Approval Decision UI** ✓ (Exists but could be improved)
- **Location**: Console run-detail shows approval UI
- **Status**: Working but basic

### 5. **Team Management** ⚠️
- **Issue**: Team screen exists but enable/disable functionality may not be fully wired
- **Required**: Complete user invite flow

### 6. **Support Ticket Submission** ❌
- **Issue**: Support panel says "there is no customer-facing submit a ticket surface"
- **Required**: Customer-facing support form

### 7. **Organization Branding** ⚠️
- **Issue**: Organization has branding fields but no UI to configure them
- **Required**: Settings page for client branding (logo, colors, custom messages)

### 8. **Browser Agent Setup** ⚠️
- **Issue**: README says "copy token from DevTools" but should be seamless
- **Required**: One-click agent authorization

### 9. **Workflow Analytics** ❌
- **Issue**: No time savings, cost analysis, or ROI tracking
- **Required**: Dashboard with actual metrics

### 10. **Error Handling & Notifications** ⚠️
- **Issue**: Limited user feedback for errors
- **Required**: Toast notifications, better error boundaries

## Medium Priority

### 11. **Workflow Versioning UI**
- Can create versions but no diff view or rollback

### 12. **Audit Log Filtering**
- Audit panel shows events but no search/filter

### 13. **Bulk Operations**
- No way to cancel/retry multiple runs

### 14. **Email Notifications**
- No email alerts for approvals or failures

### 15. **API Documentation**
- No developer docs for the REST API

## Low Priority but Mentioned

### 16. **Connections Management**
- Gmail, M365, HRIS marked as "planned"

### 17. **Mobile Optimization**
- Responsive CSS exists but needs UX refinement

### 18. **Keyboard Shortcuts**
- Power user features

## Immediate Action Items

1. **Create Agent Authorization Page** - Highest priority
2. **Complete Password Reset Flow** - Security critical
3. **Add Support Ticket Form** - Customer experience
4. **Improve Error Handling** - UX polish
5. **Create Workflow Input Forms** - Core functionality

---

## Notes
- Most backend APIs seem to exist
- Frontend is 70% complete
- Biggest gaps are in onboarding/setup flows
- Core workflow execution works well
