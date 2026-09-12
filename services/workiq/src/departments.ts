import { z } from "zod";

export const departmentSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    name: z.string().min(1),
    parentDepartmentId: z.string().min(1).optional(),
    isDemo: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .refine((value) => value.parentDepartmentId !== value.id, {
    message: "A department cannot be its own parent",
    path: ["parentDepartmentId"]
  });
export type Department = z.infer<typeof departmentSchema>;

export const teamSchema = z
  .object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    departmentId: z.string().min(1),
    name: z.string().min(1),
    managerUserId: z.string().min(1),
    isDemo: z.boolean().default(false),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type Team = z.infer<typeof teamSchema>;
