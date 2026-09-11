import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type OnboardingStatus =
  | "PROSPECT" | "CLOSED_WON" | "SETUP_REQUIRED" | "ONBOARDING"
  | "CONFIGURATION" | "TESTING" | "READY_FOR_LAUNCH" | "ACTIVE" | "PAUSED" | "CHURNED";
export type CrmCustomerRef = { provider: "monday"; itemId: string; boardId?: string };
export type CrmCustomer = {
  ref: CrmCustomerRef; name: string;
  primaryContact: { name?: string; email?: string; phone?: string };
  billingContact?: { name?: string; email?: string; phone?: string };
  stageLabel: string; ownerEmail?: string; amazflowOrgId?: string;
};
export type UsageSummary = { periodStart: string; periodEnd: string; runsCompleted: number; runsFailed: number; activeWorkflows: number; activeAgents: number };
export interface CRMService {
  findCustomer(query: { ref?: CrmCustomerRef; email?: string; name?: string }): Promise<CrmCustomer | null>;
  createCustomer(input: { name: string; primaryContact: CrmCustomer["primaryContact"] }): Promise<CrmCustomer>;
  updateCustomer(ref: CrmCustomerRef, patch: Partial<Omit<CrmCustomer, "ref">>): Promise<CrmCustomer>;
  updateOnboardingStatus(ref: CrmCustomerRef, status: OnboardingStatus): Promise<void>;
  recordOrganizationId(ref: CrmCustomerRef, orgId: string): Promise<void>;
  recordActivation(ref: CrmCustomerRef, activatedAt: string): Promise<void>;
  recordUsageSummary(ref: CrmCustomerRef, summary: UsageSummary): Promise<void>;
}

export type CrmCall = { method: keyof CRMService; args: unknown[] };
export class NullCrmService implements CRMService {
  readonly calls: CrmCall[] = [];
  async findCustomer(query: Parameters<CRMService["findCustomer"]>[0]) { this.calls.push({ method: "findCustomer", args: [query] }); return null; }
  async createCustomer(input: Parameters<CRMService["createCustomer"]>[0]): Promise<CrmCustomer> { this.calls.push({ method: "createCustomer", args: [input] }); return { ref: { provider: "monday", itemId: "null" }, ...input, stageLabel: "" }; }
  async updateCustomer(ref: CrmCustomerRef, patch: Partial<Omit<CrmCustomer, "ref">>): Promise<CrmCustomer> { this.calls.push({ method: "updateCustomer", args: [ref, patch] }); return { ref, name: "", primaryContact: {}, stageLabel: "", ...patch }; }
  async updateOnboardingStatus(ref: CrmCustomerRef, status: OnboardingStatus) { this.calls.push({ method: "updateOnboardingStatus", args: [ref, status] }); }
  async recordOrganizationId(ref: CrmCustomerRef, orgId: string) { this.calls.push({ method: "recordOrganizationId", args: [ref, orgId] }); }
  async recordActivation(ref: CrmCustomerRef, activatedAt: string) { this.calls.push({ method: "recordActivation", args: [ref, activatedAt] }); }
  async recordUsageSummary(ref: CrmCustomerRef, summary: UsageSummary) { this.calls.push({ method: "recordUsageSummary", args: [ref, summary] }); }
}

