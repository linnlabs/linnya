import { ConversationControlSkillsRequestSchema } from './skills';
import { ConversationControlProjectsRequestSchema } from './projects';
import { z } from 'zod';
import { ConversationControlCommandApprovalsRequestSchema } from './commandApprovals';
import { JsonValueSchema } from '../json-value';
import { ConversationSelectedAgentIdSchema } from '../conversation/selected-agent';
import { CONVERSATION_CONTROL_SCHEMA_VERSION } from './protocol';
import { RESEARCH_AGENT_ID, ResearchRunArgsSchema } from '../tools/research-run';

const CommandBaseFields = {
  schema_version: z.literal(CONVERSATION_CONTROL_SCHEMA_VERSION),
} as const;

const OpaqueIdSchema = z.string().trim().min(1);

export const ConversationControlSendRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('send'),
    message: z.string().trim().min(1).max(200_000),
    conversation_id: OpaqueIdSchema.optional(),
    project_id: OpaqueIdSchema.optional(),
    selected_agent_id: ConversationSelectedAgentIdSchema.optional(),
    model_id: OpaqueIdSchema.optional(),
    image_generation_model_id: OpaqueIdSchema.optional(),
    reasoning_effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    research_scope: ResearchRunArgsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.research_scope && value.selected_agent_id !== RESEARCH_AGENT_ID) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['research_scope'], message: 'Research scope requires the explicit research_v1 Agent selection' });
    }
  });

export const ConversationControlListRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('list'),
    limit: z.number().int().min(1).max(100).default(30),
    cursor: OpaqueIdSchema.optional(),
    search: z.string().trim().min(1).max(500).optional(),
    project_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const ConversationControlModelsRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('models'),
  })
  .strict();

const MessagesRequestBaseFields = {
  ...CommandBaseFields,
  command: z.literal('messages'),
  conversation_id: OpaqueIdSchema,
  limit: z.number().int().min(1).max(200).default(80),
} as const;

export const ConversationControlMessagesRequestSchema = z.discriminatedUnion('window', [
  z
    .object({
      ...MessagesRequestBaseFields,
      window: z.literal('tail'),
    })
    .strict(),
  z
    .object({
      ...MessagesRequestBaseFields,
      window: z.literal('before'),
      cursor: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...MessagesRequestBaseFields,
      window: z.literal('after'),
      cursor: z.number().int().positive(),
    })
    .strict(),
]);

export const ConversationControlStatusRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('status'),
    conversation_id: OpaqueIdSchema,
    expected_run_id: OpaqueIdSchema.optional(),
  })
  .strict();

/**
 * 恢复 settled pause 必须钉住一次明确观察到的 execution 与更新时间。
 * expected_run_id 也保持必填，避免“当前 run”在读取与写入之间漂移。
 */
export const ConversationControlResumeRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('resume'),
    conversation_id: OpaqueIdSchema,
    expected_run_id: OpaqueIdSchema,
    expected_execution_id: OpaqueIdSchema,
    expected_updated_at: z.number().int().nonnegative(),
  })
  .strict();

export const ConversationControlInteractionResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('approve') }).strict(),
  z.object({ kind: z.literal('skip') }).strict(),
  z.object({ kind: z.literal('submit'), value: JsonValueSchema }).strict(),
  z.object({ kind: z.literal('modify'), value: JsonValueSchema }).strict(),
]);

export const ConversationControlRespondRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('respond'),
    conversation_id: OpaqueIdSchema,
    expected_interaction_id: OpaqueIdSchema,
    response: ConversationControlInteractionResponseSchema,
    project_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const ConversationControlStopRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('stop'),
    conversation_id: OpaqueIdSchema,
    expected_run_id: OpaqueIdSchema.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const ConversationControlResultRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('result'),
    conversation_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const ConversationControlAuditRequestSchema = z
  .object({
    ...CommandBaseFields,
    command: z.literal('audit'),
    conversation_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema.optional(),
  })
  .strict();

export const CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES = [
  'list_files',
  'read_file',
  'grep',
  'write_file',
  'edit_file',
] as const;

