// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelFinder } from './PanelFinder';
import { calculateAnnotationPanelIdealPosition } from './calculateAnnotationPanelIdealPosition';

function createShell(className = '') {
  const shell = document.createElement('div');
  shell.className = `editor-shell ${className}`.trim();
  const wrapper = document.createElement('div');
  wrapper.className = 'scroll-content-wrapper';
  shell.append(wrapper);
  return { shell, wrapper };
}

describe('PanelFinder editor owner boundary', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('resolves the nearest Markdown surface instead of the outer workspace shell', () => {
    const outer = createShell('for-workspace-stage');
    const inner = createShell('document-surface__editor-shell');
    const editorRoot = document.createElement('div');
    editorRoot.className = 'ProseMirror';
    const annotationLayer = document.createElement('div');
    annotationLayer.className = 'annotation-layer';

    const ownedBlock = document.createElement('div');
    ownedBlock.className = 'root-block-outer';
    ownedBlock.dataset.id = 'same-id';
    const ownedBlockBody = document.createElement('div');
    ownedBlockBody.className = 'root-block';
    ownedBlockBody.getBoundingClientRect = vi.fn(() => new DOMRect(520, 340, 740, 20));
    ownedBlock.append(ownedBlockBody);
    const ownedPanel = document.createElement('div');
    ownedPanel.className = 'annotation-panel';
    ownedPanel.dataset.annotationId = 'annotation-a';
    editorRoot.append(ownedBlock);
    inner.wrapper.append(editorRoot, annotationLayer);
    annotationLayer.append(ownedPanel);
    annotationLayer.getBoundingClientRect = vi.fn(() => new DOMRect(400, 200, 1000, 800));

    const foreignBlock = document.createElement('div');
    foreignBlock.className = 'root-block-outer';
    foreignBlock.dataset.id = 'same-id';
    outer.wrapper.append(foreignBlock, inner.shell);
    document.body.append(outer.shell);

    const finder = createPanelFinder({ view: { dom: editorRoot } });

    expect(finder.findEditorShell()).toBe(inner.shell);
    expect(finder.findScrollContentWrapper()).toBe(inner.wrapper);
    expect(finder.findAnnotationLayer()).toBe(annotationLayer);
    expect(finder.findBlockElement('same-id')).toBe(ownedBlock);
    expect(finder.findAnnotationPanel('annotation-a')).toBe(ownedPanel);
    expect(calculateAnnotationPanelIdealPosition({
      blockId: 'same-id',
      editor: null,
      panelFinder: finder,
    })).toEqual({
      top: '140px',
      left: '898px',
    });
  });

  it('does not borrow DOM from another editor when the owner is detached', () => {
    const foreign = createShell();
    const foreignBlock = document.createElement('div');
    foreignBlock.className = 'root-block-outer';
    foreignBlock.dataset.id = 'block-a';
    foreign.wrapper.append(foreignBlock);
    document.body.append(foreign.shell);

    const detachedEditorRoot = document.createElement('div');
    const finder = createPanelFinder({ view: { dom: detachedEditorRoot } });

    expect(finder.findBlockElement('block-a')).toBeNull();
    expect(finder.findEditorShell()).toBeNull();
    expect(finder.findScrollContentWrapper()).toBeNull();
  });
});
