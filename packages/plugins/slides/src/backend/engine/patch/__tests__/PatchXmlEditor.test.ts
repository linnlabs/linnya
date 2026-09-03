import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import type { ShapeStyle } from '@plugin/slides/shared';
import { PatchXmlEditor } from '../PatchXmlEditor';

interface PatchXmlEditorShadowHarness {
  applyShadow(
    spPr: Element,
    shadow: NonNullable<ShapeStyle['shadow']>,
  ): void;
}

describe('PatchXmlEditor', () => {
  it('writes shape shadow distance in points instead of inches', () => {
    const doc = new DOMParser().parseFromString(
      '<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
      'application/xml',
    );
    const spPr = doc.documentElement;
    const editor = new PatchXmlEditor() as unknown as PatchXmlEditorShadowHarness;

    editor.applyShadow(spPr, {
      color: '#000000',
      blur: 8,
      offsetX: 3,
      offsetY: 4,
      opacity: 0.3,
    });

    const outerShadow = spPr.getElementsByTagName('a:outerShdw').item(0);
    expect(outerShadow?.getAttribute('dist')).toBe(String(Math.round(5 * 12700)));
    expect(outerShadow?.getAttribute('blurRad')).toBe(String(Math.round(8 * 12700)));
  });
});
