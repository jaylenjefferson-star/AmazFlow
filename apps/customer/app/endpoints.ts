// Every control-plane path this surface writes to, in one table, each carrying the route-inventory
// key it targets.
//
// Task 1.1 committed a route inventory and gated the build on it, so a handler cannot grow a route
// the fixture does not know about. The frontend had no equivalent: a view could `client.post()` a path
// that no route serves, and nothing failed until a person clicked the button. That is not a
// theoretical failure — `/tenants/{t}/users/{username}/role` did not exist until Phase 4 (H-8), and a
// role-change control written against it before then would have compiled, typechecked, rendered, and
// returned 404 to whoever tried to use it.
//
// So each entry names its inventory route, and `endpoints.test.ts` asserts two things per entry:
// that the route exists in the committed inventory under that exact method, and that the path the
// builder produces MATCHES that route's template segment for segment. The second half is what catches
// a builder that quietly drops a path segment while still pointing at a real route.
//
// Reads live in `customerResourceSpecs` (routes.ts) and are checked by the same test against the same
// inventory, so a read and a write cannot diverge in how honestly they are pinned.

const e = encodeURIComponent;

export type Endpoint = { route: string; path: string };

/** The organization's own record. The slug IS the tenant identifier and is immutable (task 11.2). */
export const orgProfile = (slug: string): Endpoint => ({
  route: "POST /organizations/{slug}/profile",
  path: `/organizations/${e(slug)}/profile`,
});
export const orgSettings = (slug: string): Endpoint => ({
  route: "POST /organizations/{slug}/settings",
  path: `/organizations/${e(slug)}/settings`,
});
export const orgBranding = (slug: string): Endpoint => ({
  route: "POST /organizations/{slug}/branding",
  path: `/organizations/${e(slug)}/branding`,
});

/** People. Every one of these is organization-scoped by the path parameter and re-checked server-side. */
export const inviteUser = (orgId: string): Endpoint => ({
  route: "POST /tenants/{tenantId}/users",
  path: `/tenants/${e(orgId)}/users`,
});
export const setUserRole = (orgId: string, username: string): Endpoint => ({
  route: "POST /tenants/{tenantId}/users/{username}/role",
  path: `/tenants/${e(orgId)}/users/${e(username)}/role`,
});
export const resendInvitation = (orgId: string, username: string): Endpoint => ({
  route: "POST /tenants/{tenantId}/users/{username}/invitation/resend",
  path: `/tenants/${e(orgId)}/users/${e(username)}/invitation/resend`,
});
/** DELETE, and it disables rather than deletes — attribution on historical audit records survives. */
export const revokeInvitation = (orgId: string, username: string): Endpoint => ({
  route: "DELETE /tenants/{tenantId}/users/{username}/invitation",
  path: `/tenants/${e(orgId)}/users/${e(username)}/invitation`,
});
export const setUserStatus = (orgId: string, username: string): Endpoint => ({
  route: "POST /tenants/{tenantId}/users/{username}/status",
  path: `/tenants/${e(orgId)}/users/${e(username)}/status`,
});

/** Teams. Scoped from the session rather than from a path parameter, so no organization id appears. */
export const createTeam = (): Endpoint => ({ route: "POST /teams", path: "/teams" });
export const renameTeam = (id: string): Endpoint => ({
  route: "PUT /teams/{id}",
  path: `/teams/${e(id)}`,
});
export const deleteTeam = (id: string): Endpoint => ({
  route: "DELETE /teams/{id}",
  path: `/teams/${e(id)}`,
});
export const addTeamMember = (id: string): Endpoint => ({
  route: "POST /teams/{id}/members",
  path: `/teams/${e(id)}/members`,
});
export const removeTeamMember = (id: string, username: string): Endpoint => ({
  route: "DELETE /teams/{id}/members/{username}",
  path: `/teams/${e(id)}/members/${e(username)}`,
});

/** Notifications (task 12.3). */
export const readNotification = (id: string): Endpoint => ({
  route: "POST /notifications/{id}/read",
  path: `/notifications/${e(id)}/read`,
});
export const readAllNotifications = (): Endpoint => ({
  route: "POST /notifications/read-all",
  path: "/notifications/read-all",
});

