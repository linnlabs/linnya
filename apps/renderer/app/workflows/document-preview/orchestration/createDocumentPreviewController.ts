import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { readDocumentReference } from '@plugin/renderer/documentReferences';
import { readDocumentPreview } from '@plugin/renderer/documentPreview';
import { subscribeRendererPluginAvailability } from '@plugin/renderer/pluginRuntime';
import { subscribeToWorkspaceMutation } from '@/shared/ipc/workspaceMutationSubscription';
import type { DocumentTypeRecoveryAction } from '@/app/plugins/documentTypePresentation';
import type {
  DocumentPreviewTarget,
  DocumentPreviewPresentation,
} from '../definitions/documentPreview';
import { assertDocumentPreviewScope } from '../functions/assertDocumentPreviewScope';
import { createDocumentPreviewState } from '../store/documentPreviewState';

/** App唯一只读预览读取与订阅生命周期；不改正文、引用快照或文件会话。 */
export function createDocumentPreviewController(
  readTarget: () => DocumentPreviewTarget,
  currentProjectId: () => string | null
) {
  const state = createDocumentPreviewState();
  let generation = 0,
    disposed = false;
  const target = () => {
    const value = readTarget();
    assertDocumentPreviewScope(value, currentProjectId());
    return value;
  };
  async function refresh(): Promise<void> {
    const token = ++generation;
    state.loading();
    try {
      const identity = target(),
        presentation = await readDocumentReference(identity);
      target();
      if (disposed || token !== generation) return;
      const preview = await readDocumentPreview({
        ...identity,
        widthPx: 640,
        pixelRatio: Math.min(devicePixelRatio, 2),
      });
      target();
      if (!disposed && token === generation)
        state.loaded({ target: identity, presentation, preview });
    } catch (failure) {
      if (!disposed && token === generation)
        state.failed(failure instanceof Error ? failure.message : '无法预览文档');
    }
  }
  const stopMutation = subscribeToWorkspaceMutation(event => {
    let documentId: string;
    try {
      documentId = readTarget().documentId;
    } catch {
      void refresh();
      return;
    }
    const ids =
      event.type === 'workspace.node.deleted'
        ? event.deletedNodeIds
        : event.type === 'workspace.node.transferred'
          ? event.movedNodeIds
          : event.type === 'workspace.document.updated'
            ? [event.documentId]
            : 'nodeId' in event
              ? [event.nodeId]
              : [];
    const detail = state.result.value?.preview.content?.detail;
    if (
      ids.includes(documentId) ||
      (detail?.format === 'workspace-markdown' && ids.some(id => id in detail.references)) ||
      event.type === 'project.deleted' ||
      ('nodeType' in event && event.nodeType === 'folder')
    )
      void refresh();
  });
  const stopAvailability = subscribeRendererPluginAvailability(changes => {
    const type = state.result.value?.presentation.nodeType;
    if (!type || changes.some(change => change.documentNodeTypes.includes(type))) void refresh();
  });
  return {
    result: state.result,
    error: state.error,
    refresh,
    isCurrent(value: DocumentPreviewPresentation): boolean {
      return (
        !disposed && state.result.value === value && value.target.projectId === currentProjectId()
      );
    },
    async open(value: DocumentPreviewPresentation) {
      if (state.result.value !== value) return;
      try {
        const identity = target();
        const presentation = await readDocumentReference(identity);
        target();
        if (disposed || state.result.value !== value || presentation.status !== 'available' || !presentation.nodeType) return;
        await getWorkspaceNavigationPort().openDocumentByNodeType({ ...identity, nodeType: presentation.nodeType, displayName: presentation.title });
      } catch (failure) {
        if (!disposed) state.failed(failure instanceof Error ? failure.message : '无法打开文档');
      }
    },
    async recover(action: DocumentTypeRecoveryAction) {
      try {
        await action.activate();
        await refresh();
      } catch (failure) {
        if (!disposed)
          state.failed(failure instanceof Error ? failure.message : '无法启用对应插件');
      }
    },
    dispose() {
      disposed = true;
      generation++;
      stopMutation();
      stopAvailability();
      state.clear();
    },
  };
}
