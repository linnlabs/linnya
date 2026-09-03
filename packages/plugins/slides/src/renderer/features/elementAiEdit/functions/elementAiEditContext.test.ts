import { describe, expect, it } from 'vitest';
import type { SlidesElementAiEditSubmitPayload } from '../definitions/elementAiEditTypes';
import {
  buildSlidesElementAiEditContext,
  buildSlidesElementAiEditSourceTargets,
} from './elementAiEditContext';

const payload: SlidesElementAiEditSubmitPayload = {
  instruction: '把标题改成蓝色',
  slideNumber: 1,
  targets: [
    {
      elementId: 's1-title',
      kind: 'text',
      summary: 'text="Old title"',
      sourceSpan: { startLine: 3, endLine: 5 },
      bounds: { x: 1, y: 1, w: 3, h: 0.5 },
      polygon: [],
      zPath: [1],
    },
  ],
};

describe('elementAiEditContext', () => {
  it('builds source-slice request targets from selected render targets', () => {
    expect(buildSlidesElementAiEditSourceTargets(payload)).toEqual([
      {
        elementId: 's1-title',
        slideNumber: 1,
        kind: 'text',
        sourceSpan: { startLine: 3, endLine: 5 },
      },
    ]);
  });

  it('packages compact target source slices for slides_agent', () => {
    const context = buildSlidesElementAiEditContext({
      presentationId: 'deck-1',
      payload,
      sourceSlices: {
        presentationId: 'deck-1',
        title: 'Deck',
        versionId: 'version-1',
        sourceOrigin: 'compiled',
        sourceKey: 'compiled:version-1',
        totalLines: 10,
        slices: [
          {
            elementId: 's1-title',
            slideNumber: 1,
            kind: 'text',
            sourceSpan: { startLine: 3, endLine: 5 },
            startLine: 3,
            endLine: 5,
            numLines: 3,
            content: 'createText({\n  content: "Old title",\n});',
          },
        ],
      },
    });

    expect(context.visiblePrompt).toBe('修改第 1 页选中的 1 个元素：把标题改成蓝色');
    expect(context.selectedSlidesElementFence.kind).toBe('selected-slides-element');
    expect(context.selectedSlidesElementFence.content).toContain('source_file_inode: deck-1');
    expect(context.selectedSlidesElementFence.content).toContain(
      'edit_file does not require read authorization',
    );
    expect(context.selectedSlidesElementFence.content).toContain('<<<deck.js exact source');
    expect(context.selectedSlidesElementFence.content).toContain('createText({\n  content: "Old title",\n});');
    expect(context.selectedSlidesElementFence.content).not.toContain('presentation_id:');
    expect(context.selectedSlidesElementFence.content).not.toContain('version_id:');
    expect(context.selectedSlidesElementFence.content).not.toContain('source_key:');
    expect(context.selectedSlidesElementFence.content).not.toContain('source_origin:');
    expect(context.selectedSlidesElementFence.content).not.toContain('total_lines:');
    expect(context.userQuote.items).toHaveLength(1);
    expect(context.userQuote.items[0]).toMatchObject({
      pluginId: 'slides',
      kind: 'slides-source-selection',
      label: '第 1 页 · 1 个元素',
      source: {
      type: 'slides_source_selection',
      presentation_id: 'deck-1',
      source_file_inode: 'deck-1',
      },
      metadata: {
        presentationId: 'deck-1',
        slideNumber: 1,
        elementIds: ['s1-title'],
      },
    });
  });
});
