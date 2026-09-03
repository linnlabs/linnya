import { describe, expect, it } from 'vitest';
import { applyExactTextReplacement, ExactTextReplacementError } from './applyExactTextReplacement';

describe('applyExactTextReplacement', () => {
  it('保持主流 edit_file 的 exact/unique 语义，并返回紧凑 diff 和行号', () => {
    const result = applyExactTextReplacement({
      source: ['before', 'old line', 'after'].join('\n'),
      oldString: 'old line',
      newString: ['new line 1', 'new line 2'].join('\n'),
      replaceAll: false,
    });

    expect(result).toMatchObject({
      text: ['before', 'new line 1', 'new line 2', 'after'].join('\n'),
      count: 1,
      changes: [{ oldStartLine: 2, oldEndLine: 2, newStartLine: 2, newEndLine: 3 }],
      diffTruncated: false,
    });
    expect(result.diff).toBe(
      ['@@ -2,1 +2,2 @@', '-old line', '+new line 1', '+new line 2'].join('\n')
    );
  });

  it('不唯一时报出所有 exact match 的起始行', () => {
    expect(() =>
      applyExactTextReplacement({
        source: ['same', 'middle', 'same'].join('\n'),
        oldString: 'same',
        newString: 'changed',
        replaceAll: false,
      })
    ).toThrowError(
      new ExactTextReplacementError(
        'OLD_STRING_NOT_UNIQUE',
        'old_string is not unique in the current file content. Exact matches start at lines 1, 3. Provide a larger string with more context or set replace_all=true.'
      )
    );
  });

  it('未命中完整块时只给候选行提示，不做模糊替换', () => {
    expect(() =>
      applyExactTextReplacement({
        source: ['const title = "new";', 'slide.add(title);'].join('\n'),
        oldString: ['const title = "old";', 'slide.add(title);'].join('\n'),
        newString: 'replacement',
        replaceAll: false,
      })
    ).toThrow(/Candidate lines.*2.*Use read_file/u);
  });
});
