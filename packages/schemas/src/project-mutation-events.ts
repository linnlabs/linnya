import { z } from 'zod';

const ProjectMutationFields = {
  mutationId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
};

// 项目目录是整个数据工作区的列表，不能按当前界面的 projectId 丢弃其他项目事件。
export const ProjectCreatedEventSchema = z
  .object({
    ...ProjectMutationFields,
    type: z.literal('project.created'),
  })
  .strict();
export const ProjectUpdatedEventSchema = z
  .object({
    ...ProjectMutationFields,
    type: z.literal('project.updated'),
  })
  .strict();
export const ProjectDeletedEventSchema = z
  .object({
    ...ProjectMutationFields,
    type: z.literal('project.deleted'),
  })
  .strict();
export const ProjectMutationEventSchema = z.discriminatedUnion('type', [
  ProjectCreatedEventSchema,
  ProjectUpdatedEventSchema,
  ProjectDeletedEventSchema,
]);
export type ProjectMutationEvent = z.infer<typeof ProjectMutationEventSchema>;
