import type { LlmRequestMessage, TokenizerPort } from '../ports';
import { TokenCalculator } from './TokenCalculator';

export interface DefaultTokenizerPortConfig {
  /** Host 显式选择的 tiktoken encoding 名；未提供时使用字符/token 粗估。 */
  encoding?: string;
  /** tiktoken 不可用或不指定 encoding 时的字符/token 兜底比。 */
  avgCharsPerToken?: number;
  /** 单个 tool_call 的额外 token 开销估算。 */
  toolCallOverhead?: number;
}

/**
 * linnkit 默认 tokenizer。
 *
 * 中文备注：
 * - 这是 TokenCalculator 的薄包装，保持 0.7.x 默认行为；
 * - host 不注入 TokenizerPort 时，context-manager 自动使用该实现；
 * - 只用于上下文 budget 估算，不用于计费。
 */
export class DefaultTokenizerPort implements TokenizerPort {
  constructor(private readonly config: DefaultTokenizerPortConfig = {}) {}

  estimateText(text: string, _modelId?: string): number {
    return TokenCalculator.estimateTokens(text, {
      encoding: this.config.encoding,
      avgCharsPerToken: this.config.avgCharsPerToken,
    });
  }

  estimateMessage(message: LlmRequestMessage, _modelId?: string): number {
    return TokenCalculator.estimateMessageTokens(message, {
      encoding: this.config.encoding,
      avgCharsPerToken: this.config.avgCharsPerToken,
      toolCallOverhead: this.config.toolCallOverhead,
    });
  }

}

export function createDefaultTokenizerPort(config: DefaultTokenizerPortConfig = {}): TokenizerPort {
  return new DefaultTokenizerPort(config);
}
