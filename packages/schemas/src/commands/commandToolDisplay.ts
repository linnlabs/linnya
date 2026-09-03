import { z } from 'zod';

import { CommandRuntimeFailureCodeSchema } from './commandOutcome';
import { CommandProcessHandleSchema } from './commandIdentity';
import { ProcessOutputCursorSchema } from './processControl';
import { ToolOutputBlobIdSchema } from '../tools/tool-output-read';
import {
  CommandExecutionPresentationFactsV1Schema,
  CommandOutputIncompleteReasonSchema,
} from './commandPresentationFacts';

export const PtyTerminalColorSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('palette'), index: z.number().int().nonnegative() }).strict(),
  z.object({ mode: z.literal('rgb'), value: z.number().int().nonnegative() }).strict(),
]);

export const PtyTerminalCellStyleSchema = z.object({
  foreground: PtyTerminalColorSchema.optional(),
  background: PtyTerminalColorSchema.optional(),
  bold: z.literal(true).optional(),
  dim: z.literal(true).optional(),
  italic: z.literal(true).optional(),
  underline: z.literal(true).optional(),
  blink: z.literal(true).optional(),
  inverse: z.literal(true).optional(),
  invisible: z.literal(true).optional(),
  strikethrough: z.literal(true).optional(),
  overline: z.literal(true).optional(),
}).strict();

export const PtyTerminalCellMetricSchema = z.object({
  column: z.number().int().nonnegative(),
  text_offset: z.number().int().nonnegative(),
  text_length: z.number().int().nonnegative(),
  display_width: z.number().int().nonnegative(),
}).strict();

export const PtyTerminalStyleRunSchema = z.object({
  start_column: z.number().int().nonnegative(),
  end_column: z.number().int().nonnegative(),
  style: PtyTerminalCellStyleSchema,
}).strict();

export const PtyTerminalScreenLineSchema = z.object({
  wrapped: z.boolean(),
  text: z.string(),
  cell_metrics: z.array(PtyTerminalCellMetricSchema).readonly(),
  style_runs: z.array(PtyTerminalStyleRunSchema).readonly(),
}).strict();

/**
 * Renderer 只接收这一份稀疏纯数据屏幕。raw transcript、ANSI parser 和逐 cell 对象
 * 都不属于跨层合同，避免界面为了方便重新引入终端副作用或无界对象图。
 */
export const PtyTerminalScreenProjectionSchema = z.object({
  mode: z.literal('pty'),
  scope: z.enum(['viewport', 'terminal_window']),
  revision: z.number().int().nonnegative(),
  columns: z.number().int().positive(),
  rows: z.number().int().positive(),
  active_buffer: z.enum(['normal', 'alternate']),
  total_buffer_lines: z.number().int().nonnegative(),
  window_start_line: z.number().int().nonnegative(),
  viewport_start_line: z.number().int().nonnegative(),
  scrollback_lines: z.number().int().nonnegative(),
  omitted_before_lines: z.number().int().nonnegative(),
  cursor: z.object({
    column: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
  }).strict(),
  lines: z.array(PtyTerminalScreenLineSchema).readonly(),
}).strict();

export const CommandToolOutputDisplaySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('pipe'),
    coverage: z.enum(['complete', 'omitted']),
    outputPhase: z.enum(['open', 'closed']),
    textProjection: z.enum(['available', 'failed']),
    incompleteReasons: z.array(CommandOutputIncompleteReasonSchema).readonly().optional(),
  }).strict(),
  z.object({
    mode: z.literal('pty'),
    coverage: z.enum(['complete', 'omitted']),
    outputPhase: z.enum(['open', 'closed']),
    textProjection: z.enum(['available', 'failed']),
    incompleteReasons: z.array(CommandOutputIncompleteReasonSchema).readonly().optional(),
    screen: PtyTerminalScreenProjectionSchema.optional(),
  }).strict(),
]);

const CommandOutputTextStoreResourceSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('published'),
    completeness: z.enum(['complete', 'incomplete']),
    blob_id: ToolOutputBlobIdSchema,
    persisted_characters: z.number().int().nonnegative(),
    persisted_lines: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.literal('not_created'),
    reason: z.enum(['source_not_started', 'empty']),
  }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
]);

export const CommandOutputStoreSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('pipe'),
    stdout: CommandOutputTextStoreResourceSchema,
    stderr: CommandOutputTextStoreResourceSchema,
  }).strict(),
  z.object({
    mode: z.literal('pty'),
    terminal: CommandOutputTextStoreResourceSchema,
  }).strict(),
]);

export const ShellToolTerminalSummarySchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('exited'),
    exitCode: z.number().int().safe().nullable(),
    signal: z.string().min(1).max(128).nullable(),
  }).strict(),
  z.object({
    outcome: z.literal('terminated'),
    reason: z.enum(['cancelled', 'timed_out', 'owner_ended']),
    exitCode: z.number().int().safe().nullable(),
    signal: z.string().min(1).max(128).nullable(),
  }).strict(),
  z.object({
    outcome: z.literal('runtime_failure'),
    code: CommandRuntimeFailureCodeSchema,
  }).strict(),
]);

export const ShellToolPublicRejectionCodeSchema = z.enum([
  'invalid_arguments',
  'audit_unavailable',
  'permission_unavailable',
  'permission_denied',
  'approval_denied',
  'working_directory_unavailable',
  'capacity_unavailable',
  'runtime_unavailable',
  'execution_failed',
]);

export const ProcessToolPublicRejectionCodeSchema = z.enum([
  'unknown_handle',
  'handle_expired',
  'owner_ended',
  'incompatible_state',
  'owner_ending',
  'action_conflict',
  'invalid_cursor',
  'stdin_closed',
  'input_budget_exceeded',
  'action_not_supported',
  'interaction_failed',
]);

const ToolObservationSchema = z.string().min(1);
const ToolResultPresentationShape = {
  presentationText: ToolObservationSchema,
  tool_output_store: z.object({
    blob_id: ToolOutputBlobIdSchema,
  }).strict().optional(),
} as const;

export const ShellToolRuntimeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('running'),
    processHandle: CommandProcessHandleSchema,
    nextCursor: ProcessOutputCursorSchema,
    display: CommandToolOutputDisplaySchema,
    presentation: CommandExecutionPresentationFactsV1Schema,
    observation: ToolObservationSchema,
  }).strict(),
  z.object({
    status: z.literal('completed'),
    terminal: ShellToolTerminalSummarySchema,
    display: CommandToolOutputDisplaySchema.optional(),
    command_output_store: CommandOutputStoreSchema,
    presentation: CommandExecutionPresentationFactsV1Schema,
    observation: ToolObservationSchema,
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    code: ShellToolPublicRejectionCodeSchema,
    observation: ToolObservationSchema,
  }).strict(),
]);

export const ProcessToolRuntimeResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('running'),
    nextCursor: ProcessOutputCursorSchema,
    display: CommandToolOutputDisplaySchema,
    presentation: CommandExecutionPresentationFactsV1Schema,
    observation: ToolObservationSchema,
  }).strict(),
  z.object({
    status: z.literal('completed'),
    terminal: ShellToolTerminalSummarySchema,
    display: CommandToolOutputDisplaySchema.optional(),
    command_output_store: CommandOutputStoreSchema,
    presentation: CommandExecutionPresentationFactsV1Schema,
    observation: ToolObservationSchema,
  }).strict(),
  z.object({
    status: z.literal('accepted'),
    audit_status: z.enum(['complete', 'incomplete']).optional(),
    observation: ToolObservationSchema,
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    code: ProcessToolPublicRejectionCodeSchema,
    audit_status: z.enum(['complete', 'incomplete']).optional(),
    observation: ToolObservationSchema,
  }).strict(),
]);

