// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { resolveAnnotationRootBlockId } from './rootBlockIdResolver';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'text*',
      toDOM: (node) => ['p', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'p[data-id]' }],
    },
  },
});

function createEditor() {
  const paragraph = schema.nodes.paragraph.create({ id: 'paragraph-a' }, schema.text('hello'));
  const rootBlock = schema.nodes.rootBlock.create({ id: 'root-a' }, paragraph);
  const doc = schema.nodes.doc.create(null, [rootBlock]);
  return {
    state: EditorState.create({ doc }),
  };
}

describe('resolveAnnotationRootBlockId', () => {
  it('keeps a rootBlock id unchanged', () => {
    expect(resolveAnnotationRootBlockId(createEditor(), 'root-a')).toBe('root-a');
  });

  it('normalizes a content block id to its containing rootBlock id', () => {
    expect(resolveAnnotationRootBlockId(createEditor(), 'paragraph-a')).toBe('root-a');
  });

  it('falls back through DOM descendants when editor state is unavailable', () => {
    document.body.innerHTML = `
      <div class="root-block-outer" data-id="root-dom">
        <p data-id="paragraph-dom"></p>
      </div>
    `;

    expect(resolveAnnotationRootBlockId(null, 'paragraph-dom')).toBe('root-dom');
  });
});
