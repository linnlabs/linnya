import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { PptxValidator } from '../PptxValidator';

async function makeMinimalValidPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    '</Types>',
  ].join(''));
  zip.file('ppt/presentation.xml', [
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>',
    '</p:presentation>',
  ].join(''));
  zip.file('ppt/_rels/presentation.xml.rels', [
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>',
    '</Relationships>',
  ].join(''));
  zip.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '<p:cSld><p:spTree>',
    '<p:sp><p:nvSpPr><p:cNvPr id="1" name="shape"/></p:nvSpPr></p:sp>',
    '</p:spTree></p:cSld>',
    '</p:sld>',
  ].join(''));
  zip.file('ppt/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('PptxValidator', () => {
  it('accepts a minimal well-formed PPTX package', async () => {
    const validator = new PptxValidator();
    const result = await validator.validate(await makeMinimalValidPptx());

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.structure.slideCount).toBe(1);
    expect(result.structure.slideFiles).toEqual(['ppt/slides/slide1.xml']);
    expect(result.structure.themeFiles).toEqual(['ppt/theme/theme1.xml']);
  });

  it('rejects a package with an orphaned internal relationship', async () => {
    const zip = await JSZip.loadAsync(await makeMinimalValidPptx());
    zip.file('ppt/_rels/presentation.xml.rels', [
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/missing.xml"/>',
      '</Relationships>',
    ].join(''));

    const validator = new PptxValidator();
    const result = await validator.validate(await zip.generateAsync({ type: 'nodebuffer' }));

    expect(result.valid).toBe(false);
    expect(result.structure.orphanedRels[0]).toContain('ppt/slides/missing.xml');
  });
});
