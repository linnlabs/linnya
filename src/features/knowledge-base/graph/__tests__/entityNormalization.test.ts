import { describe, it, expect } from 'vitest';

import { toCanonicalId, toCanonicalName } from '../application/entityNormalization';

describe('entityNormalization (M2)', () => {
  it('toCanonicalName: 英文大小写 + 尾部空格', () => {
    expect(toCanonicalName('APPLE ')).toBe('apple');
  });

  it('toCanonicalId: Apple Inc. -> apple-inc', () => {
    const name = toCanonicalName('Apple Inc.');
    expect(name).toBe('apple inc');
    expect(toCanonicalId(name)).toBe('apple-inc');
  });

  it('多空格/全角标点/括号：保持中文，英文做归一', () => {
    const raw = '  苹果公司（Apple）　　Inc．  ';
    // 说明：NFKC 会把全角空格/全角点归一，括号/标点作为分隔符
    expect(toCanonicalName(raw)).toBe('苹果公司 apple inc');
    expect(toCanonicalId(toCanonicalName(raw))).toBe('苹果公司-apple-inc');
  });

  it('空字符串或全是符号：返回空', () => {
    expect(toCanonicalName('')).toBe('');
    expect(toCanonicalId('')).toBe('');
    expect(toCanonicalName('   ')).toBe('');
    expect(toCanonicalName('!!!')).toBe('');
    expect(toCanonicalId(toCanonicalName('!!!'))).toBe('');
  });
});


