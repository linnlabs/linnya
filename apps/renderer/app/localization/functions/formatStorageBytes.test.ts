import { expect, test } from 'vitest';
import { formatStorageBytes } from './formatStorageBytes';

test('字节大小在单位边界、TB 和语言切换时使用同一显示规则', () => {
  for (const [bytes, expected] of [
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2, '1 MB'],
    [1024 ** 3, '1 GB'],
    [1024 ** 4, '1 TB'],
  ] as const) {
    expect(formatStorageBytes(bytes, 'en-US')).toBe(expected);
    expect(formatStorageBytes(bytes, 'zh-CN')).toBe(expected);
  }
  expect(formatStorageBytes(1536, 'de-DE')).toBe('1,5 KB');
});
