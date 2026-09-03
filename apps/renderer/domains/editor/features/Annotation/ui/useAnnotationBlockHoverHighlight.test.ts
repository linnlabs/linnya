// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import highlightState from '../AnnoHighlightState';
import { useAnnotationBlockHoverHighlight } from './useAnnotationBlockHoverHighlight';

function mountHoverHighlightHost(hoveredBlockId: Ref<string | null>): App {
  const Host = defineComponent({
    setup() {
      useAnnotationBlockHoverHighlight({ hoveredBlockId });
      return () => h('div');
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  return app;
}

function appendAnnotationPanel(blockId: string): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'annotation-panel';
  panel.dataset.blockId = blockId;
  panel.dataset.annotationId = `annotation-${blockId}`;
  document.body.appendChild(panel);
  return panel;
}

describe('useAnnotationBlockHoverHighlight', () => {
  const mountedApps: App[] = [];

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount());
    mountedApps.length = 0;
    highlightState.clearPanelHighlight(undefined, highlightState.getHighlightState().blockId);
    document.body.innerHTML = '';
  });

  it('highlights the annotation panel for the hovered root block', async () => {
    const hoveredBlockId = ref<string | null>(null);
    const panel = appendAnnotationPanel('root-a');

    mountedApps.push(mountHoverHighlightHost(hoveredBlockId));
    hoveredBlockId.value = 'root-a';
    await nextTick();

    expect(panel.classList.contains('annotation-highlight-panel')).toBe(true);

    hoveredBlockId.value = null;
    await nextTick();

    expect(panel.classList.contains('annotation-highlight-panel')).toBe(false);
  });

  it('clears the previous block when hover moves between root blocks', async () => {
    const hoveredBlockId = ref<string | null>('root-a');
    const panelA = appendAnnotationPanel('root-a');
    const panelB = appendAnnotationPanel('root-b');

    mountedApps.push(mountHoverHighlightHost(hoveredBlockId));
    await nextTick();

    expect(panelA.classList.contains('annotation-highlight-panel')).toBe(true);

    hoveredBlockId.value = 'root-b';
    await nextTick();

    expect(panelA.classList.contains('annotation-highlight-panel')).toBe(false);
    expect(panelB.classList.contains('annotation-highlight-panel')).toBe(true);
  });
});
