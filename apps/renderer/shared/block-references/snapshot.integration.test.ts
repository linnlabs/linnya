import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import * as refId from '../utils/refIdGenerator';
import { useBlockIndexSnapshotStore } from '../stores/blockIndexSnapshotStore';
import { registerBlockRefSnapshot } from './orchestration/registerBlockRefSnapshot';

describe('块引用内存快照', () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('整批计算成功才覆盖，保留输入副本、跨组件查询和 TTL 清理', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    const ids = ['block-a', 'block-b'];
    await registerBlockRefSnapshot('document', ids);
    const state = useBlockIndexSnapshotStore();
    const ref = await refId.generateRefId('block-b');
    expect(useBlockIndexSnapshotStore().resolveBlockId('document', ref)).toBe('block-b');
    ids.push('later'); expect(state.get('document')?.blockIds).toEqual(['block-a', 'block-b']);
    vi.advanceTimersByTime(state.ttlMs + 1);
    expect(state.resolveBlockId('document', ref)).toBeNull(); expect(state.snapshotCount).toBe(0);
  });
  it('失败或已有碰撞规则触发时不提交半份快照', async () => {
    await registerBlockRefSnapshot('document', ['old']);
    const state = useBlockIndexSnapshotStore(); const previous = state.get('document');
    vi.spyOn(refId, 'generateRefId').mockResolvedValue('#abcdef');
    await expect(registerBlockRefSnapshot('document', ['a', 'b'])).rejects.toThrow('ref 碰撞');
    expect(state.get('document')).toBe(previous); expect(state.get('document')?.blockIds).toEqual(['old']);
  });
});
