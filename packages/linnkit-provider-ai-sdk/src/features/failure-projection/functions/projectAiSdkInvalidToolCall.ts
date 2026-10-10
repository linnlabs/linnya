import { InvalidToolInputError, NoSuchToolError } from 'ai';
import { AiSdkToolCallError } from '../definitions/aiSdkToolCallError';

/** SDK 的 invalid 同时覆盖工具名与输入错误，不能据此推断流状态机损坏。 */
export function projectAiSdkInvalidToolCall(error: unknown): AiSdkToolCallError {
  if (InvalidToolInputError.isInstance(error)) {
    return new AiSdkToolCallError('provider_tool_arguments_invalid');
  }
  if (NoSuchToolError.isInstance(error)) {
    return new AiSdkToolCallError('provider_tool_not_found');
  }
  return new AiSdkToolCallError('provider_tool_call_invalid');
}
