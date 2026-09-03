import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearWorkspaceMutationPublisherForTesting,
  createWorkspaceMutationPublisher,
  installWorkspaceMutationPublisher,
} from './workspaceMutationPublisherRegistry';

afterEach(clearWorkspaceMutationPublisherForTesting);

describe('workspaceMutationPublisherRegistry', () => {
  it('冻结唯一 App owner publisher，并在发布前解析共享事件合同', () => {
    const publish = vi.fn();
    installWorkspaceMutationPublisher(publish);
    installWorkspaceMutationPublisher(publish);
    const publisher = createWorkspaceMutationPublisher();
    const event = {
      type: 'workspace.node.created' as const,
      mutationId: 'mutation-1',
      projectId: 'project-1',
      nodeId: 'node-1',
      nodeType: 'markdown',
      parentId: null,
      name: 'Document',
      source: 'user' as const,
    };

    publisher.publish(event);
    expect(publish).toHaveBeenCalledWith(event);
    expect(() => installWorkspaceMutationPublisher(vi.fn())).toThrow('已安装另一实现');
  });

  it('未安装 App composition 时拒绝静默丢失 Workspace 事实', () => {
    expect(() => createWorkspaceMutationPublisher()).toThrow('尚未由 App composition 安装');
  });
});
