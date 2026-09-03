import type { SendMessageOptions } from '../../../types';
import type { UserMessageContent } from '../../../definitions/userMessageContent';
import { validateRendererStructuredContextRequirements } from '@plugin/renderer/structuredContextRequirementPort';

export interface StructuredContextRequirementInput {
  userMessage: UserMessageContent;
  options: Pick<SendMessageOptions, 'context' | 'documentFragment' | 'fences'>;
}

export type StructuredContextRequirementResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * 中文说明：conversation 只执行已启用 renderer 插件注册的发送前校验；
 * 具体协议（例如某插件的精确源码 fence）由插件自己声明和卸载。
 */
export function validateStructuredContextRequirements(
  input: StructuredContextRequirementInput,
): StructuredContextRequirementResult {
  return validateRendererStructuredContextRequirements({
    prompt: input.userMessage.text,
    options: {
      ...input.options,
      userQuote: input.userMessage.userQuote,
    },
  });
}
