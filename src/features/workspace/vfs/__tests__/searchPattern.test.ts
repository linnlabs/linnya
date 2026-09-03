import { describe, expect, it } from 'vitest';

import {
  buildUniqueTrigrams,
  compileWorkspaceSearchPattern,
  findLiteralMatchesInText,
} from '../functions/searchPattern';

describe('workspace grep search pattern', () => {
  it('为 literal 查询生成去重 trigram，供行级倒排索引缩小候选集', () => {
    expect(buildUniqueTrigrams('banana')).toEqual(['ban', 'ana', 'nan']);
    expect(buildUniqueTrigrams('中英文abc')).toEqual(['中英文', '英文a', '文ab', 'abc']);
    expect(buildUniqueTrigrams('ab')).toEqual([]);
  });

  it('默认大小写不敏感，返回 1-based 行列位置', () => {
    const compiled = compileWorkspaceSearchPattern({ pattern: 'alpha' });
    expect(findLiteralMatchesInText({
      text: 'Title\n  Alpha Beta\nalpha again',
      compiled,
      maxMatches: 10,
    })).toEqual([
      { line: 2, column: 3, preview: 'Alpha Beta' },
      { line: 3, column: 1, preview: 'alpha again' },
    ]);
  });

  it('支持大小写敏感搜索，避免 grep 精确搜索时误命中', () => {
    const compiled = compileWorkspaceSearchPattern({
      pattern: 'Alpha',
      caseSensitive: true,
    });
    expect(findLiteralMatchesInText({
      text: 'alpha\nAlpha',
      compiled,
      maxMatches: 10,
    })).toEqual([
      { line: 2, column: 1, preview: 'Alpha' },
    ]);
  });
});
