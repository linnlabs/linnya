import { describe, expect, it } from 'vitest';
import { isReadingMode, resolveDeckReadingMode } from './readingMode';

describe('readingMode', () => {
  it('生成稿缺省按混合检查，声明后按声明', () => {
    expect(resolveDeckReadingMode('generated', undefined)).toBe('mixed');
    expect(resolveDeckReadingMode('generated', { reading: 'read' })).toBe('read');
  });

  it('导入稿和改稿不按阅读方式检查', () => {
    expect(resolveDeckReadingMode('imported', { reading: 'present' })).toBeUndefined();
    expect(resolveDeckReadingMode('patched', undefined)).toBeUndefined();
  });

  it('只接受三种阅读方式', () => {
    expect(isReadingMode('mixed')).toBe(true);
    expect(isReadingMode('Mixed')).toBe(false);
    expect(isReadingMode(undefined)).toBe(false);
  });
});