/** Workflow authoring. `new` is a server-reserved sentinel; it never becomes a stored identifier. */
export const saveWorkflowDraft = (id: string): Endpoint => ({
  route: "POST /workflows/{id}/draft",
  path: `/workflows/${e(id)}/draft`,
});
export const generateWorkflow = (): Endpoint => ({
  route: "POST /workflows/generate",
  path: "/workflows/generate",
});

/** Run lifecycle actions. The server re-checks both the state and the caller's own-record scope. */
export const cancelRun = (id: string): Endpoint => ({
  route: "POST /runs/{id}/cancel",
  path: `/runs/${e(id)}/cancel`,
});
export const confirmRunAction = (id: string, stepId: string): Endpoint => ({
  route: "POST /runs/{id}/confirmations/{stepId}/confirm",
  path: `/runs/${e(id)}/confirmations/${e(stepId)}/confirm`,
});
export const decideRunApproval = (id: string, stepId: string): Endpoint => ({
  route: "POST /runs/{id}/approvals/{stepId}",
  path: `/runs/${e(id)}/approvals/${e(stepId)}`,
});

/** Personal settings (task 11.14). The target account always comes from the verified session. */
export const saveOwnProfile = (): Endpoint => ({ route: "PUT /me/profile", path: "/me/profile" });
export const saveOwnPreferences = (): Endpoint => ({
  route: "PUT /me/preferences",
  path: "/me/preferences",
});
/**
 * The self-scoped acknowledgement after the identity provider has accepted the change.
 *
 * Deliberately not a password setter: requirement 4.8 forbids any operator path that sets a customer
 * password, so the change itself goes to Cognito with the access token and the current password, and
 * this only records the audit event.
 */
export const ownPasswordChanged = (): Endpoint => ({
  route: "POST /me/password-changed",
  path: "/me/password-changed",
});
export const revokeOwnSessions = (): Endpoint => ({
  route: "POST /me/sessions/revoke",
  path: "/me/sessions/revoke",
});

/**
 * Invitations (tasks 11.9, 11.10).
 *
 * Inspection is unauthenticated because the recipient may have no session yet, and returns only the
 * organization display name and the invited address. Acceptance is authenticated, single-use, and
 * resolves organization and role from the STORED record — which is why neither builder takes a role or
 * an organization: there is nothing for a client to supply that the server would believe.
 */
export const inspectInvitation = (token: string): Endpoint => ({
  route: "GET /invitations/{token}",
  path: `/invitations/${e(token)}`,
});
export const acceptInvitation = (token: string): Endpoint => ({
  route: "POST /invitations/{token}/accept",
  path: `/invitations/${e(token)}/accept`,
});

/** Support. */
export const openTicket = (): Endpoint => ({
  route: "POST /support/tickets",
  path: "/support/tickets",
});

/**
 * Every write, with sample arguments, so the test can walk the complete set rather than a list
 * somebody remembered to extend. A new builder that is not added here fails the completeness check.
 */
export const ALL_ENDPOINTS: readonly Endpoint[] = [
  orgProfile("acme"),
  orgSettings("acme"),
  orgBranding("acme"),
  inviteUser("acme"),
  setUserRole("acme", "person@acme.example"),
  resendInvitation("acme", "person@acme.example"),
  revokeInvitation("acme", "person@acme.example"),
  setUserStatus("acme", "person@acme.example"),
  createTeam(),
  renameTeam("team_1"),
  deleteTeam("team_1"),
  addTeamMember("team_1"),
  removeTeamMember("team_1", "person@acme.example"),
  readNotification("ntf_1"),
  readAllNotifications(),
  saveWorkflowDraft("new"),
  saveWorkflowDraft("wf_1"),
  generateWorkflow(),
  cancelRun("run_1"),
  confirmRunAction("run_1", "step_1"),
  decideRunApproval("run_1", "step_1"),
  saveOwnProfile(),
  saveOwnPreferences(),
  ownPasswordChanged(),
  revokeOwnSessions(),
  inspectInvitation("tok_1"),
  acceptInvitation("tok_1"),
  openTicket(),
];
