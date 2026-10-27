import { describe, expect, it } from 'vitest';
import { buildFileTree } from './buildFileTree';

describe('buildFileTree', () => {
  it('SKILL.md 在最前，目录作为分组标题且只出现一次，缩进来自路径深度', () => {
    const rows = buildFileTree(['references/b.md', 'notes.txt', 'SKILL.md', 'references/a.md', 'assets/deep/x.txt']);
    expect(rows.map(row => `${row.kind}:${row.depth}:${row.path}`)).toEqual([
      'file:0:SKILL.md',
      'directory:0:assets', 'directory:1:assets/deep', 'file:2:assets/deep/x.txt',
      'file:0:notes.txt',
      'directory:0:references', 'file:1:references/a.md', 'file:1:references/b.md',
    ]);
    expect(rows.find(row => row.path === 'references/a.md')?.label).toBe('a.md');
  });
});
