import { describe, expect, it } from 'vitest';
import { isSlideRenderModel } from './renderModelCodec.js';

describe('renderModelCodec font identity', () => {
  it('accepts resolved font facts on text runs', () => {
    expect(isSlideRenderModel({
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'text-1',
        kind: 'text',
        box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
        zIndex: 0,
        paragraphs: [{
          runs: [{
            text: 'Hello',
            fontFamily: 'Missing Sans',
            resolvedFontFamily: 'Aptos',
            fontScript: 'latin',
            fontResolution: 'substituted',
            fontFaceFingerprint: 'a'.repeat(64),
            resolvedFontWeight: 'bold',
            resolvedFontStyle: 'normal',
          }],
        }],
      }],
    })).toBe(true);
  });

  it('rejects unsafe font face fingerprints', () => {
    expect(isSlideRenderModel({
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'text-1',
        kind: 'text',
        box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
        zIndex: 0,
        paragraphs: [{
          runs: [{
            text: 'Hello',
            fontFaceFingerprint: '/System/Library/Fonts/Avenir.ttc',
          }],
        }],
      }],
    })).toBe(false);
  });

  it('rejects unknown font resolution states', () => {
    expect(isSlideRenderModel({
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'text-1',
        kind: 'text',
        box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
        zIndex: 0,
        paragraphs: [{
          runs: [{
            text: 'Hello',
            fontResolution: 'guessed',
          }],
        }],
      }],
    })).toBe(false);
  });
});

describe('renderModelCodec inline text layout', () => {
  it('接受共享文本 finalizer 产生的文本与行内公式切片', () => {
    const formulaProjection = {
      canonicalSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
      contentHash: 'a'.repeat(64),
      viewBox: { x: 0, y: 0, width: 10, height: 10 },
      contentViewBox: { x: 0, y: 0, width: 10, height: 10 },
      metrics: {
        advanceWidth: 0.3,
        ascent: 0.2,
        descent: 0.05,
        inkBounds: { x: 0, y: 0, width: 0.3, height: 0.25 },
        nativeEnvelope: { ascentEm: 0.8, descentEm: 0.2 },
      },
      altText: 'x squared',
      align: 'left',
    };

    expect(isSlideRenderModel({
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'text-1',
        kind: 'text',
        box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
        zIndex: 0,
        paragraphs: [{
          runs: [
            { text: 'Formula: ', fontSize: 18 },
            { kind: 'formula', projection: formulaProjection },
          ],
        }],
        layout: {
          lines: [{
            paragraphIndex: 0,
            slices: [
              {
                kind: 'text',
                paragraphIndex: 0,
                runIndex: 0,
                text: 'Formula: ',
                x: 0,
                width: 0.7,
                textY: 0,
              },
              {
                kind: 'inlineBox',
                paragraphIndex: 0,
                runIndex: 1,
                identity: 'formula-1',
                projection: formulaProjection,
                x: 0.7,
                width: 0.3,
                boxY: 0,
                height: 0.25,
              },
            ],
            y: 0,
            baseline: 0.2,
            height: 0.25,
            width: 1,
            align: 'left',
          }],
          contentHeightInches: 0.25,
          requiredHeightInches: 0.35,
          appliedFontScale: 1,
          appliedLineSpacingReduction: 0,
          advanceSource: 'harfbuzz',
          overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
        },
      }],
    })).toBe(true);
  });
});

describe('renderModelCodec shape geometry', () => {
  it('接受后端明确标记的开放 typed path', () => {
    expect(isSlideRenderModel({
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'path-1',
        kind: 'shape',
        box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
        zIndex: 0,
        geometry: {
          type: 'path',
          viewBox: { width: 100, height: 100 },
          commands: [
            { type: 'moveTo', x: 0, y: 100 },
            { type: 'lineTo', x: 100, y: 0 },
          ],
          closed: false,
        },
      }],
    })).toBe(true);
  });
});
