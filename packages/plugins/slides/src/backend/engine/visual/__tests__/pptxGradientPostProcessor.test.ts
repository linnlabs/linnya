import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  createGradientFillMarker,
  applyPptxGradientFills,
} from '../pptxGradientPostProcessor.js';

async function makeZip(): Promise<JSZip> {
  const marker = createGradientFillMarker({
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#101820', position: 0 },
      { color: '#F97316', position: 1 },
    ],
  });
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<p:cSld><p:spTree>',
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${marker}"/></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp>`,
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="plain shape"/></p:nvSpPr><p:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr></p:sp>',
    '</p:spTree></p:cSld></p:sld>',
  ].join(''));
  return zip;
}

describe('pptxGradientPostProcessor', () => {
  it('injects native OOXML gradFill only for explicitly marked shapes', async () => {
    const zip = await makeZip();

    const mutated = await applyPptxGradientFills(zip);

    expect(mutated).toBe(true);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(xml).toContain('<a:gradFill rotWithShape="1">');
    expect(xml).toContain('<a:srgbClr val="101820"/>');
    expect(xml).toContain('<a:srgbClr val="F97316"/>');
    expect(xml).toContain('<a:lin ang="8100000" scaled="1"/>');
    expect(xml).toContain('name="Linnya Gradient Shape"');

    const plainShapeStart = xml.indexOf('name="plain shape"');
    const plainShapeXml = xml.slice(plainShapeStart);
    expect(plainShapeXml).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
  });
});
