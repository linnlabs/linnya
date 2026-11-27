import type { RerankingFailure } from '@plugin/backend/inferenceFailures';

/**
 * 检索时重排模型失败且 Host 判定重试无用（模型不存在、缺凭据、服务端拒绝等）。
 *
 * 可重试的重排失败由 DefaultSearchRanker 降级为保留原排序，不会走到这里；
 * 不可重试的失败过去以 Host 原文上抛，界面显示中文诊断、Agent 也拿不到该转告用户什么。
 * message 只作诊断（含 Host 失败码与原文），界面按 IPC 本地化键显示，Agent 工具用 toolMessage。
 */
export class KnowledgeSearchRerankError extends Error {
  readonly toolMessage: string;

  constructor(failure: RerankingFailure) {
    super(`检索时重排模型调用失败（${failure.code}）：${failure.message}`, { cause: failure });
    this.name = 'KnowledgeSearchRerankError';
    this.toolMessage = `Knowledge search failed: the reranking model did not succeed (${failure.code}). Retrying will not help. Tell the user to check the reranking model and the API key of its provider in Settings › Models.`;
  }
}
