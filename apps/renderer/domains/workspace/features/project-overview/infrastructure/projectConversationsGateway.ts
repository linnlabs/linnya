import {
  PROJECT_CONVERSATIONS_API_BASE,
  ProjectConversationDetailSchema,
  ProjectConversationsMeasureSchema,
  ProjectConversationsSchema,
  ProjectConversationsSearchSchema,
  type ProjectConversationDetail,
  type ProjectConversations,
  type ProjectConversationsMeasure,
  type ProjectConversationsSearch,
} from '@app/schemas';
import { apiFetch, getApiBaseUrl } from '@shared/services/aiService/common';

/** 项目对话页的 Backend 读取；返回值在这里按共享合同解析，调用方拿到的一定合法。 */
async function request(path: string, init?: RequestInit): Promise<unknown> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(`${baseUrl}${PROJECT_CONVERSATIONS_API_BASE}${path}`, init);
  if (!response.ok) throw new Error(`project conversations request failed: ${response.status}`);
  return response.json();
}

const project = (projectId: string) => `/${encodeURIComponent(projectId)}`;

export async function readProjectConversations(projectId: string): Promise<ProjectConversations> {
  return ProjectConversationsSchema.parse(await request(project(projectId)));
}

export async function readProjectConversationDetail(projectId: string, conversationId: string): Promise<ProjectConversationDetail> {
  return ProjectConversationDetailSchema.parse(
    await request(`${project(projectId)}/conversations/${encodeURIComponent(conversationId)}`),
  );
}

export async function searchProjectConversations(projectId: string, query: string): Promise<ProjectConversationsSearch> {
  return ProjectConversationsSearchSchema.parse(
    await request(`${project(projectId)}/search?q=${encodeURIComponent(query)}`),
  );
}

export async function measureProjectConversationStorage(
  projectId: string,
  conversationIds?: readonly string[],
): Promise<ProjectConversationsMeasure> {
  return ProjectConversationsMeasureSchema.parse(await request(`${project(projectId)}/storage/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(conversationIds ? { conversation_ids: conversationIds } : {}),
  }));
}

/** 清理对话的过程文件；复用存储空间的接口（工作目录归对话文件领域，删除走它的生命周期）。 */
export async function clearProjectConversationWorkFiles(conversationId: string): Promise<void> {
  const baseUrl = await getApiBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/storage-space/conversations/${encodeURIComponent(conversationId)}/work-directory`,
    { method: 'DELETE' },
  );
  if (response.status !== 204) throw new Error(`clear conversation work files failed: ${response.status}`);
}
