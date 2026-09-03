import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { materializePresentationPptx } from './materializePresentationPptx';

describe('materializePresentationPptx', () => {
  it('builds and sanitizes a real PPTX package from a self-contained DTO', async () => {
    const buffer = await materializePresentationPptx({
      deckSpec: {
        title: 'Worker materialization',
        layout: '16x9',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'text',
              position: { x: 1, y: 1, w: 4, h: 1 },
              content: 'PPTX work runs outside the App Server event loop.',
              style: { fontSize: 24, color: '#223344' },
            }],
          },
        }],
      },
      svgAssets: [],
      svgFallbacks: [],
    });

    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(slideXml).toContain('PPTX work runs outside the App Server event loop.');
  });
});
