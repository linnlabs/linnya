import { AGENT_CONTEXT_BUILDER_CONFIG } from './context/config';
import { DEFAULT_MAX_STEPS } from '../../../contracts';

export const AGENT_CONSTANTS = {
  DEFAULT_MAX_STEPS,
  DEFAULT_TIMEOUT_MS: 300000,
  DEFAULT_MAX_RETRIES: 3,
  DEFAULT_RETRY_DELAY_MS: 1000,
} as const;

export interface AgentConfig {
  defaultModelId: string;
  maxSteps: number;
  defaultTools: string[];
  timeoutMs: number;
  debug: boolean;
  /**
   * @deprecated 不再参与上下文裁剪。
   * 中文备注：Agent 历史保留现在由 `contextPolicy.budget` 与 `contextPolicy.toolHistory`
   * 共同决定；保留这个字段只是为了兼容可能读取 `DEFAULT_AGENT_CONFIG` 的旧接入方。
   */
  maxHistoryLength: number;
  tokenBudget: {
    maxTokens: number;
    reservedForResponse: number;
  };
  contextProcessingTimeoutMs: number;
  retry: {
    maxRetries: number;
    enableEmptyResponseRetry: boolean;
    retryDelayMs: number;
  };
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  defaultModelId: 'default',
  maxSteps: AGENT_CONSTANTS.DEFAULT_MAX_STEPS,
  defaultTools: [],
  timeoutMs: AGENT_CONSTANTS.DEFAULT_TIMEOUT_MS,
  debug: false,
  maxHistoryLength: 100,
  tokenBudget: {
    maxTokens: AGENT_CONTEXT_BUILDER_CONFIG.DEFAULT_MAX_TOKENS,
    reservedForResponse: AGENT_CONTEXT_BUILDER_CONFIG.RESERVED_FOR_RESPONSE,
  },
  contextProcessingTimeoutMs: AGENT_CONTEXT_BUILDER_CONFIG.PROCESSING_TIMEOUT_MS,
  retry: {
    maxRetries: AGENT_CONSTANTS.DEFAULT_MAX_RETRIES,
    enableEmptyResponseRetry: true,
    retryDelayMs: AGENT_CONSTANTS.DEFAULT_RETRY_DELAY_MS,
  },
};
