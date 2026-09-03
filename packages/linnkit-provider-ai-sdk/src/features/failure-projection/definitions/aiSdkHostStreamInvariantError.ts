export const AI_SDK_HOST_STREAM_INVARIANT_CODES = [
  'text_delta_without_start',
  'text_end_without_start',
  'reasoning_delta_without_start',
  'reasoning_end_without_start',
  'tool_delta_without_start',
  'invalid_tool_call',
  'tool_arguments_not_serializable',
  'stream_part_projection_failed',
] as const;

export type AiSdkHostStreamInvariantCode = (typeof AI_SDK_HOST_STREAM_INVARIANT_CODES)[number];

/** Host 自己检测到的确定性 stream 状态机违规；与上游断流或超时不是同一类失败。 */
export class AiSdkHostStreamInvariantError extends Error {
  constructor(readonly invariant_code: AiSdkHostStreamInvariantCode) {
    super(`AI SDK stream invariant failed: ${invariant_code}`);
    this.name = 'AiSdkHostStreamInvariantError';
  }
}
