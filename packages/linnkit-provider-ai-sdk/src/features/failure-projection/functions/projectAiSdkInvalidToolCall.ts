import { InvalidToolInputError, NoSuchToolError } from 'ai';
import { AiSdkToolCallError } from '../definitions/aiSdkToolCallError';

/**
 * SDK 的目录不是执行授权。未知 Host 工具返回 undefined，表示由 canonical object 校验后
 * 交 Host 范围/注册表 admission；不能替它改名、补定义或伪造工具结果。
 */
export function projectAiSdkInvalidToolCall(
  error: unknown,
  providerExecuted: boolean | undefined,
): AiSdkToolCallError | undefined {
  if (InvalidToolInputError.isInstance(error)) {
    return new AiSdkToolCallError('provider_tool_arguments_invalid');
  }
  if (NoSuchToolError.isInstance(error) && providerExecuted !== true) {
    return undefined;
  }
  return new AiSdkToolCallError('provider_tool_call_invalid');
}
