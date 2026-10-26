import { z } from 'zod';
import { SkillManagementRequestSchema, SkillManagementResultSchema } from '../skills';
import { CONVERSATION_CONTROL_SCHEMA_VERSION } from './protocol';

export const ConversationControlSkillsRequestSchema = z.object({
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
  command: z.literal('skills'), request: SkillManagementRequestSchema,
}).strict();
export const ConversationControlSkillsResponseSchema = z.object({
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION), ok: z.literal(true),
  command: z.literal('skills'), result: SkillManagementResultSchema,
}).strict();
export type ConversationControlSkillsResponse = z.infer<typeof ConversationControlSkillsResponseSchema>;
