import type { LlmRequestMessage } from './llm-call';

/**
 * TokenizerPort · host 可替换的 token 估算协议。
 *
 * 中文备注：
 * - tokenizer 是“计算 token 的方法”的总称；
 * - linnkit 默认实现和 host 自定义实现都实现这个接口；
 * - 该 port 只服务上下文预算决策，不用于计费；
 * - 计费 token 应以 provider 返回的 usage 为准，由 host 自己消费。
 */
export interface TokenizerPort {
  /**
   * 估算纯文本 token 数。
   *
   * modelId 可用于 host 在多模型场景下选择不同 tokenizer。
   */
  estimateText(text: string, modelId?: string): number;

  /**
   * 估算一条 LLM message 的 token 数。
   *
   * 自定义实现应包含 message overhead、assistant_replay_parts 中的 canonical
   * text/reasoning、tool_call overhead 和 tool_call_id 开销；存在 replay parts 时
   * 不应再次计算同一条 Assistant 的投影 content；
   * 否则上下文预算会系统性低估。
   */
  estimateMessage(message: LlmRequestMessage, modelId?: string): number;
}
