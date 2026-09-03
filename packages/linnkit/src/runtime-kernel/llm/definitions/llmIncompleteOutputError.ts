import { ENGINE_ERROR_CODES } from '../../../shared/errorClassifier';

export type LlmIncompleteOutputReason = 'length' | 'content_filter';

const ERROR_DETAILS: Record<LlmIncompleteOutputReason, {
  readonly code: string;
  readonly message: string;
}> = {
  length: {
    code: ENGINE_ERROR_CODES.LLM_OUTPUT_LIMIT_REACHED,
    message: 'LLM output reached the configured token limit before completion.',
  },
  content_filter: {
    code: ENGINE_ERROR_CODES.LLM_CONTENT_FILTERED,
    message: 'LLM output was stopped by the provider content filter.',
  },
};

/**
 * Provider 已正常结束传输，但没有交付完整 Assistant turn。
 *
 * 这类终态不能重试，也不能进入 Graph 决策：被截断的工具参数和正文都不是可执行事实；
 * 是否放宽输出预算或更换模型必须由下一次用户请求显式决定。
 */
export class LlmIncompleteOutputError extends Error {
  readonly errorCode: string;
  readonly recoverable = false;
  readonly metadata: Record<string, unknown>;

  constructor(reason: LlmIncompleteOutputReason) {
    const details = ERROR_DETAILS[reason];
    super(details.message);
    this.name = 'LlmIncompleteOutputError';
    this.errorCode = details.code;
    this.metadata = { finish_reason: reason };
  }
}
