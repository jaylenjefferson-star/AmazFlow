import { z } from "zod";
import { classificationStatusSchema } from "./classifications.js";

// Disputes are persisted as classification changes rather than mutating the original record in
// place, so a challenged classification retains its full audit trail (see WorkIQ compliance doc:
// "Disputes are persisted as classification changes and are included in later aggregation").
export const disputeStatusSchema = z.enum(["open", "resolved", "rejected"]);
export type DisputeStatus = z.infer<typeof disputeStatusSchema>;

export const classificationDisputeSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    classificationId: z.string().min(1),
    raisedByUserId: z.string().min(1),
    reason: z.string().min(1),
    requestedStatus: classificationStatusSchema,
    status: disputeStatusSchema,
    resolution: z.string().min(1).optional(),
    resolvedByUserId: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    resolvedAt: z.string().datetime().optional()
  })
  .strict()
  .refine((value) => value.status === "open" || (!!value.resolvedByUserId && !!value.resolvedAt), {
    message: "A resolved or rejected dispute must record who resolved it and when",
    path: ["resolvedByUserId"]
  });
export type ClassificationDispute = z.infer<typeof classificationDisputeSchema>;
