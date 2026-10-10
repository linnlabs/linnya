import type { WorkspaceVfsNode } from '../definitions/workspaceVfsNode';
import {
  WorkspaceVfsNodeAccessDeniedError,
  type WorkspaceVfsNodeAccessScope,
} from '../definitions/workspaceVfsNodeAccessScope';

export function canAccessWorkspaceVfsNode(
  node: WorkspaceVfsNode,
  scope: WorkspaceVfsNodeAccessScope | undefined
): boolean {
  // 系统视图拥有自己的虚拟 inode，但内容归属始终由真实节点身份决定。
  const workspaceNodeId =
    node.source === 'workspace_node' ? node.id : node.payload?.workspaceNodeId;
  return !workspaceNodeId || !scope?.excludedNodeIds.includes(workspaceNodeId);
}

export function assertWorkspaceVfsNodeAccess(
  node: WorkspaceVfsNode,
  scope: WorkspaceVfsNodeAccessScope | undefined
): void {
  if (!canAccessWorkspaceVfsNode(node, scope)) throw new WorkspaceVfsNodeAccessDeniedError();
}

export function assertWorkspaceNodeIdAccess(
  nodeId: string,
  scope: WorkspaceVfsNodeAccessScope | undefined
): void {
  if (scope?.excludedNodeIds.includes(nodeId)) throw new WorkspaceVfsNodeAccessDeniedError();
}
