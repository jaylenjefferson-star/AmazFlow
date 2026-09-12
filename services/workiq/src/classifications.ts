import { z } from "zod";

// Pattern discovery produces an observed-pattern hypothesis, never a fact: it must carry its
// sample size and confidence, and it cannot reach "confirmed" without a human (see opportunities.ts,
// which requires a confirmedByUserId to turn a confirmed classification into an opportunity).
export const classificationStatusSchema = z.enum(["observed", "confirmed", "dismissed"]);
export type ClassificationStatus = z.infer<typeof classificationStatusSchema>;

export const patternClassificationSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    teamId: z.string().min(1).optional(),
    patternKey: z.string().min(1),
    description: z.string().min(1),
    sampleSize: z.number().int().nonnegative(),
    confidenceScore: z.number().min(0).max(1),
    status: classificationStatusSchema,
    isDemo: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .refine((value) => value.status === "observed" || value.sampleSize > 0, {
    message: "A confirmed or dismissed classification must be backed by at least one observed sample",
    path: ["sampleSize"]
  });
export type PatternClassification = z.infer<typeof patternClassificationSchema>;
