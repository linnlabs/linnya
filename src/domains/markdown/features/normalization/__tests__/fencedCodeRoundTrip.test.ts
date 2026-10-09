import { describe, expect, it } from 'vitest';
import { importMarkdownToDocJson } from '../importMarkdownToDocJson';
import { serializeRootBlockToMarkdown } from '../markdownJsonSerializer';
import { planMarkdownBlocks } from '../markdownBlockPlanner';
import { parseMarkdownToBlocksInNode } from '../parserAdapterNode';

const bodies = [
  '',
  ' \t',
  '\n  中文 \t\n\n',
  'json\n  { }  ',
  'BEGIN\n```\n# literal heading\n```\nEND',
  '``````\n~~~\n<!-- literal comment -->\n[@ABC234]',
];

describe('fenced code canonical round-trip through real Node WASM', () => {
  it.each(bodies)('preserves literal payload through serializer and import: %j', async code => {
    const canonical = serializeRootBlockToMarkdown({
      type: 'rootBlock',
      content: [{
        type: 'codeBlock',
        attrs: { language: 'text' },
        content: code ? [{ type: 'text', text: code }] : [],
      }],
    });
    const imported = await importMarkdownToDocJson(canonical);
    expect(imported.blockEvents).toHaveLength(1);
    expect(imported.blockEvents[0]).toMatchObject({
      block_type: 'CodeBlock', language: 'text', raw_content_fallback: code,
    });
    expect(imported.docJson?.content).toHaveLength(1);
    expect(serializeRootBlockToMarkdown(imported.docJson?.content[0])).toBe(canonical);
  });

  it('uses a safe tilde fence when the language contains a backtick', async () => {
    const canonical = serializeRootBlockToMarkdown({
      type: 'rootBlock',
      content: [{
        type: 'codeBlock', attrs: { language: 'lang`name' },
        content: [{ type: 'text', text: '~~~~\n```' }],
      }],
    });
    expect(canonical).toBe('~~~~~lang`name\n~~~~\n```\n~~~~~');
    const events = await parseMarkdownToBlocksInNode(canonical);
    expect(events).toEqual([expect.objectContaining({
      block_type: 'CodeBlock', language: 'lang`name', raw_content_fallback: '~~~~\n```',
    })]);
  });

  it.each(['````', '~~~'])('retains surrounding blocks and ignores syntax inside %s', async fence => {
    const body = 'BEGIN\n```\n# heading\n[@ABC234]\n<!-- note -->\n```\nEND';
    const markdown = `Before\n${fence}text extra-info\n${body}\n${fence}\nAfter`;
    const first = await planMarkdownBlocks(markdown);
    expect(first.blockEvents.map(event => event.block_type)).toEqual(['BaseBlock', 'CodeBlock', 'BaseBlock']);
    expect(first.blockEvents[1]?.raw_content_fallback).toBe(body);
    expect(first.annotationComments).toEqual([]);
    expect(first.blocks).toEqual(['Before', `\`\`\`\`text\n${body}\n\`\`\`\``, 'After']);
    const second = await planMarkdownBlocks(first.blocks.join('\n\n'));
    expect(second.blocks).toEqual(first.blocks);
  });
});
