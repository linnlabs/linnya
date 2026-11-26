import { describe, expect, it } from 'vitest';

import { createMarkdownRepository, findMarkdownLinkProblems } from './markdownLocalLinks';

const INVARIANTS = [
  '# 不变量',
  '### INV-17 · strict schema 必须在真实边界执行',
  '<a id="inv-55-workflow-product"></a>',
  '### INV-55 · `workflow` 命名保留给显式工作流产品',
  '## 4. `user_quote` 结构化多引用 wire',
  '## 用法',
  '## 用法',
].join('\n');

const repository = createMarkdownRepository(
  [
    'docs/development/code-quality.md',
    'docs/conversation-platform/00-invariants.md',
    'scripts/diagnostics/code-quality/README.md',
    'scripts/diagnostics/code-quality/auditRepository.ts',
    'src/domains/citation/README.md',
  ],
  file => (file === 'docs/conversation-platform/00-invariants.md' ? INVARIANTS : '# 标题'),
);

function reasons(file: string, source: string): string[] {
  return findMarkdownLinkProblems(file, source, repository).map(problem => `${problem.line}:${problem.reason}:${problem.destination}`);
}

describe('findMarkdownLinkProblems', () => {
  it('多写一级 ../ 落到仓库外，在公开仓库里是坏链接', () => {
    expect(reasons('scripts/diagnostics/code-quality/README.md', [
      '见[代码质量规范](../../../../docs/development/code-quality.md)。',
      '见[代码质量规范](../../../docs/development/code-quality.md)。',
    ].join('\n'))).toEqual(['1:outside-repository:../../../../docs/development/code-quality.md']);
  });

  it('目标不在仓库文件清单里就是缺失，包括只在磁盘上存在的被忽略文件', () => {
    expect(reasons('scripts/diagnostics/code-quality/README.md', [
      '[已删除](../../../docs/audit/risk-register.md)',
      '[运行数据](../../../_dev_data/ci-local/summary.json)',
      '[同目录源码](./auditRepository.ts) [仓库根目录](../../../) [根相对](/src/domains/citation/README.md)',
    ].join('\n'))).toEqual([
      '1:missing-target:../../../docs/audit/risk-register.md',
      '2:missing-target:../../../_dev_data/ci-local/summary.json',
    ]);
  });

  it('锚点按 GitHub 规则生成：空格不合并、保留下划线、同名标题加序号，也认手写的 a id', () => {
    expect(reasons('docs/conversation-platform/01-identity.md', [
      '[A](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行)',
      '[B](./00-invariants.md#inv-55-workflow-product)',
      '[C](./00-invariants.md#4-user_quote-结构化多引用-wire)',
      '[D](./00-invariants.md#用法-1)',
      '[E](./00-invariants.md#inv-17-strict-schema-必须在真实边界执行)',
    ].join('\n'))).toEqual(['5:missing-anchor:./00-invariants.md#inv-17-strict-schema-必须在真实边界执行']);
  });

  it('代码块、行内代码、外部地址和脚注不当作仓库链接', () => {
    expect(reasons('docs/development/code-quality.md', [
      '```md',
      '[示例](../../../../outside.md)',
      '```',
      '`[示例](./missing.md)` 与 [外部](https://example.com/a.md) 和 [邮件](mailto:a@example.com)',
      '[^1]: 这是脚注正文',
      '[引用]: ./missing-reference.md',
    ].join('\n'))).toEqual(['6:missing-target:./missing-reference.md']);
  });
});
