import { Buffer } from 'node:buffer';
import { z } from 'zod';

export const PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const PLUGIN_CLI_MAX_ARG_COUNT = 64;
export const PLUGIN_CLI_MAX_ARG_LENGTH = 4_096;
/** bridge v1 仍是有界的 buffered plugin contract；预算按 stdout + stderr 的 UTF-8 bytes 计算。 */
export const PLUGIN_CLI_MAX_OUTPUT_BYTES = 8 * 1_024 * 1_024;
/** 与 Commands raw output event 使用同一安全帧量级，但协议所有权仍留在 bridge。 */
export const PLUGIN_CLI_OUTPUT_FRAME_BYTES = 64 * 1_024;
const PLUGIN_CLI_OUTPUT_FRAME_BASE64_LENGTH = Math.ceil(
  PLUGIN_CLI_OUTPUT_FRAME_BYTES / 3,
) * 4;

const PluginCliIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

const PluginCliArgSchema = z.string()
  .max(PLUGIN_CLI_MAX_ARG_LENGTH)
  .refine(value => !value.includes('\0'), 'plugin CLI arguments must not contain NUL');

export const PluginCliBridgeInvocationRequestV1Schema = z.object({
  protocol_version: z.literal(PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('plugin_cli_invoke'),
  plugin_id: PluginCliIdSchema,
  argv: z.array(PluginCliArgSchema).max(PLUGIN_CLI_MAX_ARG_COUNT),
}).strict();
export type PluginCliBridgeInvocationRequestV1 = z.infer<
  typeof PluginCliBridgeInvocationRequestV1Schema
>;

const PluginCliExecutionResultShapeSchema = z.object({
  exitCode: z.number().int().min(0).max(255).safe(),
  stdout: z.string(),
  stderr: z.string(),
}).strict();

function outputByteLength(result: { readonly stdout: string; readonly stderr: string }): number {
  return Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8');
}

export const PluginCliExecutionResultSchema = PluginCliExecutionResultShapeSchema.superRefine(
  (result, context) => {
    const observedBytes = outputByteLength(result);
    if (observedBytes <= PLUGIN_CLI_MAX_OUTPUT_BYTES) return;
    context.addIssue({
      code: 'custom',
      message: `combined stdout and stderr must not exceed ${PLUGIN_CLI_MAX_OUTPUT_BYTES} UTF-8 bytes`,
    });
  },
);
export type PluginCliExecutionResult = z.infer<typeof PluginCliExecutionResultSchema>;

export class PluginCliOutputLimitExceededError extends Error {
  constructor(
    readonly observedBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Plugin CLI output is ${observedBytes} bytes; maximum is ${maxBytes} bytes.`);
    this.name = 'PluginCliOutputLimitExceededError';
  }
}

const PluginCliBridgeOutputFrameV1Schema = z.object({
  protocol_version: z.literal(PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('plugin_cli_output'),
  channel: z.enum(['stdout', 'stderr']),
  bytes_base64: z.string().max(PLUGIN_CLI_OUTPUT_FRAME_BASE64_LENGTH),
}).strict();

const PluginCliBridgeTerminalFrameV1Schema = z.object({
  protocol_version: z.literal(PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('plugin_cli_terminal'),
  exit_code: z.number().int().min(0).max(255).safe(),
}).strict();

export const PluginCliBridgeFailureCodeSchema = z.enum([
  'plugin_unavailable',
  'permission_denied',
  'cancelled',
  'output_limit_exceeded',
  'runtime_failure',
]);
export type PluginCliBridgeFailureCode = z.infer<
  typeof PluginCliBridgeFailureCodeSchema
>;

const PluginCliBridgeFailureFrameV1Schema = z.object({
  protocol_version: z.literal(PLUGIN_CLI_BRIDGE_PROTOCOL_VERSION),
  kind: z.literal('plugin_cli_failure'),
  code: PluginCliBridgeFailureCodeSchema,
  message: z.string().min(1).max(1_024),
  exit_code: z.number().int().min(1).max(255).safe(),
}).strict();

export const PluginCliBridgeFrameV1Schema = z.discriminatedUnion('kind', [
  PluginCliBridgeOutputFrameV1Schema,
  PluginCliBridgeTerminalFrameV1Schema,
  PluginCliBridgeFailureFrameV1Schema,
]);
export type PluginCliBridgeFrameV1 = z.infer<typeof PluginCliBridgeFrameV1Schema>;

export function parsePluginCliBridgeInvocationRequest(
  value: unknown,
): PluginCliBridgeInvocationRequestV1 {
  return PluginCliBridgeInvocationRequestV1Schema.parse(value);
}

export function parsePluginCliExecutionResult(value: unknown): PluginCliExecutionResult {
  const result = PluginCliExecutionResultShapeSchema.parse(value);
  const observedBytes = outputByteLength(result);
  if (observedBytes > PLUGIN_CLI_MAX_OUTPUT_BYTES) {
    throw new PluginCliOutputLimitExceededError(
      observedBytes,
      PLUGIN_CLI_MAX_OUTPUT_BYTES,
    );
  }
  return result;
}

export function parsePluginCliBridgeFrame(value: unknown): PluginCliBridgeFrameV1 {
  return PluginCliBridgeFrameV1Schema.parse(value);
}
