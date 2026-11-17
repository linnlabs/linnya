import { z } from 'zod';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import type { OperationResult } from './workspaceGateway';

export type ProjectKbLinkRole = 'read_only' | 'read_write';
async function readIds(
  channel: string,
  target: Record<string, string>
): Promise<OperationResult<string[]>> {
  const result = await invokeRendererPluginIpc('knowledge', channel, target);
  if (!result.success) return { success: false, error: result.error ?? '无法读取知识库关联' };
  return { success: true, data: z.array(z.string()).parse(result.data) };
}
async function replace(
  channel: string,
  target: Record<string, string | string[]>
): Promise<OperationResult<void>> {
  const result = await invokeRendererPluginIpc('knowledge', channel, target);
  return result.success
    ? { success: true, data: undefined }
    : { success: false, error: result.error ?? '无法保存知识库关联' };
}
/** Host 既有项目入口通过正式插件能力协作；停用/读取失败不能伪装为空关联。 */
export const projectKbLinksGateway = {
  listProjectIdsForKnowledgeBase: (target: { kbId: string }) =>
    readIds('list-kb-project-links', target),
  listKnowledgeBaseIdsForProject: (target: { projectId: string }) =>
    readIds('list-project-kb-links', target),
  replaceKnowledgeBaseProjectLinks: (target: { kbId: string; projectIds: string[] }) =>
    replace('replace-kb-project-links', target),
  replaceProjectKnowledgeBaseLinks: (target: { projectId: string; kbIds: string[] }) =>
    replace('replace-project-kb-links', target),
};
export type IProjectKbLinksGateway = typeof projectKbLinksGateway;
