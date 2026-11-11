import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockVersion } from '@/shared/ipc/blockHistoryGateway';
import { useBlockHistory } from './runtime';
const gateway = vi.hoisted(() => ({
  listVersions: vi.fn(),
  createVersion: vi.fn(),
  restoreVersion: vi.fn(),
  deleteVersion: vi.fn(),
}));
vi.mock('@/shared/ipc/blockHistoryGateway', () => ({ blockHistoryGateway: gateway }));
function version(id: string): BlockVersion {
  return {
    id,
    document_node_id: 'doc',
    target_block_id: 'block',
    block_type: 'baseBlock',
    version_number: 1,
    content_json: '{}',
    origin_type: 'manual',
    origin_metadata: null,
    created_at: 1,
  };
}
describe('块历史共享状态和异步流程', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockHistory().clearBlockHistory('block');
  });
  it('同一文档块并发加载只请求一次，所有消费者共享状态', async () => {
    let resolve: (response: { success: true; data: BlockVersion[] }) => void = () => {};
    gateway.listVersions.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const first = useBlockHistory(),
      second = useBlockHistory();
    const a = first.loadBlockHistory('doc', 'block'),
      b = second.loadBlockHistory('doc', 'block');
    expect(first.getUiState('block').isLoading).toBe(true);
    expect(gateway.listVersions).toHaveBeenCalledTimes(1);
    resolve({ success: true, data: [version('v1')] });
    await Promise.all([a, b]);
    expect(first).toBe(second);
    expect(second.getVersions('block').map(v => v.id)).toEqual(['v1']);
    expect(first.getUiState('block').isLoading).toBe(false);
  });
  it('创建前插、删除选中版本优先选择后一邻居，恢复后刷新版本事实', async () => {
    const runtime = useBlockHistory();
    gateway.listVersions.mockResolvedValue({ success: true, data: [version('v2'), version('v1')] });
    await runtime.loadBlockHistory('doc', 'block');
    runtime.selectVersion('block', 'v2');
    gateway.deleteVersion.mockResolvedValue({ success: true });
    await runtime.deleteVersion('v2');
    expect(runtime.getVersions('block').map(v => v.id)).toEqual(['v1']);
    expect(runtime.getUiState('block').selectedVersionId).toBe('v1');
    gateway.createVersion.mockResolvedValue({ success: true, data: version('v3') });
    await runtime.createVersion({
      documentNodeId: 'doc',
      targetBlockId: 'block',
      blockType: 'baseBlock',
      contentJson: '{}',
      originType: 'manual',
    });
    expect(runtime.getVersions('block').map(v => v.id)).toEqual(['v3', 'v1']);
    runtime.selectVersion('block', 'v1');
    await runtime.deleteVersion('v1');
    expect(runtime.getUiState('block').selectedVersionId).toBe('v3');
    gateway.restoreVersion.mockResolvedValue({ success: true, data: version('restored') });
    gateway.listVersions.mockResolvedValue({
      success: true,
      data: [version('restored'), version('v3')],
    });
    expect((await runtime.restoreVersion('doc', 'block', 'v3'))?.id).toBe('restored');
    expect(runtime.getVersions('block')[0].id).toBe('restored');
  });
});
