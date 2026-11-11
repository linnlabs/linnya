/** 两端共用的合同样例；明确计 code point 而非 grapheme，英文词不拆开。 */
export const TEXT_UNIT_CASES = [
  { text: '', count: 0, limit: 1, slice: '' },
  { text: '中文，hello world！', count: 4, limit: 3, slice: '中文，hello ' },
  { text: 'hello-world 42', count: 3, limit: 2, slice: 'hello-world ' },
  { text: '𠀀🙂A1', count: 3, limit: 2, slice: '𠀀🙂' },
  { text: '👩‍💻', count: 3, limit: 2, slice: '👩‍' },
  // 既有截短会在其他字符超限时回退前面的 ASCII 词；迁移不改变该行为。
  { text: 'hello🙂', count: 2, limit: 1, slice: '' },
  { text: '，。 \n', count: 0, limit: 1, slice: '，。 \n' },
  { text: 'alpha 中文', count: 3, limit: 0, slice: '' },
] as const;
