// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import {
  findClosestElementFromTableEventTarget,
  TableCellInteractionExtension,
  TableCellInteractionPluginKey,
} from './TableCellInteractionExtension';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
});

function createInteractionPlugin() {
  const plugins = TableCellInteractionExtension.config.addProseMirrorPlugins.call({
    editor: {},
  });
  return plugins[0];
}

describe('TableCellInteractionExtension', () => {
  it('normalizes text-node event targets before closest lookup', () => {
    const cell = document.createElement('td');
    const text = document.createTextNode('cell');
    cell.appendChild(text);

    expect(findClosestElementFromTableEventTarget(text, 'td')).toBe(cell);
    expect(findClosestElementFromTableEventTarget(document, 'td')).toBeNull();
  });

  it('does not throw when document mousedown starts from a text node', () => {
    const plugin = createInteractionPlugin();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('outside')),
    ]);
    let state = EditorState.create({ schema, doc, plugins: [plugin] });
    const tr = state.tr.setMeta(TableCellInteractionPluginKey, {
      activeCellPos: 1,
      showHandle: true,
      interactionMode: 'editing',
    });
    state = state.apply(tr);

    const editorView = {
      get state() {
        return state;
      },
      dispatch: vi.fn((transaction) => {
        state = state.apply(transaction);
      }),
    };
    const pluginView = plugin.spec.view(editorView);

    const container = document.createElement('div');
    const text = document.createTextNode('outside');
    container.appendChild(text);
    document.body.appendChild(container);

    expect(() => {
      text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }).not.toThrow();

    expect(editorView.dispatch).toHaveBeenCalledTimes(1);
    expect(TableCellInteractionPluginKey.getState(state).showHandle).toBe(false);

    pluginView.destroy();
    container.remove();
  });
});
