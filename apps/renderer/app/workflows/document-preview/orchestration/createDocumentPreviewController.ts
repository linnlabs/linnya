import type { WorkspaceMutationEvent } from '@app/schemas';
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
import type { DocumentPreviewMessageKey } from '../definitions/documentPreviewMessages';
import { DocumentPreviewUserError } from '../definitions/documentPreviewUserError';
import { assertDocumentPreviewScope } from '../functions/assertDocumentPreviewScope';
import {
  isSameDocumentPreview,
  isSameDocumentPreviewTarget,
} from '../functions/isSameDocumentPreview';
import { resolveCurrentDocumentPreviewMessage } from '../functions/resolveCurrentDocumentPreviewMessage';
import { createDocumentPreviewState } from '../store/documentPreviewState';

/** 文件夹事件只改所在项目里的路径。事件没带项目（null）时无法排除，按相关处理。 */
function touchesProject(
  event: Extract<WorkspaceMutationEvent, { nodeType: string }>,
  projectId: string
): boolean {
  if (event.type === 'workspace.node.transferred')
    return event.sourceProjectId === projectId || event.targetProjectId === projectId;
  return event.projectId === null || event.projectId === projectId;
}

/** 内部原因只进日志；界面只显示可展示的失败，其余给通用提示。 */
function failureNotice(failure: unknown, fallback: DocumentPreviewMessageKey): string {
  console.warn('[document-preview] failed', failure);
  return failure instanceof DocumentPreviewUserError
    ? failure.message
    : resolveCurrentDocumentPreviewMessage(fallback);
}

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
    try {
      const identity = target();
      // 同一目标重新读取时旧内容留在原处，读完再替换，否则每次工作区变更都会闪一下；换目标才撤下。
      if (!isSameDocumentPreviewTarget(state.peek()?.target, identity)) state.loading();
      const presentation = await readDocumentReference(identity);
      target();
      if (disposed || token !== generation) return;
      const preview = await readDocumentPreview({
        ...identity,
        widthPx: 640,
        pixelRatio: Math.min(devicePixelRatio, 2),
      });
      target();
      if (disposed || token !== generation) return;
      const next = { target: identity, presentation, preview },
        shown = state.peek();
      // 内容没变就不换结果，消费方也就不重建表面。
      if (!shown || !isSameDocumentPreview(shown, next)) state.loaded(next);
    } catch (failure) {
      if (!disposed && token === generation)
        state.failed(failureNotice(failure, 'documentPreview.error.read'));
    }
  }
  const stopMutation = subscribeToWorkspaceMutation(event => {
    let documentId: string, projectId: string;
    try {
      ({ documentId, projectId } = readTarget());
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
      // 文件夹改名、移动、删除只改所在项目里的路径；事件没带项目（null）时无法排除。
      ('nodeType' in event && event.nodeType === 'folder' && touchesProject(event, projectId))
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
        if (
          disposed ||
          state.result.value !== value ||
          presentation.status !== 'available' ||
          !presentation.nodeType
        )
          return;
        await getWorkspaceNavigationPort().openDocumentByNodeType({
          ...identity,
          nodeType: presentation.nodeType,
          displayName: presentation.title,
        });
      } catch (failure) {
        if (!disposed) state.failed(failureNotice(failure, 'documentPreview.error.open'));
      }
    },
    async recover(action: DocumentTypeRecoveryAction) {
      try {
        await action.activate();
        await refresh();
      } catch (failure) {
        if (!disposed) state.failed(failureNotice(failure, 'documentPreview.error.recover'));
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
