import { describe, expect, it } from 'vitest';
import type { TextRenderNode } from '../../../types/render';
import type { RenderNodeSelectionGeometry } from '../../renderNodeSelection';
import { createTextEditingTarget } from './createTextEditingTarget';

describe('createTextEditingTarget', () => {
  it('projects the committed world geometry and text style into one DOM editing target', () => {
    const node: TextRenderNode = {
      id: 'authoring-overview-headline',
      kind: 'text',
      box: { x: 1, y: 2, w: 3, h: 1, unit: 'in' },
      zIndex: 1,
      padding: { top: 0.1, right: 0.2, bottom: 0.1, left: 0.2 },
      verticalAlign: 'middle',
      opacity: 0.8,
      paragraphs: [{
        align: 'center',
        runs: [{
          text: '季度增长',
          fontFamily: 'Inter',
          fontSize: 18,
          fontWeight: 'bold',
          fontStyle: 'italic',
          underline: true,
          color: '#123456',
          letterSpacing: 0.5,
        }],
      }],
      layout: {
        contentHeightInches: 0.4,
        appliedFontScale: 0.75,
        lines: [{
          paragraphIndex: 0,
          runs: [],
          width: 1,
          height: 0.3,
          baseline: 0.2,
          x: 0,
          y: 0,
        }],
      },
      authoringRef: { slideKey: 'overview', editKey: 'headline', targetKind: 'text' },
      authoringEdit: {
        capabilities: ['translate', 'set_text_content'],
        text: { kind: 'plain_text', content: '季度增长' },
      },
    };
    const geometry: RenderNodeSelectionGeometry = {
      elementId: node.id,
      nodeKind: node.kind,
      node,
      bounds: { x: 1, y: 2, w: 1, h: 3 },
      polygon: [
        { x: 1, y: 2 },
        { x: 1, y: 5 },
        { x: 0, y: 5 },
        { x: 0, y: 2 },
      ],
      zPath: [1],
    };

    expect(createTextEditingTarget(geometry)).toEqual(expect.objectContaining({
      content: '季度增长',
      origin: { x: 1, y: 2 },
      width: 3,
      height: 1,
      rotation: 90,
      verticalOffset: 0.2,
      fontFamily: 'Inter',
      fontSizePt: 18,
      appliedFontScale: 0.75,
      fontWeight: 'bold',
      fontStyle: 'italic',
      textDecoration: 'underline',
      color: '#123456',
      textAlign: 'center',
      letterSpacingPt: 0.375,
      opacity: 0.8,
    }));
  });

  it('rejects rich text because plain-text replacement cannot preserve its run semantics', () => {
    const node: TextRenderNode = {
      id: 'rich-text',
      kind: 'text',
      box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
      zIndex: 0,
      paragraphs: [{ runs: [{ text: 'Rich', fontWeight: 'bold' }] }],
      authoringRef: { slideKey: 'overview', editKey: 'rich', targetKind: 'text' },
      authoringEdit: { capabilities: ['translate'], text: { kind: 'rich_text' } },
    };

    expect(createTextEditingTarget({
      elementId: node.id,
      nodeKind: node.kind,
      node,
      bounds: { x: 0, y: 0, w: 1, h: 1 },
      polygon: [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ],
      zPath: [0],
    })).toBeNull();
  });
});
