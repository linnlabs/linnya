import type {
  TokenCountConfidence,
  TokenCountSource,
  TokenRoute,
} from '../contracts';
import type { LlmRequestMessage } from './llm-call';

export interface TokenCountResult {
  inputTokens: number;
  imageInputTokens?: number;
  toolSchemaTokens?: number;
  source: Extract<TokenCountSource, 'provider-preflight-count' | 'host-supplied' | 'test-fixture'>;
  confidence: Extract<TokenCountConfidence, 'provider-estimate' | 'actual'>;
  raw?: unknown;
}

export interface TokenCounterPort {
  /**
   * Route-aware 的发送前 token 计数。
   *
   * 中文备注：host 必须按 input.route 调用对应 endpoint；禁止只看 modelId 后绕去“模型官网”。
   */
  countMessages(input: {
    route: TokenRoute;
    messages: LlmRequestMessage[];
    tools?: unknown;
    signal?: AbortSignal;
  }): Promise<TokenCountResult>;
}