export const ShellToolResultDataSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('running'),
    ...ToolResultPresentationShape,
    processHandle: CommandProcessHandleSchema,
    nextCursor: ProcessOutputCursorSchema,
    display: CommandToolOutputDisplaySchema,
    presentation: CommandExecutionPresentationFactsV1Schema.optional(),
  }).strict(),
  z.object({
    status: z.literal('completed'),
    ...ToolResultPresentationShape,
    terminal: ShellToolTerminalSummarySchema,
    command_output_store: CommandOutputStoreSchema.optional(),
    display: CommandToolOutputDisplaySchema.optional(),
    presentation: CommandExecutionPresentationFactsV1Schema.optional(),
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    ...ToolResultPresentationShape,
    code: ShellToolPublicRejectionCodeSchema,
  }).strict(),
]);

export const ProcessToolResultDataSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('running'),
    ...ToolResultPresentationShape,
    nextCursor: ProcessOutputCursorSchema,
    display: CommandToolOutputDisplaySchema,
    presentation: CommandExecutionPresentationFactsV1Schema.optional(),
  }).strict(),
  z.object({
    status: z.literal('completed'),
    ...ToolResultPresentationShape,
    terminal: ShellToolTerminalSummarySchema,
    command_output_store: CommandOutputStoreSchema.optional(),
    display: CommandToolOutputDisplaySchema.optional(),
    presentation: CommandExecutionPresentationFactsV1Schema.optional(),
  }).strict(),
  z.object({
    status: z.literal('accepted'),
    ...ToolResultPresentationShape,
    audit_status: z.enum(['complete', 'incomplete']).optional(),
  }).strict(),
  z.object({
    status: z.literal('rejected'),
    ...ToolResultPresentationShape,
    code: ProcessToolPublicRejectionCodeSchema,
    audit_status: z.enum(['complete', 'incomplete']).optional(),
  }).strict(),
]);

export const ShellToolStructuredResultSchema = z.object({
  data: ShellToolResultDataSchema,
  observation: ToolObservationSchema,
}).strict();

export const ProcessToolStructuredResultSchema = z.object({
  data: ProcessToolResultDataSchema,
  observation: ToolObservationSchema,
}).strict();

export type PtyTerminalColor = z.infer<typeof PtyTerminalColorSchema>;
export type PtyTerminalCellStyle = z.infer<typeof PtyTerminalCellStyleSchema>;
export type PtyTerminalCellMetric = z.infer<typeof PtyTerminalCellMetricSchema>;
export type PtyTerminalStyleRun = z.infer<typeof PtyTerminalStyleRunSchema>;
export type PtyTerminalScreenLine = z.infer<typeof PtyTerminalScreenLineSchema>;
export type PtyTerminalScreenProjection = z.infer<typeof PtyTerminalScreenProjectionSchema>;
export type CommandToolOutputDisplay = z.infer<typeof CommandToolOutputDisplaySchema>;
export type CommandOutputStore = z.infer<typeof CommandOutputStoreSchema>;
export type ShellToolTerminalSummary = z.infer<typeof ShellToolTerminalSummarySchema>;
export type ShellToolPublicRejectionCode = z.infer<typeof ShellToolPublicRejectionCodeSchema>;
export type ProcessToolPublicRejectionCode = z.infer<typeof ProcessToolPublicRejectionCodeSchema>;
export type ShellToolRuntimeResult = z.infer<typeof ShellToolRuntimeResultSchema>;
export type ProcessToolRuntimeResult = z.infer<typeof ProcessToolRuntimeResultSchema>;
export type ShellToolResultData = z.infer<typeof ShellToolResultDataSchema>;
export type ProcessToolResultData = z.infer<typeof ProcessToolResultDataSchema>;
export type ShellToolStructuredResult = z.infer<typeof ShellToolStructuredResultSchema>;
export type ProcessToolStructuredResult = z.infer<typeof ProcessToolStructuredResultSchema>;