export type SecretResolver = (name: string) => Promise<string | undefined>;
export class MondayCrmService implements CRMService {
  constructor(private readonly options: { secret: SecretResolver; secretName?: string; endpoint?: string; fetch?: typeof fetch; boardId?: string }) {}
  private async request(query: string, variables: Record<string, unknown>) {
    const token = await this.options.secret(this.options.secretName ?? "MONDAY_API_TOKEN");
    if (!token) throw new Error("CRM provider is not configured");
    const response = await (this.options.fetch ?? fetch)(this.options.endpoint ?? "https://api.monday.com/v2", {
      method: "POST", headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) throw new Error(`CRM provider request failed (${response.status})`);
    const body = await response.json() as { data?: any; errors?: unknown[] };
    if (body.errors?.length || !body.data) throw new Error("CRM provider returned an error");
    return body.data;
  }
  async findCustomer(query: { ref?: CrmCustomerRef; email?: string; name?: string }) {
    const data = await this.request("query ($query: String!) { items_page(query_params: {rules: [{column_id: \"name\", compare_value: [$query]}]}) { items { id name column_values { id text } } } }", { query: query.ref?.itemId ?? query.name ?? query.email ?? "" });
    const item = data.items_page?.items?.[0]; return item ? mondayItem(item, this.options.boardId) : null;
  }
  async createCustomer(input: { name: string; primaryContact: CrmCustomer["primaryContact"] }): Promise<CrmCustomer> {
    const data = await this.request("mutation ($name: String!, $board: ID!) { create_item(board_id: $board, item_name: $name) { id name } }", { name: input.name, board: this.options.boardId });
    return { ref: { provider: "monday", itemId: String(data.create_item.id), boardId: this.options.boardId }, ...input, stageLabel: "" };
  }
  async updateCustomer(ref: CrmCustomerRef, patch: Partial<Omit<CrmCustomer, "ref">>) {
    if (patch.name) await this.request("mutation ($id: ID!, $name: String!) { change_simple_column_value(item_id: $id, column_id: \"name\", value: $name) { id } }", { id: ref.itemId, name: patch.name });
    return { ref, name: patch.name ?? "", primaryContact: patch.primaryContact ?? {}, stageLabel: patch.stageLabel ?? "", ...patch };
  }
  async updateOnboardingStatus(ref: CrmCustomerRef, status: OnboardingStatus) { await this.change(ref, status); }
  async recordOrganizationId(ref: CrmCustomerRef, orgId: string) { await this.change(ref, orgId); }
  async recordActivation(ref: CrmCustomerRef, activatedAt: string) { await this.change(ref, activatedAt); }
  async recordUsageSummary(ref: CrmCustomerRef, summary: UsageSummary) { await this.change(ref, JSON.stringify(summary)); }
  private async change(ref: CrmCustomerRef, value: string) {
    await this.request("mutation ($id: ID!, $value: String!) { change_simple_column_value(item_id: $id, column_id: \"amazflow\", value: $value) { id } }", { id: ref.itemId, value });
  }
}
function mondayItem(item: any, boardId?: string): CrmCustomer {
  const columns = Object.fromEntries((item.column_values ?? []).map((c: any) => [c.id, c.text]));
  return { ref: { provider: "monday", itemId: String(item.id), boardId }, name: String(item.name ?? ""), primaryContact: { email: columns.email }, stageLabel: columns.stage ?? "" , ownerEmail: columns.owner };
}

export const DEFAULT_STAGE_MAP: Readonly<Record<string, OnboardingStatus | "CLOSED_WON">> = {
  "closed won": "CLOSED_WON", "closed_won": "CLOSED_WON", "setup required": "SETUP_REQUIRED",
  onboarding: "ONBOARDING", "in progress": "ONBOARDING", configuration: "CONFIGURATION",
  testing: "TESTING", "ready for launch": "READY_FOR_LAUNCH", active: "ACTIVE",
  paused: "PAUSED", churned: "CHURNED"
};
/** Monday labels are interpreted only at this boundary; downstream code uses normalized statuses. */
export function mapMondayStageLabel(label: string, onUnmapped?: (label: string) => void): OnboardingStatus | "CLOSED_WON" | null {
  const mapped = DEFAULT_STAGE_MAP[label.trim().toLowerCase()] ?? null;
  if (!mapped) onUnmapped?.(label);
  return mapped;
}
export type WebhookEvent = { provider: "monday"; eventId?: string; itemId: string; boardId?: string; customerName: string; stageLabel: string; occurredAt: string; primaryContact?: { name?: string; email?: string }; ownerEmail?: string };
export type WebhookRequest = { secure: boolean; pathSecret: string; authorization?: string; source?: string; body: unknown };
export type WebhookResponse = { status: number; body?: Record<string, unknown> };
export type CrmLog = { type: string; eventId?: string; itemId?: string; mappedStatus?: string; correlationId: string };
export type CrmStore = {
  events: Map<string, { state: "PROCESSING" | "DONE" | "FAILED"; orgId?: string; attempts: number; firstSeenAt: string; lastError?: string; event: WebhookEvent; authorization?: string; source?: string }>;
  links: Map<string, string>; organizations: Map<string, { id: string; name: string; slug: string }>;
  onboarding: Map<string, { status: OnboardingStatus; crm: CrmCustomerRef; internalOwnerUserId?: string; closedWonAt: string; invite: { state: "prepared" | "blocked"; reason?: string } }>;
  audits: CrmLog[]; logs: CrmLog[]; queue: Array<{ ref: CrmCustomerRef; method: "recordOrganizationId" | "updateOnboardingStatus"; value: string }>;
};
export function createCrmStore(): CrmStore { return { events: new Map(), links: new Map(), organizations: new Map(), onboarding: new Map(), audits: [], logs: [], queue: [] }; }

export class InMemoryCrmHarness {
  readonly store = createCrmStore();
  private readonly sourceRequests = new Map<string, number>();
  private next = 1;
  constructor(private readonly options: {
    pathSecret: string; signingSecret?: string; crm?: CRMService; now?: () => Date;
    rateLimit?: number; staleAfterMs?: number; logger?: (entry: CrmLog) => void;
    allowedEmailDomains?: string[];
    resolveInternalOwner?: (ownerEmail: string) => string | undefined;
  }) {
  }
  async handle(request: WebhookRequest): Promise<WebhookResponse> {
    const correlationId = `crm-${this.next++}`;
    if (!request.secure || !safeEqual(request.pathSecret, this.options.pathSecret)) return { status: 404 };
    const source = request.source ?? "unknown";
    const used = this.sourceRequests.get(source) ?? 0;
    if (used >= (this.options.rateLimit ?? 60)) return { status: 429 };
    this.sourceRequests.set(source, used + 1);
    if (request.authorization) {
      if (!this.options.signingSecret || !verifyAuthorization(request.authorization, this.options.signingSecret)) return { status: 401 };
    } else this.log({ type: "CRM_SIGNATURE_ABSENT", correlationId });
    if (!isRecord(request.body)) return { status: 400 };
    if (typeof request.body.challenge === "string") return { status: 200, body: { challenge: request.body.challenge } };
    const event = parseEvent(request.body); if (!event) return { status: 400 };
    const mapped = mapMondayStageLabel(event.stageLabel);
    this.log({ type: mapped ? "CRM_EVENT_RECEIVED" : "CRM_STAGE_UNMAPPED", eventId: event.eventId, itemId: event.itemId, mappedStatus: mapped ?? undefined, correlationId });
    if (!mapped) return { status: 202 };
    if (mapped !== "CLOSED_WON") return { status: 202 };
    const key = `${event.provider}:${event.eventId ?? hash(`${event.itemId}:${event.stageLabel}:${event.occurredAt}`)}`;
    const prior = this.store.events.get(key);
    if (prior) return prior.state === "DONE" ? { status: 200, body: { deduped: true, orgId: prior.orgId } } : { status: 409, body: { retryable: true } };
    this.store.events.set(key, {
      state: "PROCESSING", attempts: 1,
      firstSeenAt: (this.options.now ?? (() => new Date()))().toISOString(),
      event, authorization: request.authorization, source: request.source
    });
    const linkKey = `${event.provider}:${event.itemId}`;
    let orgId = this.store.links.get(linkKey);
    if (!orgId) {
      orgId = `org-${this.next++}`;
      this.store.organizations.set(orgId, { id: orgId, name: event.customerName, slug: slug(event.customerName, orgId) });
      const existing = this.store.links.get(linkKey);
      if (existing) orgId = existing; else this.store.links.set(linkKey, orgId);
    }
    const ref: CrmCustomerRef = { provider: event.provider, itemId: event.itemId, boardId: event.boardId };
    const contactEmail = event.primaryContact?.email;
    const permitted = validEmail(contactEmail) && this.isAllowedDomain(contactEmail);
    this.store.onboarding.set(orgId, {
      status: "SETUP_REQUIRED", crm: ref,
      ...(event.ownerEmail && this.options.resolveInternalOwner?.(event.ownerEmail)
        ? { internalOwnerUserId: this.options.resolveInternalOwner(event.ownerEmail) }
        : {}),
      closedWonAt: event.occurredAt,
      invite: permitted ? { state: "prepared" } : { state: "blocked", reason: "missing_or_invalid_contact_or_domain" }
    });
    this.store.queue.push({ ref, method: "recordOrganizationId", value: orgId }, { ref, method: "updateOnboardingStatus", value: "SETUP_REQUIRED" });
    const done = this.store.events.get(key)!; done.state = "DONE"; done.orgId = orgId;
    if (!this.store.audits.some((audit) => audit.type === "CRM_CLOSED_WON_PROCESSED" && audit.eventId === event.eventId && audit.itemId === event.itemId)) {
      this.store.audits.push({ type: "CRM_CLOSED_WON_PROCESSED", eventId: event.eventId, itemId: event.itemId, correlationId });
    }
    return { status: 200, body: { orgId, onboardingStatus: "SETUP_REQUIRED" } };
  }
  private log(entry: CrmLog) { this.store.logs.push(entry); this.options.logger?.(entry); }
  private isAllowedDomain(email?: string) {
    const domains = this.options.allowedEmailDomains;
    if (!domains?.length) return true;
    return !!email && domains.some((domain) => email.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  }
  async drainReverseSync(crm: CRMService = this.options.crm ?? new NullCrmService()) {
    const pending = this.store.queue.splice(0); for (const item of pending) {
      try { if (item.method === "recordOrganizationId") await crm.recordOrganizationId(item.ref, item.value); else await crm.updateOnboardingStatus(item.ref, item.value as OnboardingStatus); }
      catch { this.store.queue.push(item); }
    }
  }
  sweepStale(now = (this.options.now ?? (() => new Date()))()) {
    const threshold = this.options.staleAfterMs ?? 15 * 60_000; for (const [key, event] of this.store.events) if (event.state === "PROCESSING" && now.getTime() - Date.parse(event.firstSeenAt) > threshold) event.state = "FAILED";
  }
  async retry(eventKey: string): Promise<WebhookResponse | false> {
    const marker = this.store.events.get(eventKey);
    if (!marker || marker.state !== "FAILED") return false;
    this.store.events.delete(eventKey);
    return this.handle({
      secure: true, pathSecret: this.options.pathSecret, body: marker.event,
      authorization: marker.authorization, source: marker.source
    });
  }
}
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function parseEvent(body: Record<string, any>): WebhookEvent | null {
  if (body.provider !== "monday" || typeof body.itemId !== "string" || !body.itemId || typeof body.customerName !== "string" || typeof body.stageLabel !== "string" || typeof body.occurredAt !== "string" || Number.isNaN(Date.parse(body.occurredAt))) return null;
  if (body.primaryContact !== undefined && (!isRecord(body.primaryContact) || (body.primaryContact.email !== undefined && typeof body.primaryContact.email !== "string"))) return null;
  return body as WebhookEvent;
}
function safeEqual(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function verifyAuthorization(value: string, secret: string) { const token = value.replace(/^Bearer\s+/i, ""); const expected = createHmac("sha256", secret).update(token.split(".").slice(0, 2).join(".")).digest("base64url"); return token.split(".")[2] === expected || safeEqual(token, createHmac("sha256", secret).update(token).digest("hex")); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function slug(name: string, suffix: string) { return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "customer"}-${suffix}`; }
function validEmail(email?: string) { return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
