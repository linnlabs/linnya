import { v4 as uuidv4 } from 'uuid';
import type {
  WorkspaceNodeCreatedEvent,
  WorkspaceNodeDeletedEvent,
  WorkspaceNodeMovedEvent,
  WorkspaceNodeRenamedEvent,
  WorkspaceNodeTransferredEvent,
  WorkspaceNodeTransferResult,
} from '@app/schemas';

export interface WorkspaceMutationNodeSnapshot {
  readonly id: string;
  readonly project_id: string | null;
  readonly parent_id: string | null;
  readonly type: string;
  readonly name: string;
}

export function createWorkspaceNodeCreatedEvent(
  node: WorkspaceMutationNodeSnapshot,
): WorkspaceNodeCreatedEvent {
  return {
    type: 'workspace.node.created',
    mutationId: uuidv4(),
    projectId: node.project_id,
    nodeId: node.id,
    nodeType: node.type,
    parentId: node.parent_id,
    name: node.name,
  };
}

export function createWorkspaceNodeRenamedEvent(
  node: WorkspaceMutationNodeSnapshot,
  newName: string,
): WorkspaceNodeRenamedEvent {
  return {
    type: 'workspace.node.renamed',
    mutationId: uuidv4(),
    projectId: node.project_id,
    nodeId: node.id,
    nodeType: node.type,
    parentId: node.parent_id,
    name: newName,
    oldName: node.name,
  };
}

export function createWorkspaceNodeMovedEvent(
  node: WorkspaceMutationNodeSnapshot,
  newParentId: string | null,
): WorkspaceNodeMovedEvent {
  return {
    type: 'workspace.node.moved',
    mutationId: uuidv4(),
    projectId: node.project_id,
    nodeId: node.id,
    nodeType: node.type,
    parentId: newParentId,
    oldParentId: node.parent_id,
    name: node.name,
  };
}

export function createWorkspaceNodeTransferredEvent(
  result: WorkspaceNodeTransferResult,
): WorkspaceNodeTransferredEvent {
  return {
    type: 'workspace.node.transferred',
    mutationId: uuidv4(),
    nodeId: result.nodeId,
    nodeType: result.nodeType,
    name: result.nodeName,
    sourceProjectId: result.sourceProjectId,
    sourceParentId: result.sourceParentId,
    targetProjectId: result.targetProjectId,
    targetParentId: result.targetParentId,
    movedNodeIds: [...result.movedNodeIds],
  };
}

export function createWorkspaceNodeDeletedEvent(
  node: WorkspaceMutationNodeSnapshot,
  deletedNodeIds: readonly string[],
): WorkspaceNodeDeletedEvent {
  return {
    type: 'workspace.node.deleted',
    mutationId: uuidv4(),
    projectId: node.project_id,
    nodeId: node.id,
    nodeType: node.type,
    parentId: node.parent_id,
    name: node.name,
    deletedNodeIds: [...deletedNodeIds],
  };
}
