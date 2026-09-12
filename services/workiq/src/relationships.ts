import { z } from "zod";

// A manager/report edge. Deliberately time-bounded (startedAt/endedAt) rather than a single
// current pointer, so an org-chart change never destroys the history an aggregate was built on.
export const managerReportRelationshipSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    managerUserId: z.string().min(1),
    reportUserId: z.string().min(1),
    teamId: z.string().min(1).optional(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    isDemo: z.boolean().default(false)
  })
  .strict()
  .refine((value) => value.managerUserId !== value.reportUserId, {
    message: "A user cannot manage themselves",
    path: ["reportUserId"]
  })
  .refine((value) => !value.endedAt || value.endedAt >= value.startedAt, {
    message: "endedAt cannot precede startedAt",
    path: ["endedAt"]
  });
export type ManagerReportRelationship = z.infer<typeof managerReportRelationshipSchema>;
