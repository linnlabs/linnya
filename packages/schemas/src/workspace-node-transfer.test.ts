import { describe, expect, it } from 'vitest';
import {
  WorkspaceMutationEventSchema,
  WorkspaceNodeTransferRequestSchema,
  WorkspaceNodeTransferResultSchema,
} from './index';

describe('workspace node transfer contracts', () => {
  it('accepts the root-only transfer request and result', () => {
    expect(WorkspaceNodeTransferRequestSchema.parse({
      nodeId: 'node-1',
      targetProjectId: 'project-2',
    })).toEqual({
      nodeId: 'node-1',
      targetProjectId: 'project-2',
    });

    expect(WorkspaceNodeTransferResultSchema.parse({
      nodeId: 'node-1',
      nodeType: 'folder',
      nodeName: '资料',
      sourceProjectId: 'project-1',
      sourceParentId: 'folder-0',
      targetProjectId: 'project-2',
      targetParentId: null,
      movedNodeIds: ['node-1', 'node-2'],
    }).targetParentId).toBeNull();
  });

  it('accepts a cross-project mutation without an ambiguous projectId', () => {
    const event = WorkspaceMutationEventSchema.parse({
      type: 'workspace.node.transferred',
      mutationId: 'mutation-1',
      nodeId: 'node-1',
      nodeType: 'folder',
      name: '资料',
      sourceProjectId: 'project-1',
      sourceParentId: null,
      targetProjectId: 'project-2',
      targetParentId: null,
      movedNodeIds: ['node-1', 'node-2'],
    });

    expect(event.type).toBe('workspace.node.transferred');
  });
});
