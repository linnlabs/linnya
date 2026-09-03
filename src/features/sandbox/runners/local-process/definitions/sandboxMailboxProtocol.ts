import { z } from 'zod';

import type { SandboxRunnerRequest } from '../../../definitions/sandboxRunner.js';
import type { SandboxJsonValue } from '../../../types.js';
import type { SandboxRunnerEvaluationResult } from '../../../runner-evaluation/definitions/sandboxRunnerEvaluation.js';
import { SandboxHeapLimitMbSchema } from './sandboxRuntimeLimits.js';

export const SANDBOX_MAILBOX_PROTOCOL_VERSION = 1;
export const SANDBOX_MAILBOX_REQUEST_FILE_NAME = 'request.json';
export const SANDBOX_MAILBOX_RESULT_FILE_NAME = 'result.json';
export const SANDBOX_MAILBOX_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
export const SANDBOX_MAILBOX_RESULT_MAX_BYTES = 4 * 1024 * 1024;

const SandboxRunTokenSchema = z.string().regex(/^[a-f0-9]{32}$/u);

const SandboxJsonValueSchema: z.ZodType<SandboxJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(SandboxJsonValueSchema),
  z.record(SandboxJsonValueSchema),
]));

const PositiveSafeIntegerSchema = z.number().int().positive().safe();
const NonNegativeFiniteNumberSchema = z.number().nonnegative().finite();

const SandboxRunnerRequestSchema = z.object({
  runId: z.string().min(1),
  profileId: z.string().min(1),
  language: z.enum(['javascript', 'typescript']),
  source: z.string(),
  globals: z.record(SandboxJsonValueSchema),
  bindings: z.array(z.object({
    kind: z.literal('capability'),
    globalName: z.string().min(1),
    capability: z.string().min(1),
  }).strict()),
  limits: z.object({
    timeoutMs: PositiveSafeIntegerSchema,
    maxLogLines: PositiveSafeIntegerSchema,
    maxLogLineLength: PositiveSafeIntegerSchema,
    maxResultBytes: PositiveSafeIntegerSchema,
    maxSourceBytes: PositiveSafeIntegerSchema,
    maxCapabilityPayloadBytes: PositiveSafeIntegerSchema,
    maxHeapMb: SandboxHeapLimitMbSchema,
    idleTimeoutMs: PositiveSafeIntegerSchema,
  }).strict(),
  capabilities: z.array(z.object({
    name: z.string().min(1),
    maxCalls: z.number().int().nonnegative().safe().optional(),
    maxBytes: z.number().int().nonnegative().safe().optional(),
    timeoutMs: z.number().nonnegative().finite().optional(),
    allowHosts: z.array(z.string()).optional(),
    allowReadPaths: z.array(z.string()).optional(),
    allowWritePaths: z.array(z.string()).optional(),
  }).strict()),
  telemetry: z.object({
    conversationId: z.string().optional(),
    turnId: z.string().optional(),
    parentToolCallId: z.string().optional(),
    metadata: z.record(SandboxJsonValueSchema).optional(),
  }).strict().optional(),
}).strict();

const SandboxRunnerEvaluationResultSchema = z.object({
  success: z.boolean(),
  value: SandboxJsonValueSchema.optional(),
  logs: z.array(z.string()),
  error: z.object({
    type: z.enum([
      'syntax',
      'runtime',
      'timeout',
      'security',
      'compile',
      'policy_denied',
      'resource_exhausted',
      'transport',
    ]),
    message: z.string(),
    line: NonNegativeFiniteNumberSchema.optional(),
    column: NonNegativeFiniteNumberSchema.optional(),
    stack: z.string().optional(),
  }).strict().optional(),
  elapsedMs: NonNegativeFiniteNumberSchema,
  capabilityCalls: z.array(z.object({
    name: z.string().min(1),
    payload: SandboxJsonValueSchema.optional(),
  }).strict()),
  deniedActions: z.array(z.string()),
}).strict();

export const SandboxRequestMailboxEnvelopeSchema = z.object({
  protocol_version: z.literal(SANDBOX_MAILBOX_PROTOCOL_VERSION),
  kind: z.literal('sandbox_request'),
  run_token: SandboxRunTokenSchema,
  request: SandboxRunnerRequestSchema,
}).strict();

export const SandboxResultMailboxEnvelopeSchema = z.object({
  protocol_version: z.literal(SANDBOX_MAILBOX_PROTOCOL_VERSION),
  kind: z.literal('sandbox_result'),
  run_token: SandboxRunTokenSchema,
  result: SandboxRunnerEvaluationResultSchema,
}).strict();

export interface SandboxRequestMailboxEnvelope {
  readonly protocol_version: typeof SANDBOX_MAILBOX_PROTOCOL_VERSION;
  readonly kind: 'sandbox_request';
  readonly run_token: string;
  readonly request: SandboxRunnerRequest;
}

export interface SandboxResultMailboxEnvelope {
  readonly protocol_version: typeof SANDBOX_MAILBOX_PROTOCOL_VERSION;
  readonly kind: 'sandbox_result';
  readonly run_token: string;
  readonly result: SandboxRunnerEvaluationResult;
}

export type SandboxMailboxProtocolErrorCode =
  | 'invalid_run_token'
  | 'invalid_request_envelope'
  | 'invalid_result_envelope'
  | 'mailbox_token_mismatch'
  | 'mailbox_envelope_too_large'
  | 'mailbox_file_unavailable'
  | 'mailbox_file_not_regular'
  | 'mailbox_file_invalid_utf8'
  | 'mailbox_file_malformed_json'
  | 'mailbox_publish_failed';

/**
 * 邮箱可能包含用户源码、globals 和结构化结果。协议错误只保留稳定分类和大小，
 * 不能把原始文本、可逆十六进制或文件内容带进诊断日志。
 */
export class SandboxMailboxProtocolError extends Error {
  constructor(
    readonly code: SandboxMailboxProtocolErrorCode,
    readonly byteLength?: number,
  ) {
    super(byteLength === undefined
      ? `Sandbox mailbox protocol failed: ${code}`
      : `Sandbox mailbox protocol failed: ${code}; bytes=${byteLength}`);
    this.name = 'SandboxMailboxProtocolError';
  }
}

export function parseSandboxRunToken(value: unknown): string {
  const parsed = SandboxRunTokenSchema.safeParse(value);
  if (!parsed.success) throw new SandboxMailboxProtocolError('invalid_run_token');
  return parsed.data;
}

export function parseSandboxRequestMailboxEnvelope(
  value: unknown,
): SandboxRequestMailboxEnvelope {
  const parsed = SandboxRequestMailboxEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new SandboxMailboxProtocolError('invalid_request_envelope');
  }
  return parsed.data;
}

export function parseSandboxResultMailboxEnvelope(
  value: unknown,
): SandboxResultMailboxEnvelope {
  const parsed = SandboxResultMailboxEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new SandboxMailboxProtocolError('invalid_result_envelope');
  }
  return parsed.data;
}
