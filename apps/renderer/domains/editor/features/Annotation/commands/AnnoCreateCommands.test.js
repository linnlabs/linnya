// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { startCreatingAnnotation } from './AnnoCreateCommands';
import { AnnotationState } from './AnnoStateCommands';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'paragraph',
      toDOM: node => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    paragraph: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'text*',
      toDOM: node => ['p', { 'data-id': node.attrs.id }, 0],
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

describe('startCreatingAnnotation', () => {
  it('stores annotations on the containing rootBlock when called with a child content id', async () => {
    const annotations = [];
    const annotationStore = {
      editor: createEditor(),
      annotations,
      addAnnotation: vi.fn(async annotationData => {
        const annotation = {
          id: 'annotation-a',
          ...annotationData,
        };
        annotations.push(annotation);
        return annotation;
      }),
    };
    const panelPositionManager = {
      calculateInitialPositionCSS: vi.fn(() => ({ top: '12px', left: '34px' })),
      handleOverlapsOnly: vi.fn(async () => false),
    };

    const annotationId = await startCreatingAnnotation({
      blockId: 'paragraph-a',
      annotationStore,
      panelPositionManager,
    });

    expect(annotationId).toBe('annotation-a');
    expect(panelPositionManager.calculateInitialPositionCSS).toHaveBeenCalledWith('root-a');
    expect(annotationStore.addAnnotation).toHaveBeenCalledWith({
      blockId: 'root-a',
      content: '',
      author: 'User',
      state: AnnotationState.CREATING,
      position: { top: 12, left: 34 },
    });
  });
});
