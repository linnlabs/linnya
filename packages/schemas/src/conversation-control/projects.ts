import { z } from 'zod';
import {
  ProjectCreateInputSchema,
  ProjectRecordSchema,
  ProjectUpdateInputSchema,
} from '../project';
import { CONVERSATION_CONTROL_SCHEMA_VERSION } from './protocol';

const RequestFields = {
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
  command: z.literal('projects'),
};
const ProjectIdSchema = ProjectRecordSchema.shape.id;

export const ConversationControlProjectsRequestSchema = z.discriminatedUnion('action', [
  z.object({ ...RequestFields, action: z.literal('list') }).strict(),
  z.object({ ...RequestFields, action: z.literal('get'), project_id: ProjectIdSchema }).strict(),
  z
    .object({ ...RequestFields, action: z.literal('create'), input: ProjectCreateInputSchema })
    .strict(),
  z
    .object({
      ...RequestFields,
      action: z.literal('update'),
      project_id: ProjectIdSchema,
      updates: ProjectUpdateInputSchema,
    })
    .strict(),
]);

/** 控制协议用 project_id 表达身份；不暴露内部软删除或存储位置。 */
export const ConversationControlProjectSchema = ProjectRecordSchema.omit({
  id: true,
  deleted_at: true,
}).extend({ project_id: ProjectIdSchema });

const ResponseFields = { ...RequestFields, ok: z.literal(true) };
export const ConversationControlProjectsResponseSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...ResponseFields,
      action: z.literal('list'),
      projects: z.array(z.object({ project_id: ProjectIdSchema, name: z.string() }).strict()),
    })
    .strict(),
  z
    .object({
      ...ResponseFields,
      action: z.literal('get'),
      project: ConversationControlProjectSchema,
    })
    .strict(),
  z
    .object({
      ...ResponseFields,
      action: z.literal('create'),
      project: ConversationControlProjectSchema,
    })
    .strict(),
  z
    .object({
      ...ResponseFields,
      action: z.literal('update'),
      project: ConversationControlProjectSchema,
    })
    .strict(),
]);

export type ConversationControlProjectsRequest = z.infer<
  typeof ConversationControlProjectsRequestSchema
>;
export type ConversationControlProjectsResponse = z.infer<
  typeof ConversationControlProjectsResponseSchema
>;
export type ConversationControlProject = z.infer<typeof ConversationControlProjectSchema>;
