import { KnowledgeVectorStartupError } from '../../infrastructure/vector-store/errors';
import {
  KnowledgeIndexRebuildRequiredError,
  KnowledgeIndexSpaceMismatchError,
} from '../../index-rebuild/definitions/knowledgeIndex';
import { KnowledgeSearchEmbeddingError } from './knowledgeSearchEmbeddingError';
import { KnowledgeSearchRerankError } from './knowledgeSearchRerankError';

export type ReasonedSearchFailure =
  | KnowledgeVectorStartupError
  | KnowledgeSearchEmbeddingError
  | KnowledgeSearchRerankError
  | KnowledgeIndexRebuildRequiredError
  | KnowledgeIndexSpaceMismatchError;

/**
 * 已知原因、自带英文工具说明（toolMessage）的检索失败。
 *
 * 搜索工具与多库聚合共用这一份判定：前者把它换成面向 Agent 的英文错误，后者把它写进部分失败说明。
 * 新增带原因的检索失败时只在这里登记，界面文案在 IPC 的本地化键映射里同步补上。
 */
export function isReasonedSearchFailure(error: unknown): error is ReasonedSearchFailure {
  return (
    error instanceof KnowledgeVectorStartupError ||
    error instanceof KnowledgeSearchEmbeddingError ||
    error instanceof KnowledgeSearchRerankError ||
    error instanceof KnowledgeIndexRebuildRequiredError ||
    error instanceof KnowledgeIndexSpaceMismatchError
  );
}
