import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
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

  it('writes the outer shadow with a polar direction, explicit alpha and no alignment', () => {
    const apply = (shadow: NonNullable<ShapeStyle['shadow']>): string => {
      const doc = new DOMParser().parseFromString(
        '<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
        'application/xml',
      );
      const editor = new PatchXmlEditor() as unknown as PatchXmlEditorShadowHarness;
      editor.applyShadow(doc.documentElement, shadow);
      return new XMLSerializer().serializeToString(doc.documentElement.getElementsByTagName('a:effectLst').item(0)!);
    };

    expect(apply({ color: '#000000', blur: 8, offsetX: 3, offsetY: 4, opacity: 0.3 })).toBe(
      '<a:effectLst>'
      + '<a:outerShdw blurRad="101600" dist="63500" dir="3180000" rotWithShape="0">'
      + '<a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw></a:effectLst>',
    );
    expect(apply({ color: '#abc', blur: 0, offsetX: 2, offsetY: -2 })).toContain(
      '<a:outerShdw blurRad="0" dist="35921" dir="18900000" rotWithShape="0">'
      + '<a:srgbClr val="AABBCC"><a:alpha val="30000"/></a:srgbClr></a:outerShdw>',
    );
  });
});
