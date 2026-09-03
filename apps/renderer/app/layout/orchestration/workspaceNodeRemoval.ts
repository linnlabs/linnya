import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { workspaceGateway, type RecentDocumentDTO } from '@/shared/ipc/workspaceGateway';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { resolveDocumentTypeByNodeType } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { useWorkspaceSelectionStore } from '@/domains/workspace/store/WorkspaceSelectionStore';
import {
  useWorkspaceTreeStore,
  type WorkspaceNode,
} from '@/domains/workspace/store/WorkspaceTreeStore';
import type { PageSelectionNode } from '@/domains/workspace/features/page-selection-after-removal/definitions/pageSelectionAfterRemoval';
import { resolvePageSelectionAfterRemoval } from '@/domains/workspace/features/page-selection-after-removal/functions/resolvePageSelectionAfterRemoval';
import { showEmptyProjectFilesAfterRemoval } from './workspaceNavigation';

export function flattenLoadedWorkspaceTree(nodes: readonly WorkspaceNode[]): PageSelectionNode[] {
  const flattened: PageSelectionNode[] = [];
  const visit = (items: readonly WorkspaceNode[]) => {
    for (const node of items) {
      flattened.push({
        id: node.id,
        type: node.type,
        projectId: node.projectId,
        parentId: node.parentId,
        name: node.name,
      });
      if (node.children) visit(node.children);
    }
  };
  visit(nodes);
  return flattened;
}

function isEnabledPageNode(node: Pick<PageSelectionNode, 'type'>): boolean {
  const enabledPluginsStore = useEnabledPluginsStore();
  return resolveDocumentTypeByNodeType(
    node.type,
    enabledPluginsStore.enabledPluginIds,
    enabledPluginsStore.states,
  ).state === 'enabled';
}

function toPageSelectionNode(document: RecentDocumentDTO): PageSelectionNode | null {
  if (!document.project_id) return null;
  return {
    id: document.id,
    type: document.type,
    projectId: document.project_id,
    parentId: document.parent_id,
    name: document.name,
  };
}

export async function findRecentProjectPage(
  projectId: string,
  removedNodeIds: ReadonlySet<string>,
): Promise<PageSelectionNode | null> {
  const result = await workspaceGateway['get-recent-documents']({ projectId, limit: 64 });
  if (!result.success) throw new Error(result.error);

  for (const document of result.data) {
    if (removedNodeIds.has(document.id)) continue;
    const candidate = toPageSelectionNode(document);
    if (candidate && isEnabledPageNode(candidate)) return candidate;
  }
  return null;
}

export async function openWorkspacePage(node: PageSelectionNode): Promise<void> {
  const enabledPluginsStore = useEnabledPluginsStore();
  const availability = resolveDocumentTypeByNodeType(
    node.type,
    enabledPluginsStore.enabledPluginIds,
    enabledPluginsStore.states,
  );
  if (availability.state !== 'enabled') {
    throw new Error(`[workspaceNodeRemoval] page type is unavailable: ${node.type}`);
  }

  await getWorkspaceNavigationPort().openDocument({
    documentId: node.id,
    type: availability.documentType.activeDocumentType,
    projectId: node.projectId,
    displayName: node.name,
    parentId: node.parentId,
  });
  useWorkspaceSelectionStore().selectSingle(node.id);
}

export async function reconcilePageSelectionAfterRemoval(input: {
  readonly nodesBeforeRemoval: readonly PageSelectionNode[];
  readonly removedNodeIds: ReadonlySet<string>;
  readonly activeDocumentId: string | null;
  readonly projectId: string;
}): Promise<void> {
  const layoutStore = useLayoutStore();
  const activeDocumentWasRemoved = Boolean(
    input.activeDocumentId && input.removedNodeIds.has(input.activeDocumentId),
  );
  if (layoutStore.state.sidebarMode !== 'files') {
    if (activeDocumentWasRemoved) {
      layoutStore.closeDocument();
      useWorkspaceSelectionStore().clearSelection();
    }
    return;
  }

  const decision = resolvePageSelectionAfterRemoval({
    ...input,
    isPageNode: isEnabledPageNode,
  });
  if (decision.kind === 'preserve-active') {
    useWorkspaceSelectionStore().selectSingle(decision.documentId);
    return;
  }

  let candidate = decision.kind === 'select-page'
    ? input.nodesBeforeRemoval.find((node) => node.id === decision.documentId) ?? null
    : null;
  if (!candidate) {
    candidate = await findRecentProjectPage(input.projectId, input.removedNodeIds);
  }
  if (candidate) {
    await openWorkspacePage(candidate);
    return;
  }

  useWorkspaceSelectionStore().clearSelection();
  showEmptyProjectFilesAfterRemoval(input.projectId);
}

export async function refreshRemovedNodeParent(parentId: string | null): Promise<void> {
  const treeStore = useWorkspaceTreeStore();
  if (!parentId) {
    await treeStore.reloadActiveProjectTree();
    return;
  }
  const parentNode = treeStore.findNodeById(parentId);
  if (parentNode) {
    await treeStore.loadNodeChildren(parentNode);
    return;
  }
  await treeStore.reloadActiveProjectTree();
}
