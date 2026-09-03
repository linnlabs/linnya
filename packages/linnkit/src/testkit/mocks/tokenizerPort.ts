import type { LlmRequestMessage, TokenizerPort } from '../../ports';

export interface MockTokenizerPortOptions {
  /** 每段 text 固定返回的 token 数，默认 10。 */
  tokensPerText?: number;
  /** 每条 message 固定返回的 token 数，默认 50。 */
  tokensPerMessage?: number;
  /** 自定义 text 估算逻辑，优先级高于 tokensPerText。 */
  estimateText?: (text: string, modelId?: string) => number;
  /** 自定义 message 估算逻辑，优先级高于 tokensPerMessage。 */
  estimateMessage?: (message: LlmRequestMessage, modelId?: string) => number;
}

export function createMockTokenizerPort(options: MockTokenizerPortOptions = {}): TokenizerPort {
  const tokensPerText = options.tokensPerText ?? 10;
  const tokensPerMessage = options.tokensPerMessage ?? 50;

  return {
    estimateText(text, modelId) {
      return options.estimateText?.(text, modelId) ?? tokensPerText;
    },
    estimateMessage(message, modelId) {
      return options.estimateMessage?.(message, modelId) ?? tokensPerMessage;
    },
  };
}
