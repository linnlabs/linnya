import { describe, expect, it } from 'vitest';
import type { TextRenderNode } from '../../renderModel';
import {
  PPTX_DEFAULT_TEXT_INSET,
  resolveTextLayoutContractFromNode,
} from '../index';

describe('TextLayoutContract', () => {
  it('uses shared defaults and resolved font as the layout facts', () => {
    const node: TextRenderNode = {
      id: 'text-1',
      kind: 'text',
      box: { x: 1, y: 1, w: 3, h: 1, unit: 'in' },
      zIndex: 0,
      paragraphs: [{
        runs: [{
          text: 'Contract text',
          fontFamily: 'Missing Sans',
          resolvedFontFamily: 'Resolved Sans',
          fontSize: 18,
        }],
      }],
    };

    const contract = resolveTextLayoutContractFromNode(node, {
      sourceKind: 'generated',
    });

    expect(contract.padding).toEqual(PPTX_DEFAULT_TEXT_INSET);
    expect(contract.wrap).toBe('word');
    expect(contract.lineBreak).toBe('office-compatible');
    expect(contract.autoFitPolicy).toBe('none');
    expect(contract.font).toEqual({
      declaredFontFamily: 'Missing Sans',
      resolvedFontFamily: 'Resolved Sans',
    });
  });

  it('preserves explicit render-model layout semantics', () => {
    const node: TextRenderNode = {
      id: 'text-2',
      kind: 'text',
      box: { x: 0, y: 0, w: 2, h: 1, unit: 'in' },
      zIndex: 0,
      paragraphs: [{ runs: [{ text: 'No wrap' }] }],
      padding: { top: 0.2, right: 0.3, bottom: 0.4, left: 0.5 },
      wrap: 'none',
      autoFitPolicy: 'shrink-text',
      overflow: 'visible',
      verticalAlign: 'bottom',
    };

    const contract = resolveTextLayoutContractFromNode(node, {
      sourceKind: 'imported',
      profile: 'shape-inner-text',
    });

    expect(contract.profile).toBe('shape-inner-text');
    expect(contract.padding).toEqual(node.padding);
    expect(contract.wrap).toBe('none');
    expect(contract.lineBreak).toBe('none');
    expect(contract.autoFitPolicy).toBe('shrink-text');
    expect(contract.overflow).toBe('visible');
    expect(contract.verticalAlign).toBe('bottom');
  });
});
