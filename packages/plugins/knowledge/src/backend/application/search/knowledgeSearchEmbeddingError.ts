import type { EmbeddingFailure } from '@plugin/backend/inferenceFailures';
import {
  readKnowledgeEmbeddingFailureReason,
  type KnowledgeEmbeddingFailureReason,
} from '../../infrastructure/inference/embeddingFailureReason';

/**
 * 给 Agent 工具的英文说明：写明原因、重试是否有用、该请用户去哪里修。
 * 与界面文案（knowledgeBase.search.error.embedding*）按同一个 reason 对应，恢复办法必须一致。
 */
const KNOWLEDGE_SEARCH_EMBEDDING_TOOL_MESSAGES: Readonly<Record<Exclude<KnowledgeEmbeddingFailureReason, 'request-failed'>, string>> = {
  'model-unavailable': 'Knowledge search failed: the embedding model used for this knowledge base is unavailable (it was removed, is not enabled, or the provider does not recognize it). Retrying will not help. Tell the user to check the embedding model in Settings › Models; if they switch to another embedding model, they must rebuild the search index in the knowledge base file manager.',
  credential: 'Knowledge search failed: the embedding model has no API key, or the provider rejected the key. Retrying will not help. Tell the user to check the API key of the embedding model provider in Settings › Models.',
};

/** 请求失败时重试是否有用取自 Host 合同的 retryable，不由插件猜测。 */
function readRequestFailedToolMessage(failure: EmbeddingFailure): string {
  const head = `Knowledge search failed: the request to the embedding model did not succeed (${failure.code}).`;
  return failure.retryable
    ? `${head} Retrying later may help; if it keeps failing, tell the user to check the network and the embedding model service in Settings › Models.`
    : `${head} Retrying will not help. Tell the user to check the embedding model service in Settings › Models.`;
}

/**
 * 检索时嵌入查询失败。
 *
 * 以前这类失败被检索服务吞掉、返回 0 条结果，用户只看到“没有匹配”，无从知道是模型坏了。
 * 现在作为带原因的检索失败上抛：界面按 reason 取本地化文案，Agent 工具用 toolMessage，
 * message 只作诊断（包含 Host 失败码与原文），不直接给用户看。
 */
export class KnowledgeSearchEmbeddingError extends Error {
  readonly reason: KnowledgeEmbeddingFailureReason;
  readonly toolMessage: string;

  constructor(failure: EmbeddingFailure) {
    const reason = readKnowledgeEmbeddingFailureReason(failure);
    super(`检索时嵌入模型调用失败（${reason}，${failure.code}）：${failure.message}`, { cause: failure });
    this.name = 'KnowledgeSearchEmbeddingError';
    this.reason = reason;
    this.toolMessage = reason === 'request-failed'
      ? readRequestFailedToolMessage(failure)
      : KNOWLEDGE_SEARCH_EMBEDDING_TOOL_MESSAGES[reason];
  }
}
