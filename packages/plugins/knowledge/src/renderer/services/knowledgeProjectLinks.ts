import { z } from 'zod';
import { invokeKnowledgeRequest } from './knowledgeRequestSession';

const ids = z.array(z.string().min(1));

/** 关联事务由 Knowledge Backend owner 接纳；Renderer 不读取 Workspace store。 */
export async function readProjectKnowledgeBaseIds(projectId: string, signal?: AbortSignal): Promise<string[]> {
  return ids.parse(await invokeKnowledgeRequest('list-project-kb-links', { projectId }, signal));
}
export async function readKnowledgeBaseProjectIds(kbId: string, signal?: AbortSignal): Promise<string[]> {
  return ids.parse(await invokeKnowledgeRequest('list-kb-project-links', { kbId }, signal));
}
export async function replaceProjectKnowledgeBases(projectId: string, kbIds: readonly string[], signal?: AbortSignal): Promise<void> {
  await invokeKnowledgeRequest('replace-project-kb-links', { projectId, kbIds }, signal);
}
export async function replaceKnowledgeBaseProjects(kbId: string, projectIds: readonly string[], signal?: AbortSignal): Promise<void> {
  await invokeKnowledgeRequest('replace-kb-project-links', { kbId, projectIds }, signal);
}
