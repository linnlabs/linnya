import { ref } from 'vue';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import type { DocumentPreviewResult, DocumentReferencePresentation } from '@app/schemas';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { readDocumentPreview } from '@plugin/renderer/documentPreview';
import { subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { subscribeToWorkspaceMutation } from '@/shared/ipc/workspaceMutationSubscription';
import { readWorkspaceReferenceIdentity } from './definitions/workspaceReferenceIdentity';

/** App装配只读文档预览；动态结果属于本次hover，不修改composer发送快照。 */
export function createWorkspaceReferencePreview(reference: ConversationReferenceChipInput, currentProjectId: () => string | null) {
  const result = ref<{ presentation: DocumentReferencePresentation; preview: DocumentPreviewResult } | null>(null), error = ref<string | null>(null);
  let generation = 0, disposed = false;
  async function refresh() {
    const token = ++generation; result.value = null; error.value = null;
    try {
      const target = readWorkspaceReferenceIdentity(reference, currentProjectId());
      const presentation = await readDocumentReference(target);
      readWorkspaceReferenceIdentity(reference, currentProjectId());
      if (disposed || token !== generation) return;
      const preview = await readDocumentPreview({ ...target, widthPx: 640, pixelRatio: Math.min(devicePixelRatio, 2) });
      readWorkspaceReferenceIdentity(reference, currentProjectId());
      if (!disposed && token === generation) result.value = { presentation, preview };
    } catch (failure) { if (!disposed && token === generation) error.value = failure instanceof Error ? failure.message : '无法预览引用'; }
  }
  const stopMutation = subscribeToWorkspaceMutation(event => {
    const metadata = reference.metadata, documentId = typeof metadata?.documentId === 'string' ? metadata.documentId : '';
    const ids = event.type === 'workspace.node.deleted' ? event.deletedNodeIds : event.type === 'workspace.node.transferred' ? event.movedNodeIds : event.type === 'workspace.document.updated' ? [event.documentId] : 'nodeId' in event ? [event.nodeId] : [];
    if (ids.includes(documentId) || event.type === 'project.deleted' || 'nodeType' in event && event.nodeType === 'folder') void refresh();
  });
  const stopAvailability = subscribeRendererPluginAvailability(changes => {
    const type = result.value?.presentation.nodeType;
    if (!type || changes.some(change => change.documentNodeTypes.includes(type))) void refresh();
  });
  return { result, error, refresh, dispose() { disposed = true; generation++; stopMutation(); stopAvailability(); result.value = null; } };
}
