import { describe, expect, it } from 'vitest';
import {
  formatCitationRef,
  isCanonicalCitationRef,
  normalizeCitationRef,
} from '../citationRef';

describe('Citation ref contract', () => {
  it('由同一 canonical 合同接纳裸 ref，并拒绝易混淆字符与错误长度', () => {
    expect(isCanonicalCitationRef('Abc234')).toBe(true);
    expect(isCanonicalCitationRef('ABC230')).toBe(false);
    expect(isCanonicalCitationRef('ABC23I')).toBe(false);
    expect(isCanonicalCitationRef('Abc23')).toBe(false);
  });

  it('把工具入参支持的三种外观归一为裸 ref', () => {
    expect(normalizeCitationRef(' Abc234 ')).toBe('Abc234');
    expect(normalizeCitationRef('@Abc234')).toBe('Abc234');
    expect(normalizeCitationRef('[@Abc234]')).toBe('Abc234');
    expect(normalizeCitationRef('[@ABC230]')).toBeUndefined();
    expect(normalizeCitationRef('prefix-Abc234')).toBeUndefined();
  });

  it('只格式化已经接纳的 canonical ref', () => {
    expect(formatCitationRef('Abc234')).toBe('[@Abc234]');
    expect(() => formatCitationRef('bad')).toThrow();
  });
});
