import { z } from "zod";

// Field names WorkIQ must never accept, on any schema derived from device telemetry. This list
// exists so a caller who tries to smuggle content through a same-shaped-looking field (e.g.
// "keystrokeLog" instead of "keystrokes") gets a clear, named rejection instead of the field
// being silently dropped or -- worse -- silently stored by a future looser schema.
export const RESTRICTED_TELEMETRY_FIELDS = [
  "keystrokes", "keystrokeLog", "keyLog", "password", "passwords",
  "message", "messages", "document", "documents", "documentContent",
  "clipboard", "clipboardContent", "webcam", "microphone", "audio",
  "screenshot", "screenshots", "screenRecording", "screenRecordingUrl",
  "formValues", "formData", "content", "body", "text", "transcript"
] as const;

/**
 * Scans a raw (untyped) telemetry payload for restricted field names before it ever reaches a
 * zod parse, so the rejection reason names the offending field rather than a generic "unknown
 * key" error further down the stack.
 */
export function assertNoRestrictedTelemetryFields(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const keys = Object.keys(raw as Record<string, unknown>);
  const offending = keys.filter((key) => (RESTRICTED_TELEMETRY_FIELDS as readonly string[]).includes(key));
  if (offending.length > 0) {
    throw new Error(
      `WorkIQ rejects content-shaped telemetry fields: ${offending.join(", ")}. WorkIQ stores metadata only ` +
        "(application/domain, timestamps, active/idle state, switch counts) -- see docs/WORKIQ_COMPLIANCE.md."
    );
  }
}

// A completed, agent-aggregated session. This is the unit WorkIQ persists -- never raw,
// high-frequency samples. `.strict()` rejects any field this schema does not name, which is the
// second line of defense after assertNoRestrictedTelemetryFields for anything not on the
// explicit deny-list above.
export const aggregatedSessionSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    employeeId: z.string().min(1),
    teamId: z.string().min(1).optional(),
    applicationOrDomain: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    activeMinutes: z.number().nonnegative(),
    idleMinutes: z.number().nonnegative(),
    switchCount: z.number().int().nonnegative(),
    isDemo: z.boolean().default(false)
  })
  .strict()
  .refine((value) => value.endedAt >= value.startedAt, {
    message: "endedAt cannot precede startedAt",
    path: ["endedAt"]
  });
export type AggregatedSession = z.infer<typeof aggregatedSessionSchema>;

/** Validates a raw payload against both the deny-list and the aggregated session shape. */
export function parseAggregatedSession(raw: unknown): AggregatedSession {
  assertNoRestrictedTelemetryFields(raw);
  return aggregatedSessionSchema.parse(raw);
}
