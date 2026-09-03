import { z } from 'zod';

export const CommandPipeOutputChannelSchema = z.enum(['stdout', 'stderr']);
export type CommandPipeOutputChannel = z.infer<typeof CommandPipeOutputChannelSchema>;

/**
 * 文本编码必须在启动前随 Shell runtime snapshot 冻结。输出处理只能消费该事实，
 * 不能按平台、分块内容或本机 code page 重新猜测，否则同一 raw byte 无法稳定重放。
 */
export const CommandOutputTextEncodingSchema = z.enum(['utf-8', 'windows-936']);
export type CommandOutputTextEncoding = z.infer<
  typeof CommandOutputTextEncodingSchema
>;

export function parseCommandOutputTextEncoding(
  value: unknown,
): CommandOutputTextEncoding {
  return CommandOutputTextEncodingSchema.parse(value);
}

export const CommandPtyOutputChannelSchema = z.literal('terminal');
export type CommandPtyOutputChannel = z.infer<typeof CommandPtyOutputChannelSchema>;

/** 每条输出流独立从 0 严格递增；不同 channel 不共享序号。 */
export const CommandOutputSequenceSchema = z.number().int().nonnegative().safe()
  .brand<'CommandOutputSequence'>();
export type CommandOutputSequence = z.infer<typeof CommandOutputSequenceSchema>;

/**
 * 与 Node/Codex 的 64 KiB 输出分片保持同一量级，避免单个 IPC event 绕过 host 的有界队列。
 * 这只是 transport 单块上限，不是命令总输出上限；runner 必须主动切块而不是截断输出。
 */
export const MAX_COMMAND_OUTPUT_EVENT_BYTES = 64 * 1024;

/**
 * runner 使用 advanced child IPC 传输真实 byte。默认 JSON IPC 会把 typed array
 * 降级成普通对象，因此生产 fork 必须显式选择该序列化模式。
 */
export const CommandOutputBytesSchema = z.custom<Uint8Array>(
  (value): value is Uint8Array => (
    value instanceof Uint8Array
    && value.byteLength > 0
    && value.byteLength <= MAX_COMMAND_OUTPUT_EVENT_BYTES
  ),
  `command output must be a non-empty Uint8Array no larger than ${MAX_COMMAND_OUTPUT_EVENT_BYTES} bytes`,
);
export type CommandOutputBytes = z.infer<typeof CommandOutputBytesSchema>;

/**
 * 表示 runner 到 host 的某条原始流是否完整交付。这里的 interrupted 不等于业务进程失败；
 * 它只说明 host 不能把自己收到的 byte 冒充该流全文。
 */
export const CommandOutputSourceCompletionSchema = z.enum(['complete', 'interrupted']);
export type CommandOutputSourceCompletion = z.infer<
  typeof CommandOutputSourceCompletionSchema
>;

export const CommandOutputInterruptionReasonSchema = z.enum([
  'runner_output_queue_overloaded',
  'stream_read_failed',
  'drain_deadline_exceeded',
  'runtime_lost',
]);
export type CommandOutputInterruptionReason = z.infer<
  typeof CommandOutputInterruptionReasonSchema
>;
