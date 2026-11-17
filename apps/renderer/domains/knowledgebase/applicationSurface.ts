import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { knowledgeBaseService } from '@/domains/knowledgebase/services/knowledgeBaseService';
import { useKnowledgeBase } from './runtime.js';
import { resolveCurrentKnowledgeBaseMessage as message } from './functions/resolveCurrentKnowledgeBaseMessage';
import { knowledgeMarkdownFilename } from './functions/knowledgeMarkdownFilename';
import { resolveKnowledgeSource } from './orchestration/resolveKnowledgeSource';
import type { KnowledgeMarkdownImport, KnowledgeSourceTarget } from './definitions/knowledgeApplicationSurface';

export async function prepareKnowledgePage(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const runtime = useKnowledgeBase();
  runtime.setCurrentKnowledgeBase(null);
  await runtime.ensureDataLoaded();
  signal.throwIfAborted();
}

/** Host 负责导航和冻结项目身份；这里仅定位知识库，不更改 Host 的页面/项目状态。 */
export async function openKnowledgeSource(target: KnowledgeSourceTarget, signal: AbortSignal): Promise<void> {
  const kbId = await resolveKnowledgeSource(target, signal, {
    async listProjectKnowledgeBaseIds(projectId) {
      const result = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({ projectId });
      if (!result.success) throw new Error(result.error || '无法读取项目的知识库关联');
      return result.data;
    },
    async listDocumentIds(id) {
      const result = await knowledgeBaseService.getDocuments(id);
      return result.documents.map(document => document.id);
    },
  });
  const runtime = useKnowledgeBase();
  await runtime.ensureDataLoaded();
  signal.throwIfAborted();
  if (runtime.error) throw new Error(runtime.error);
  runtime.setCurrentKnowledgeBase(kbId);
}

/** Markdown 快照已由 Host 按冻结文档身份读取；不接收 Editor 或 Host 工作区对象。 */
export async function addMarkdownDocumentToKb(input: KnowledgeMarkdownImport): Promise<{ fileName: string }> {
  input.signal.throwIfAborted();
  if (!input.targetKbId.trim()) throw new Error(message('knowledgeBase.addTo.error.targetRequired'));
  if (!input.markdown.trim()) throw new Error(message('knowledgeBase.addTo.error.emptyDocument'));
  const runtime = useKnowledgeBase();
  await runtime.ensureDataLoaded();
  input.signal.throwIfAborted();
  if (runtime.error) throw new Error(runtime.error);
  const fileName = knowledgeMarkdownFilename(input.documentName);
  runtime.addFilesToQueue(input.targetKbId, [new File([input.markdown], fileName, { type: 'text/markdown' })]);
  await runtime.startParsing();
  return { fileName };
}
