import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const executionGrantPayloadSchema = z.object({
  version: z.literal(1),
  grantId: z.string().uuid(),
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  stepId: z.string().min(1),
  allowedTools: z.array(z.string().min(1)).min(1).max(30),
  confirmationGranted: z.boolean(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive()
});

export type ExecutionGrantPayload = z.infer<typeof executionGrantPayloadSchema>;
export type GrantExpectation = Partial<Pick<ExecutionGrantPayload, "runId" | "tenantId" | "workflowId" | "workflowVersion" | "stepId">> & { tool?: string };

export interface GrantReplayStore {
  consume(grantId: string, expiresAt: number): Promise<boolean>;
}

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

export class ExecutionGrantService {
  constructor(private readonly secret: string, private readonly ttlSeconds = 300) {
    if (Buffer.byteLength(secret) < 32) throw new Error("Execution grant secret must be at least 32 bytes");
  }

  issue(input: Omit<ExecutionGrantPayload, "version" | "grantId" | "issuedAt" | "expiresAt">, nowMs = Date.now()): string {
    const issuedAt = Math.floor(nowMs / 1000);
    const payload = executionGrantPayloadSchema.parse({ ...input, version: 1, grantId: randomUUID(), issuedAt, expiresAt: issuedAt + this.ttlSeconds });
    const encoded = encode(JSON.stringify(payload));
    return `v1.${encoded}.${this.sign(encoded)}`;
  }

  async verify(token: string, expected: GrantExpectation = {}, replayStore?: GrantReplayStore, nowMs = Date.now()): Promise<ExecutionGrantPayload> {
    const [version, encoded, signature, extra] = token.split(".");
    if (version !== "v1" || !encoded || !signature || extra) throw new Error("Malformed execution grant");
    const actual = Buffer.from(signature, "base64url");
    const wanted = Buffer.from(this.sign(encoded), "base64url");
    if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new Error("Invalid execution grant signature");
    const payload = executionGrantPayloadSchema.parse(JSON.parse(decode(encoded)));
    if (payload.expiresAt <= Math.floor(nowMs / 1000)) throw new Error("Execution grant expired");
    for (const key of ["runId", "tenantId", "workflowId", "workflowVersion", "stepId"] as const) {
      if (expected[key] !== undefined && payload[key] !== expected[key]) throw new Error(`Execution grant ${key} mismatch`);
    }
    if (expected.tool && !payload.allowedTools.includes(expected.tool)) throw new Error("Tool is not authorized by this execution grant");
    if (replayStore && !(await replayStore.consume(payload.grantId, payload.expiresAt))) throw new Error("Execution grant was already consumed");
    return payload;
  }

  private sign(encodedPayload: string) {
    return createHmac("sha256", this.secret).update(`v1.${encodedPayload}`).digest("base64url");
  }
}

