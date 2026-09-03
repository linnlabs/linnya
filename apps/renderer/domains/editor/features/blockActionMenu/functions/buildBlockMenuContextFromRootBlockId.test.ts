import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  buildBlockMenuContextFromRootBlockId,
  type BlockMenuContextEditor,
  resolveBlockMenuContextPartsFromRootBlockId,
} from './buildBlockMenuContextFromRootBlockId';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock*' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph?',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
});

function createRootBlock(blockId: string, text: string) {
  return schema.nodes.rootBlock.create(
    { id: blockId },
    schema.nodes.paragraph.create(null, schema.text(text))
  );
}

function createDoc() {
  return schema.nodes.doc.create(null, [
    createRootBlock('block-a', 'alpha'),
    createRootBlock('block-b', 'bravo'),
  ]);
}

describe('resolveBlockMenuContextPartsFromRootBlockId', () => {
  it('按 rootBlockId 从当前 doc 解析菜单上下文节点和位置', () => {
    const doc = createDoc();
    const firstBlockSize = doc.child(0).nodeSize;

    const result = resolveBlockMenuContextPartsFromRootBlockId(doc, 'block-b');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parts.rootBlockNode.attrs.id).toBe('block-b');
    expect(result.parts.rootBlockPos).toBe(firstBlockSize);
    expect(result.parts.contentBlockType).toBe('paragraph');
    expect(result.parts.contentBlockPos).toBe(firstBlockSize + 1);
  });

  it('区分缺失 blockId 和当前 doc 中找不到 blockId', () => {
    const doc = createDoc();

    expect(resolveBlockMenuContextPartsFromRootBlockId(doc, null)).toEqual({
      ok: false,
      reason: 'missing-block-id',
    });
    expect(resolveBlockMenuContextPartsFromRootBlockId(doc, 'missing-block')).toEqual({
      ok: false,
      reason: 'block-not-found',
      rootBlockId: 'missing-block',
    });
  });

  it('拒绝没有内容块的 rootBlock', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create({ id: 'empty-block' }),
    ]);

    expect(resolveBlockMenuContextPartsFromRootBlockId(doc, 'empty-block')).toEqual({
      ok: false,
      reason: 'missing-content-block',
      rootBlockId: 'empty-block',
      rootBlockPos: 0,
      nodeType: 'rootBlock',
    });
  });
});

describe('buildBlockMenuContextFromRootBlockId', () => {
  it('把解析出的节点信息和 editor 合成为菜单上下文', () => {
    const doc = createDoc();
    const editor = {
      state: {
        doc,
      },
    } satisfies BlockMenuContextEditor;

    const result = buildBlockMenuContextFromRootBlockId({
      editor,
      rootBlockId: 'block-a',
      hasAnnotations: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.editor).toBe(editor);
    expect(result.context.rootBlockNode.attrs.id).toBe('block-a');
    expect(result.context.contentBlockType).toBe('paragraph');
    expect(result.context.hasAnnotations).toBe(true);
  });
});
