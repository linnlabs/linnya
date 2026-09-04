import { describe, expect, it } from 'vitest';

import { planMarkdownBlocks } from '../markdownBlockPlanner';

async function expectCanonicalRoundTrip(markdown: string): Promise<void> {
  const first = await planMarkdownBlocks(markdown);
  const second = await planMarkdownBlocks(first.blocks.join('\n\n'));

  expect(second.blocks).toEqual(first.blocks);
}

describe('markdownBlockPlanner', () => {
  it('returns canonical blocks for currently supported markdown structures', async () => {
    const result = await planMarkdownBlocks(
      [
        '# 标题',
        '',
        '第一段',
        '',
        '- one',
        '- two',
        '  - nested',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '$$',
        'E = mc^2',
        '$$'
      ].join('\n')
    );

    expect(result.blocks).toEqual([
      '# 标题',
      '第一段',
      '* one',
      '* two',
      '  * nested',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      '```latex\nE = mc^2\n```'
    ]);
  });

  it('preserves markdown hardBreak inside a single canonical block', async () => {
    const result = await planMarkdownBlocks('第一行  \n第二行');

    expect(result.blocks).toEqual(['第一行  \n第二行']);
  });

  it('把普通 comment 保持为无身份规划事实，并稳定分离正文', async () => {
    const markdown = '正文\n\n<!-- 建议补充依据 -->';
    const first = await planMarkdownBlocks(markdown);
    const second = await planMarkdownBlocks(markdown);

    expect(first.blocks).toEqual(second.blocks);
    expect(first.bodyBlocks).toEqual(['正文']);
    expect(first.annotationComments).toEqual([{
      targetBlockIndex: 0,
      parsed: { kind: 'plain', draft: { content: '建议补充依据' } },
    }]);
  });

  it('keeps fenced code as a single canonical block in mixed content', async () => {
    const result = await planMarkdownBlocks(
      ['- one', '', '```ts', 'const x = 1', '```'].join('\n')
    );

    expect(result.blocks).toEqual(['* one', '```ts\nconst x = 1\n```']);
  });

  it('preserves headings and fenced code for the long mixed payload regression', async () => {
    const result = await planMarkdownBlocks(
      [
        '# 测试文档 - 多段落插入示例',
        '',
        '这是一个测试文档，用于演示如何在Linnya中连续插入多个文本和段落。我将展示各种Markdown格式的使用。',
        '',
        '## 1. 基本段落',
        '',
        '这是第一个段落。在Linnya中，文档编辑是基于块的，每个段落、标题、列表项等都是独立的块。这种设计使得编辑更加灵活，可以精确控制每个部分的内容。',
        '',
        '这是第二个段落，与前一个段落之间有明显的分隔。在Markdown中，段落之间需要有空行才能正确显示为独立的段落。',
        '',
        '## 2. 列表示例',
        '',
        '### 无序列表',
        '- 第一项：文档编辑功能',
        '- 第二项：块级编辑系统',
        '- 第三项：非破坏性编辑',
        '  - 子项：用户批准修订',
        '  - 子项：预览模式支持',
        '- 第四项：多种文档类型支持',
        '',
        '### 有序列表',
        '1. 第一步：创建文档',
        '2. 第二步：编辑内容',
        '3. 第三步：保存修订',
        '4. 第四步：用户审核',
        '',
        '## 3. 代码示例',
        '',
        '### Python代码',
        '```python',
        'def hello_world():',
        '    """这是一个简单的Python函数示例"""',
        '    print("Hello, Linnya!")',
        '    return "测试成功"',
        '',
        '# 调用函数',
        '',
        'result = hello_world()',
        'print(f"结果: {result}")',
        '```',
        '',
        '### JavaScript代码',
        '```javascript',
        '// JavaScript示例',
        'function calculateSum(a, b) {',
        '    return a + b;',
        '}',
        '',
        'const total = calculateSum(10, 20);',
        'console.log(`总和: ${total}`);',
        '```',
        '',
        '## 4. 表格示例',
        '',
        '| 功能 | 描述 | 状态 |',
        '|------|------|------|',
        '| 块级编辑 | 每个段落都是独立的块 | ✅ 已实现 |',
        '| 非破坏性编辑 | 编辑生成修订，需用户批准 | ✅ 已实现 |',
        '| 多文档类型 | 支持Markdown、思维导图、表格 | ✅ 已实现 |',
        '| 知识库集成 | 可以引用知识库内容 | ✅ 已实现 |',
        '| 实时协作 | 多用户同时编辑 | 🔄 开发中 |',
      ].join('\n')
    );

    expect(result.blocks).toContain('## 1. 基本段落');
    expect(result.blocks).toContain('## 2. 列表示例');
    expect(result.blocks).toContain('### Python代码');
    const pythonBlock = result.blocks.find((block) => block.startsWith('```python\n'));
    expect(pythonBlock).toBeDefined();
    expect(pythonBlock).toContain('def hello_world():');
    expect(pythonBlock).toContain('# 调用函数');
    expect(pythonBlock).toContain('print(f"结果: {result}")');
    expect(pythonBlock?.trimEnd().endsWith('```')).toBe(true);

    const javascriptBlock = result.blocks.find((block) => block.startsWith('```javascript\n'));
    expect(javascriptBlock).toBeDefined();
    expect(javascriptBlock).toContain('function calculateSum(a, b) {');
    expect(javascriptBlock).toContain('console.log(`总和: ${total}`);');
    expect(javascriptBlock?.trimEnd().endsWith('```')).toBe(true);
    expect(result.blocks).not.toContain('# 调用函数');
    expect(result.blocks).not.toContain('# 调用函数');
  });

  it('filters empty leading and trailing paragraphs', async () => {
    const result = await planMarkdownBlocks('\n\n第一段\n\n第二段\n\n');

    expect(result.blocks).toEqual(['第一段', '第二段']);
  });

  it('is idempotent for canonical block outputs', async () => {
    const samples = [
      '普通段落',
      '第一行  \n第二行',
      '* 列表项',
      '```ts\nconst x = 1\n```',
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
      '```latex\nE = mc^2\n```',
      '> 引用'
    ];

    for (const sample of samples) {
      await expectCanonicalRoundTrip(sample);
    }
  });
});
