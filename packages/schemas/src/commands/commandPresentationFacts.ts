import { z } from 'zod';

import { COMMAND_RUNTIME_PROTOCOL_VERSION } from './commandExecution';
import {
  CommandInternalDataAccessSchema,
  CommandPermissionLevelSchema,
} from './commandPermission';

export const CommandPresentationPermissionSourceSchema = z.enum([
  'global_setting',
  'allow_once',
  'conversation_approval_created',
  'conversation_approval_reused',
]);

export const CommandPresentationPermissionSchema = z.object({
  base_level: CommandPermissionLevelSchema,
  effective_level: CommandPermissionLevelSchema,
  source: CommandPresentationPermissionSourceSchema,
  internal_data_access: CommandInternalDataAccessSchema,
}).strict();

export const CommandExecutionTimingSchema = z.union([
  z.object({
    status: z.literal('not_started'),
    settled_at_ms: z.number().int().safe().nonnegative(),
  }).strict(),
  z.object({
    status: z.literal('started'),
    started_at_ms: z.number().int().safe().nonnegative(),
    settled_at_ms: z.number().int().safe().nonnegative().optional(),
  }).strict(),
]).superRefine((timing, context) => {
  if (
    timing.status === 'started'
    && timing.settled_at_ms !== undefined
    && timing.settled_at_ms < timing.started_at_ms
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['settled_at_ms'],
      message: 'command settlement cannot precede its actual start',
    });
  }
});

/**
 * 这是 durable tool result 中唯一的用户展示事实。它不包含 owner generation、PID、
 * artifact 路径或审批内部身份；旧历史允许缺少整块 facts，但新 runtime 一旦返回
 * running/completed 就必须提供，避免 renderer 用消息时间或命令文本补猜事实。
 */
export const CommandExecutionPresentationFactsV1Schema = z.object({
  protocol_version: z.literal(COMMAND_RUNTIME_PROTOCOL_VERSION),
  kind: z.literal('command_execution_presentation_facts'),
  timing: CommandExecutionTimingSchema,
  permission: CommandPresentationPermissionSchema.optional(),
  // 旧历史没有审计状态；缺省只代表当时未记录，不能被 renderer 猜成完整或不完整。
  audit_status: z.enum(['complete', 'incomplete']).optional(),
}).strict();

export const CommandOutputIncompleteReasonSchema = z.enum([
  'retained_window_omitted',
  'text_projection_failed',
]);

export type CommandPresentationPermissionSource = z.infer<
  typeof CommandPresentationPermissionSourceSchema
>;
export type CommandPresentationPermission = z.infer<
  typeof CommandPresentationPermissionSchema
>;
export type CommandExecutionTiming = z.infer<typeof CommandExecutionTimingSchema>;
export type CommandExecutionPresentationFactsV1 = z.infer<
  typeof CommandExecutionPresentationFactsV1Schema
>;
export type CommandOutputIncompleteReason = z.infer<
  typeof CommandOutputIncompleteReasonSchema
>;
