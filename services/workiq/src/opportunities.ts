import { z } from "zod";

// An opportunity is what a confirmed classification becomes once a human has signed off on it --
// it can never be created directly from raw telemetry or an unconfirmed classification hypothesis.
export const opportunityStatusSchema = z.enum(["proposed", "approved", "rejected"]);
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;

export const opportunitySchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    classificationId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    estimatedMinutesSavedPerWeek: z.number().nonnegative(),
    status: opportunityStatusSchema,
    confirmedByUserId: z.string().min(1),
    confirmedAt: z.string().datetime(),
    isDemo: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .refine((value) => value.status !== "approved" || value.confirmedByUserId.length > 0, {
    message: "An opportunity cannot be approved without a human confirmation",
    path: ["confirmedByUserId"]
  });
export type Opportunity = z.infer<typeof opportunitySchema>;
