import { z } from 'zod';
import { UserFacingMessageSchema } from './user-facing-message';

/** 项目是数据工作区中的业务容器；这个 ID 不是目录路径或 Backend 实例身份。 */
export const ProjectSystemRoleSchema = z.literal('default');
export type ProjectSystemRole = z.infer<typeof ProjectSystemRoleSchema>;

/** Desktop 与 Backend 共用的项目记录；数据库位置不属于项目合同。 */
export const ProjectRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    system_role: ProjectSystemRoleSchema.nullable(),
    created_at: z.number().int(),
    updated_at: z.number().int(),
    deleted_at: z.number().int().nullable(),
    can_delete: z.boolean(),
  })
  .strict();

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const ProjectCreateInputSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
  })
  .strict();

export const ProjectUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine(input => input.name !== undefined || input.description !== undefined, {
    message: 'Project update requires a name or description',
  });

export type ProjectCreateInput = z.infer<typeof ProjectCreateInputSchema>;
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInputSchema>;

export const ProjectIdentityInputSchema = z
  .object({ projectId: z.string().trim().min(1) })
  .strict();
export const ProjectUpdateRequestSchema = z
  .object({
    projectId: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .strict();
export type ProjectUpdateRequest = z.infer<typeof ProjectUpdateRequestSchema>;

const ProjectOperationFailureSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
    userMessage: UserFacingMessageSchema.optional(),
  })
  .strict();

export const ProjectCreatedResponseSchema = z.union([
  z.object({ success: z.literal(true), data: ProjectIdentityInputSchema }).strict(),
  ProjectOperationFailureSchema,
]);
export const ProjectListResponseSchema = z.union([
  z
    .object({
      success: z.literal(true),
      data: z.object({ projects: z.array(ProjectRecordSchema) }).strict(),
    })
    .strict(),
  ProjectOperationFailureSchema,
]);
export const ProjectMutationResponseSchema = z.union([
  z.object({ success: z.literal(true) }).strict(),
  ProjectOperationFailureSchema,
]);
