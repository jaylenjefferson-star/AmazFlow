import { z } from "zod";

// The Send-to-AmazFlow handoff is the only contract WorkIQ exposes to the execution control
// plane. It is intentionally narrow: an approved opportunity's summary and savings estimate, plus
// enough to seed a workflow draft -- never raw telemetry, employee identifiers beyond the
// requester, or classification/dispute internals. `.strict()` keeps it that way as the schema
// evolves: a field must be added here deliberately, it cannot arrive by accident.
export const sendToAmazFlowHandoffSchema = z
  .object({
    tenantId: z.string().min(1),
    opportunityId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    estimatedMinutesSavedPerWeek: z.number().nonnegative(),
    requestedByUserId: z.string().min(1),
    suggestedWorkflowName: z.string().min(1).optional(),
    createdAt: z.string().datetime()
  })
  .strict();
export type SendToAmazFlowHandoff = z.infer<typeof sendToAmazFlowHandoffSchema>;

/**
 * Builds a handoff payload from an approved opportunity. Throws if the opportunity has not been
 * approved, so an unapproved or merely-proposed opportunity can never cross the service boundary.
 */
export function buildSendToAmazFlowHandoff(input: {
  opportunity: { id: string; tenantId: string; title: string; summary: string; estimatedMinutesSavedPerWeek: number; status: string };
  requestedByUserId: string;
  suggestedWorkflowName?: string;
  createdAt: string;
}): SendToAmazFlowHandoff {
  if (input.opportunity.status !== "approved") {
    throw new Error("Only an approved opportunity may be sent to AmazFlow");
  }

  return sendToAmazFlowHandoffSchema.parse({
    tenantId: input.opportunity.tenantId,
    opportunityId: input.opportunity.id,
    title: input.opportunity.title,
    summary: input.opportunity.summary,
    estimatedMinutesSavedPerWeek: input.opportunity.estimatedMinutesSavedPerWeek,
    requestedByUserId: input.requestedByUserId,
    suggestedWorkflowName: input.suggestedWorkflowName,
    createdAt: input.createdAt
  });
}