export const ConversationControlToolNameSchema = z.enum(
  [...CONVERSATION_CONTROL_WORKSPACE_TOOL_NAMES, 'web_search', 'web_read', 'tool_output_read'],
);

const ToolsRequestBaseFields = {
  ...CommandBaseFields,
  command: z.literal('tools'),
} as const;

export const ConversationControlToolsListRequestSchema = z.object({
  ...ToolsRequestBaseFields,
  action: z.literal('list'),
}).strict();

export const ConversationControlToolsDescribeRequestSchema = z.object({
  ...ToolsRequestBaseFields,
  action: z.literal('describe'),
  tool_name: ConversationControlToolNameSchema,
}).strict();

export const ConversationControlToolsCallRequestSchema = z.object({
  ...ToolsRequestBaseFields,
  action: z.literal('call'),
  tool_name: ConversationControlToolNameSchema,
  args: z.record(JsonValueSchema),
  conversation_id: OpaqueIdSchema.optional(),
  project_id: OpaqueIdSchema.optional(),
}).strict().superRefine((request, ctx) => {
  if (!request.conversation_id && !request.project_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['conversation_id'],
      message: 'tool call requires conversation_id or project_id',
    });
  }
});

/** 当前 Host 生命周期内的临时开放；省略 enabled 只查询，不修改状态。 */
export const ConversationControlWebToolAccessRequestSchema = z.object({
  ...ToolsRequestBaseFields,
  action: z.literal('web_access'),
  enabled: z.boolean().optional(),
}).strict();

export const ConversationControlToolsRequestSchema = z.union([
  ConversationControlToolsListRequestSchema,
  ConversationControlToolsDescribeRequestSchema,
  ConversationControlToolsCallRequestSchema,
  ConversationControlWebToolAccessRequestSchema,
]);

// messages 自身按 window 判别，因此顶层使用 union；每个分支仍是 strict schema。
export const ConversationControlCommandRequestSchema = z.union([
  ConversationControlSkillsRequestSchema,
  ConversationControlSendRequestSchema,
  ConversationControlModelsRequestSchema,
  ConversationControlProjectsRequestSchema,
  ConversationControlListRequestSchema,
  ConversationControlMessagesRequestSchema,
  ConversationControlStatusRequestSchema,
  ConversationControlResumeRequestSchema,
  ConversationControlRespondRequestSchema,
  ConversationControlStopRequestSchema,
  ConversationControlResultRequestSchema,
  ConversationControlAuditRequestSchema,
  ConversationControlToolsRequestSchema,
  ConversationControlCommandApprovalsRequestSchema,
]);

export type ConversationControlSendRequest = z.infer<
  typeof ConversationControlSendRequestSchema
>;
export type ConversationControlListRequest = z.infer<
  typeof ConversationControlListRequestSchema
>;
export type ConversationControlModelsRequest = z.infer<
  typeof ConversationControlModelsRequestSchema
>;
export type ConversationControlMessagesRequest = z.infer<
  typeof ConversationControlMessagesRequestSchema
>;
export type ConversationControlStatusRequest = z.infer<
  typeof ConversationControlStatusRequestSchema
>;
export type ConversationControlResumeRequest = z.infer<
  typeof ConversationControlResumeRequestSchema
>;
export type ConversationControlRespondRequest = z.infer<
  typeof ConversationControlRespondRequestSchema
>;
export type ConversationControlStopRequest = z.infer<
  typeof ConversationControlStopRequestSchema
>;
export type ConversationControlResultRequest = z.infer<
  typeof ConversationControlResultRequestSchema
>;
export type ConversationControlAuditRequest = z.infer<
  typeof ConversationControlAuditRequestSchema
>;
export type ConversationControlToolName = z.infer<
  typeof ConversationControlToolNameSchema
>;
export type ConversationControlToolsRequest = z.infer<
  typeof ConversationControlToolsRequestSchema
>;
export type ConversationControlCommandRequest = z.infer<
  typeof ConversationControlCommandRequestSchema
>;
