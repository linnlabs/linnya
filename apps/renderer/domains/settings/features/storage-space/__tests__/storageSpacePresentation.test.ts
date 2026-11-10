import { describe, expect, it } from 'vitest';

import { formatStorageBytes } from '@/shared/utils/formatStorageBytes';

describe('storage-space presentation', () => {

  it('以稳定单位展示常见存储大小', () => {
    expect(formatStorageBytes(0, 'zh-CN')).toBe('0 B');
    expect(formatStorageBytes(1536, 'en-US')).toBe('1.5 KB');
  });
});
