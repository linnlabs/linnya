import { apiFetch } from '@/shared/services/localApiClient';
import type { ReadHistoricalKnowledgeSearchSnapshotRequest } from '../../../ports/knowledgeSearchHistoryPort';

/** 已保存的证据属于会话；插件停用后仍通过 Host 历史路由读取。 */
export async function readHistoricalKnowledgeSnapshot(
  request: ReadHistoricalKnowledgeSearchSnapshotRequest,
  fetchSnapshot: typeof apiFetch = apiFetch,
): Promise<unknown> {
  const query = new URLSearchParams({ conversation_id: request.conversationId });
  const response = await fetchSnapshot(
    `/api/v1/knowledge-base/citation-snapshots/bundles/${encodeURIComponent(request.bundleId)}?${query}`,
  );
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`读取历史引用失败（HTTP ${response.status}）`);
  }
  // 历史卡片的既有 codec 负责解释证据版本；此处不依赖活知识库或向量服务。
  return payload;
}
