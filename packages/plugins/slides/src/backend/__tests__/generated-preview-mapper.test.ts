import { describe, expect, it } from 'vitest';

import type { DeckSpec } from '@plugin/slides/shared';
import { GeneratedPreviewMapper } from '../engine/parser/GeneratedPreviewMapper.js';

describe('GeneratedPreviewMapper', () => {
  it('projects the current DeckSpec into the preview identity and text contract', () => {
    const deckSpec: DeckSpec = {
      title: 'Source title',
      layout: '16x9',
      theme: {
        colors: { accent1: '#336699' },
        fonts: { major: 'Aptos Display', minor: 'Aptos' },
        chart: { palette: ['#336699', '#CC6633'] },
      },
      slides: [
        {
          slideNumber: 1,
          spec: {
            type: 'structured',
            elements: [
              {
                type: 'title',
                content: 'Quarterly review',
                position: { x: 1, y: 0.5, w: 8, h: 0.8 },
                _authoringRef: {
                  slideKey: 'overview',
                  editKey: 'headline',
                  targetKind: 'text',
                },
              },
              {
                type: 'bulletList',
                items: [{ text: 'Revenue grew' }, { text: 'Margin held' }],
                position: { x: 1, y: 1.5, w: 5, h: 3 },
              },
              {
                type: 'chart',
                chartType: 'line',
                data: { categories: ['Q1'], series: [{ name: 'Revenue', values: [12], labels: [] }] },
                position: { x: 6.5, y: 1.5, w: 5, h: 3 },
              },
            ],
          },
        },
      ],
    };

    const preview = new GeneratedPreviewMapper().toPreview({
      nodeId: 'deck-1',
      versionNumber: 8,
      title: 'Persisted title',
      deckSpec,
    });

    expect(preview).toMatchObject({
      nodeId: 'deck-1',
      versionNumber: 8,
      title: 'Persisted title',
      slideSize: { width: 10, height: 5.625 },
      theme: {
        colors: { accent1: '#336699' },
        fonts: { major: 'Aptos Display', minor: 'Aptos' },
        chart: { palette: ['#336699', '#CC6633'] },
      },
      warnings: [],
      slides: [{
        slideId: 's1',
        number: 1,
        layoutName: 'structured',
        elements: [
          {
            elementId: 'authoring-overview-headline',
            type: 'text',
            text: 'Quarterly review',
          },
          {
            elementId: 's1-generated-1',
            type: 'text',
            text: 'Revenue grew\nMargin held',
          },
          {
            elementId: 's1-generated-2',
            type: 'chart',
            chartType: 'line',
          },
        ],
      }],
    });
  });

  it('uses the shared group transform when flattening freeform preview elements', () => {
    const deckSpec: DeckSpec = {
      title: 'Grouped slide',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          elements: [{
            type: 'group',
            position: { x: 2, y: 1, w: 4, h: 2 },
            _authoringRef: {
              slideKey: 'details',
              editKey: 'cluster',
              targetKind: 'shape',
            },
            children: [{
              type: 'text',
              content: [{ text: 'Nested' }, { text: ' text' }],
              position: { x: 10, y: 10, w: 2, h: 1 },
              _authoringRef: {
                slideKey: 'details',
                editKey: 'nested-copy',
                targetKind: 'text',
              },
            }, {
              type: 'shape',
              content: 'Card',
              position: { x: 14, y: 12, w: 2, h: 1 },
            }],
          }],
        },
      }],
    };

    const preview = new GeneratedPreviewMapper().toPreview({
      nodeId: 'deck-grouped',
      versionNumber: 2,
      title: deckSpec.title,
      deckSpec,
    });

    expect(preview.slides[0]?.elements).toMatchObject([
      {
        elementId: 'authoring-details-cluster',
        type: 'group',
        position: { x: 2, y: 1, w: 4, h: 2 },
      },
      {
        elementId: 'authoring-details-nested-copy',
        type: 'text',
        text: 'Nested text',
      },
      {
        elementId: 's1-freeform-1',
        type: 'shape',
        text: 'Card',
      },
    ]);
    expect(preview.slides[0]?.elements[1]?.position).toMatchObject({ x: 2, y: 1 });
    expect(preview.slides[0]?.elements[1]?.position?.w).toBeCloseTo(4 / 3);
    expect(preview.slides[0]?.elements[1]?.position?.h).toBeCloseTo(2 / 3);
    expect(preview.slides[0]?.elements[2]?.position?.x).toBeCloseTo(14 / 3);
    expect(preview.slides[0]?.elements[2]?.position?.y).toBeCloseTo(7 / 3);
    expect(preview.slides[0]?.elements[2]?.position?.w).toBeCloseTo(4 / 3);
    expect(preview.slides[0]?.elements[2]?.position?.h).toBeCloseTo(2 / 3);
  });
});
