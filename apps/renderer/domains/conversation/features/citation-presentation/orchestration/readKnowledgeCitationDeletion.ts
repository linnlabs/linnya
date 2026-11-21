import { apiFetch } from '@/shared/services/localApiClient';

/** 读宿主已提交的删除事实，不依赖知识库当前是否可调用。 */
export async function readKnowledgeCitationDeletion(sourceId: string, signal: AbortSignal): Promise<boolean> {
  const response = await apiFetch(
    `/api/v1/knowledge-base/citation-sources/${encodeURIComponent(sourceId)}/deletion`,
    { signal },
  );
  if (!response.ok) throw new Error(`读取引用删除状态失败（HTTP ${response.status}）`);
  const value: unknown = await response.json();
  return typeof value === 'object' && value !== null && 'deleted' in value && value.deleted === true;
}
