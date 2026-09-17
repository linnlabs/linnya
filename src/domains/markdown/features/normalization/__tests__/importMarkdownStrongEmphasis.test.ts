import { describe, expect, it } from 'vitest';

import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import { planMarkdownBlocks } from '../markdownBlockPlanner';
import { validateMarkdownDocJson } from '../schemaLite';
import type { MarkdownDocJson, ProseMirrorJsonNode } from '../types';

function paragraphContent(document: MarkdownDocJson | null): ProseMirrorJsonNode[][] | undefined {
  return document?.content.map(root => root.content?.[0]?.content ?? []);
}

describe('真实 Markdown 导入的 strong 语义', () => {
  // CommonMark 0.31.2 §6.2 / example-425 允许 strong 嵌套；持久化 marks 应表达样式集合。
  // 必须使用真实 Node WASM，注入手写 BlockEvent 会漏掉事件栈到 marks 的转换缺陷。
  it.each([
    { name: '连续四星号', markdown: '****x****', boldText: 'x', tail: '' },
    { name: '内层结束后仍保留外层粗体', markdown: '**a **b** c** tail', boldText: 'a b c', tail: ' tail' },
    { name: '全角标点使后续星号形成嵌套', markdown: '**甲）**乙**丙**。', boldText: '甲）乙丙', tail: '。' },
  ])('应导入合法嵌套粗体：$name', async ({ markdown, boldText, tail }) => {
    const { docJson } = await importMarkdownToDocJson(markdown);
    const expected: ProseMirrorJsonNode[] = [
      { type: 'text', text: boldText, marks: [{ type: 'bold' }] },
    ];
    if (tail) expected.push({ type: 'text', text: tail });

    expect(paragraphContent(docJson)).toEqual([expected]);
  });

  it.each([
    { markdown: '*a *b* c* tail', mark: 'italic' },
    { markdown: '~~a ~~b~~ c~~ tail', mark: 'strike' },
  ])('其他同型嵌套样式也保留外层作用域：$mark', async ({ markdown, mark }) => {
    const { docJson } = await importMarkdownToDocJson(markdown);

    expect(paragraphContent(docJson)).toEqual([[
      { type: 'text', text: 'a b c', marks: [{ type: mark }] },
      { type: 'text', text: ' tail' },
    ]]);
  });

  it('嵌套粗体跨越硬换行时，换行节点也使用唯一的样式集合', async () => {
    const { docJson } = await importMarkdownToDocJson('****a  \nb****');

    expect(paragraphContent(docJson)).toEqual([[
      { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
      { type: 'hardBreak', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
    ]]);
  });

  it('合并重复粗体时保留不同链接的地址、标题及外层样式', async () => {
    const { docJson } = await importMarkdownToDocJson(
      '**[a **b** c](https://example.com/a "A") d** [z](https://example.com/b "B")',
    );

    expect(paragraphContent(docJson)).toEqual([[
      {
        type: 'text', text: 'a b c',
        marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/a', title: 'A' } }],
      },
      { type: 'text', text: ' d', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'z', marks: [{ type: 'link', attrs: { href: 'https://example.com/b', title: 'B' } }] },
    ]]);
  });

  it('表格单元格复用同一套嵌套粗体投影', async () => {
    const { docJson } = await importMarkdownToDocJson('| 标题 |\n| --- |\n| **a **b** c** |');
    const table = docJson?.content[0]?.content?.[0];

    expect(table?.type).toBe('table');
    expect(table?.content?.[1]?.content?.[0]?.content?.[0]?.content).toEqual([
      { type: 'text', text: 'a b c', marks: [{ type: 'bold' }] },
    ]);
  });

  it('嵌套样式经过文件写入的块规划与再导入后保持正文和格式', async () => {
    const planned = await planMarkdownBlocks('**a **b** c** tail\n\n*x *y* z*');
    const { docJson } = await importMarkdownToDocJson(planned.blocks.join('\n\n'));

    expect(paragraphContent(docJson)).toEqual([
      [
        { type: 'text', text: 'a b c', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' tail' },
      ],
      [{ type: 'text', text: 'x y z', marks: [{ type: 'italic' }] }],
    ]);
  });

  it.each([
    {
      name: '相邻粗体之间有空格',
      markdown: '**a** **b**',
      expected: [
        { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      ],
    },
    {
      name: '词内四星号按 CommonMark 保留字面文本',
      markdown: '**a****b**',
      expected: [{ type: 'text', text: 'a****b', marks: [{ type: 'bold' }] }],
    },
    {
      name: '不同样式可以共存',
      markdown: '***x***',
      expected: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }],
    },
    {
      name: '行内代码遵守既有 code 排斥 bold 合同且不结束外层粗体',
      markdown: '**a`x`b**',
      expected: [
        { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'x', marks: [{ type: 'code' }] },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      ],
    },
  ])('保留正常导入语义：$name', async ({ markdown, expected }) => {
    const { docJson } = await importMarkdownToDocJson(markdown);

    expect(paragraphContent(docJson)).toEqual([expected]);
  });

  it('空行阻断分隔符配对，但不能把原来的粗体意图视为已保留', async () => {
    const { docJson } = await importMarkdownToDocJson('**甲）**乙\n\n**丙**。');

    // 分段后的未配对星号成为正文；该用例防止把绕过异常误认为无损修复。
    expect(paragraphContent(docJson)).toEqual([
      [{ type: 'text', text: '**甲）**乙' }],
      [
        { type: 'text', text: '丙', marks: [{ type: 'bold' }] },
        { type: 'text', text: '。' },
      ],
    ]);
  });
});

describe('持久化 Markdown marks 合同', () => {
  it('继续拒绝重复 marks 的 doc JSON；导入修复不能放宽存储门禁', () => {
    const document: MarkdownDocJson = {
      type: 'doc',
      content: [{
        type: 'rootBlock',
        attrs: { id: 'root-example' },
        content: [{
          type: 'baseBlock',
          content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }],
        }],
      }],
    };

    expect(() => validateMarkdownDocJson(document)).toThrow(
      'Invalid collection of marks for node text: bold,bold',
    );
  });
});
