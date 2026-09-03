import { describe, expect, it } from 'vitest';

import { resolveSubrunCardBodyState } from '../functions/resolveSubrunCardBodyState';

describe('resolveSubrunCardBodyState', () => {
  it('有投影内容时不展示占位状态', () => {
    expect(resolveSubrunCardBodyState({
      childCount: 1,
      lazyStatus: 'error',
    })).toBeNull();
  });

  it.each([
    { lazyStatus: 'idle' as const },
    { lazyStatus: 'loading' as const },
    { lazyStatus: 'preparing' as const },
    { lazyStatus: 'ready' as const },
  ])('未获得可展示过程时不渲染占位内容：%o', (state) => {
    expect(resolveSubrunCardBodyState({ childCount: 0, ...state })).toBeNull();
  });

  it('加载或投影失败时保留可重试的错误态', () => {
    expect(resolveSubrunCardBodyState({
      childCount: 0,
      lazyStatus: 'error',
    })).toBe('error');
    expect(resolveSubrunCardBodyState({
      childCount: 0,
      lazyStatus: 'ready',
      hasProjectionError: true,
    })).toBe('error');
  });
});
