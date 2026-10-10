export type AiSdkToolCallErrorCode =
  | 'provider_tool_arguments_invalid'
  | 'provider_tool_not_found'
  | 'provider_tool_call_invalid';

/** 模型输出尚不能进入 canonical 工具完成态；不携带工具名、参数或 SDK 错误正文。 */
export class AiSdkToolCallError extends Error {
  constructor(readonly failure_code: AiSdkToolCallErrorCode) {
    super(`AI SDK tool call projection failed: ${failure_code}`);
    this.name = 'AiSdkToolCallError';
  }
}
