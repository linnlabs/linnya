import type { DocumentReferencePresentation } from '@app/schemas';
import { queryDocumentReferences, readDocumentReference } from '@plugin/renderer/documentReferences';
import { getCurrentWorkspaceProjectId, showWorkspaceNotification } from '@plugin/renderer/workspaceRuntime';
import { readDocumentPreview } from '@plugin/renderer/documentPreview';
import { getWorkspaceNavigationPort } from '@plugin/renderer/workspaceNavigation';
import { subscribeToWorkspaceMutation } from '@shared/ipc/workspaceMutationSubscription';
import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';

function projectId(): string {
  const id = getCurrentWorkspaceProjectId();
  if (!id) throw new Error('Document reference needs an active project');
  return id;
}
export function createDocumentReferenceUiPort(): DocumentReferenceUiPort {
  const presentations = new Map<string, DocumentReferencePresentation>();
  const pending = new Map<string, Promise<DocumentReferencePresentation>>();
  const listeners = new Map<string, Set<() => void>>();
  let unsubscribe: (() => void) | undefined;
  const key = (id: string) => JSON.stringify([getCurrentWorkspaceProjectId(), id]);
  function subscribe(documentId: string, listener: () => void) {
    if (!unsubscribe) unsubscribe = subscribeToWorkspaceMutation(event => {
      const affected = event.type === 'workspace.node.deleted' ? event.deletedNodeIds : event.type === 'workspace.node.transferred' ? event.movedNodeIds : event.type === 'workspace.document.updated' ? [event.documentId] : 'nodeId' in event ? [event.nodeId] : [];
      for (const [id, callbacks] of listeners) if (affected.includes(id) || ('nodeType' in event && event.nodeType === 'folder') || event.type === 'project.deleted') { pending.delete(key(id)); presentations.delete(key(id)); for (const callback of callbacks) callback(); }
    });
    const callbacks = listeners.get(documentId) ?? new Set(); callbacks.add(listener); listeners.set(documentId, callbacks);
    return () => { callbacks.delete(listener); if (!callbacks.size) listeners.delete(documentId); };
  }
  return {
    getProjectId: getCurrentWorkspaceProjectId, subscribe,
    readCached: documentId => presentations.get(key(documentId)) ?? null,
    async query(keyword) {
      const result = await queryDocumentReferences({ projectId: projectId(), keyword, limit: 20 });
      for (const candidate of result) presentations.set(key(candidate.documentId), { documentId: candidate.documentId, title: candidate.title, nodeType: candidate.nodeType, path: candidate.path, status: 'available' });
      return result;
    },
    resolve(documentId) {
      const requestKey = key(documentId); const current = pending.get(requestKey); if (current) return current;
      const request: Promise<DocumentReferencePresentation> = readDocumentReference({ projectId: projectId(), documentId }).then(presentation => { if (pending.get(requestKey) === request) presentations.set(requestKey, presentation); return presentation; }).finally(() => { if (pending.get(requestKey) === request) pending.delete(requestKey); });
      pending.set(requestKey, request); return request;
    },
    preview: documentId => readDocumentPreview({ documentId, projectId: projectId(), widthPx: 640, pixelRatio: Math.min(window.devicePixelRatio, 2) }),
    async open(presentation) {
      if (presentation.status !== 'available' || !presentation.nodeType) {
        showWorkspaceNotification(presentation.status === 'plugin_unavailable' ? '需要启用或安装对应插件后打开' : '引用的文档当前不可访问', 'info'); return;
      }
      await getWorkspaceNavigationPort().openDocumentTarget({ documentId: presentation.documentId, projectId: projectId(), type: presentation.nodeType, displayName: presentation.title });
    },
    async renderDetail(element, markdown) {
      const runtime = await import('@linnya/markdown-document-core');
      element.classList.add('markdown-document-content'); element.append(runtime.createMarkdownDocumentFragment(runtime.parseMarkdownDocument(markdown), element.ownerDocument));
      const preventNavigation = (event: Event) => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); };
      element.addEventListener('click', preventNavigation);
      // 展开只创建只读 DOM，不装 NodeView，互相引用的文档不会递归请求预览。
      return () => { element.removeEventListener('click', preventNavigation); element.replaceChildren(); };
    },
    dispose() { unsubscribe?.(); unsubscribe = undefined; listeners.clear(); presentations.clear(); pending.clear(); },
    report(error) { console.warn('[document-reference] interaction failed', error); },
  };
}
