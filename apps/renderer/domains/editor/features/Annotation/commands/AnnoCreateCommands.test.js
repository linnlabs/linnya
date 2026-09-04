// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { confirmCreatingAnnotation, startCreatingAnnotation } from './AnnoCreateCommands';
import { AnnotationState } from './AnnoStateCommands';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'baseBlock',
      toDOM: node => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    baseBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'text*',
      toDOM: node => ['p', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'p[data-id]' }],
    },
  },
});

function createEditor(text = 'hello') {
  const paragraph = schema.nodes.baseBlock.create(
    { id: 'paragraph-a' },
    text ? schema.text(text) : undefined,
  );
  const rootBlock = schema.nodes.rootBlock.create({ id: 'root-a' }, paragraph);
  const doc = schema.nodes.doc.create(null, [rootBlock]);
  return {
    state: EditorState.create({ doc }),
  };
}

describe('Annotation create commands', () => {
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

  it('does not create a draft before the owner-scoped layout target is ready', async () => {
    const annotationStore = {
      editor: createEditor(),
      annotations: [],
      addAnnotation: vi.fn(),
    };
    const panelPositionManager = {
      calculateInitialPositionCSS: vi.fn(() => null),
      handleOverlapsOnly: vi.fn(),
    };

    const annotationId = await startCreatingAnnotation({
      blockId: 'root-a',
      annotationStore,
      panelPositionManager,
    });

    expect(annotationId).toBeNull();
    expect(annotationStore.addAnnotation).not.toHaveBeenCalled();
  });

  it('creates a transient panel for an empty BaseBlock', async () => {
    const annotations = [];
    const annotationStore = {
      editor: createEditor(''),
      annotations,
      addAnnotation: vi.fn(async annotationData => {
        const annotation = { id: 'annotation-a', ...annotationData };
        annotations.push(annotation);
        return annotation;
      }),
    };
    const panelPositionManager = {
      calculateInitialPositionCSS: vi.fn(() => ({ top: '12px', left: '34px' })),
      handleOverlapsOnly: vi.fn(),
    };

    const annotationId = await startCreatingAnnotation({
      blockId: 'root-a',
      annotationStore,
      panelPositionManager,
    });

    expect(annotationId).toBe('annotation-a');
    expect(annotationStore.addAnnotation).toHaveBeenCalledWith(expect.objectContaining({
      blockId: 'root-a',
      state: AnnotationState.CREATING,
    }));
    expect(panelPositionManager.calculateInitialPositionCSS).toHaveBeenCalledWith('root-a');
  });

  it('confirms a creating annotation when its target becomes empty', async () => {
    const annotations = [{
      id: 'annotation-a',
      blockId: 'root-a',
      content: '批注意见',
      state: AnnotationState.CREATING,
    }];
    const annotationStore = {
      editor: createEditor(''),
      annotations,
      updateAnnotation: vi.fn((annotationId, updates) => {
        const annotation = annotations.find(item => item.id === annotationId);
        if (!annotation) return false;
        Object.assign(annotation, updates);
        return true;
      }),
    };
    const panelPositionManager = {
      invalidateLayoutCacheForAnnotation: vi.fn(),
      recalculateAllPositions: vi.fn(async () => false),
    };

    const annotationId = await confirmCreatingAnnotation({
      blockId: 'root-a',
      content: '批注意见',
      annotationStore,
      panelPositionManager,
    });

    expect(annotationId).toBe('annotation-a');
    expect(annotationStore.updateAnnotation).toHaveBeenCalledWith('annotation-a', {
      content: '批注意见',
      state: AnnotationState.CONFIRMED,
    });
    expect(annotations).toEqual([
      expect.objectContaining({ id: 'annotation-a', state: AnnotationState.CONFIRMED }),
    ]);
  });

  it('rolls back the draft when post-mount overlap layout fails', async () => {
    const annotations = [{ id: 'existing', blockId: 'root-a', state: AnnotationState.CONFIRMED }];
    const removeAnnotation = vi.fn(annotationId => {
      const index = annotations.findIndex(annotation => annotation.id === annotationId);
      if (index < 0) return false;
      annotations.splice(index, 1);
      return true;
    });
    const annotationStore = {
      editor: createEditor(),
      annotations,
      addAnnotation: vi.fn(async annotationData => {
        const annotation = { id: 'annotation-a', ...annotationData };
        annotations.push(annotation);
        return annotation;
      }),
      removeAnnotation,
    };
    const panelPositionManager = {
      calculateInitialPositionCSS: vi.fn(() => ({ top: '12px', left: '34px' })),
      handleOverlapsOnly: vi.fn(async () => {
        throw new Error('layout failed');
      }),
    };

    const annotationId = await startCreatingAnnotation({
      blockId: 'root-a',
      annotationStore,
      panelPositionManager,
    });

    expect(annotationId).toBeNull();
    expect(removeAnnotation).toHaveBeenCalledWith('annotation-a');
    expect(annotations.map(annotation => annotation.id)).toEqual(['existing']);
  });
});
