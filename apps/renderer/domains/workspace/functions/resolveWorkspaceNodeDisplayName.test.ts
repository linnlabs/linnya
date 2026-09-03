import { describe, expect, it } from 'vitest';
import { resolveWorkspaceNodeDisplayName } from './resolveWorkspaceNodeDisplayName';

describe('resolveWorkspaceNodeDisplayName', () => {
  it('prefers displayName so plugin document extensions stay hidden in UI chrome', () => {
    expect(resolveWorkspaceNodeDisplayName({
      name: '供应链图谱.smap',
      displayName: '供应链图谱',
    }, '未命名')).toBe('供应链图谱');
  });

  it('falls back to protocol name when no display name is available', () => {
    expect(resolveWorkspaceNodeDisplayName({
      name: 'Research.md',
    }, '未命名')).toBe('Research.md');
  });

  it('keeps title as a legacy fallback before the caller fallback', () => {
    expect(resolveWorkspaceNodeDisplayName({
      title: '旧节点标题',
    }, '未命名')).toBe('旧节点标题');
  });
});
