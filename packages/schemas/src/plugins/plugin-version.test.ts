import { describe, expect, it } from 'vitest';

import { compareDottedVersions } from './plugin-version';

describe('插件点分版本比较', () => {
  it('逐段数值比较，缺位按 0', () => {
    expect(compareDottedVersions('0.2.0', '0.10.0')).toBe(-1);
    expect(compareDottedVersions('1.2', '1.2.0')).toBe(0);
    expect(compareDottedVersions('1.2.1', '1.2')).toBe(1);
  });

  it('非数字点分版本返回 null', () => {
    expect(compareDottedVersions('1.2.0-beta', '1.2.0')).toBeNull();
    expect(compareDottedVersions('', '1')).toBeNull();
    expect(compareDottedVersions('1..2', '1.2')).toBeNull();
  });
});
