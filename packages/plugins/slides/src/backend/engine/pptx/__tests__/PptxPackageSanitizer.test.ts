import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { PptxPackageSanitizer } from '../PptxPackageSanitizer';

async function makePptxWithPackageIssues(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slides/missing.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    '</Types>',
  ].join(''));
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
  zip.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '<p:cSld><p:spTree>',
    '<p:sp><p:nvSpPr><p:cNvPr id="7" name="shape a"/></p:nvSpPr></p:sp>',
    '<p:sp><p:nvSpPr><p:cNvPr id="7" name="shape b"/></p:nvSpPr></p:sp>',
    '</p:spTree></p:cSld>',
    '</p:sld>',
  ].join(''));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('PptxPackageSanitizer', () => {
  it('removes duplicate/missing Content_Types entries and normalizes non-visual ids', async () => {
    const sanitizer = new PptxPackageSanitizer();
    const sanitized = await sanitizer.sanitize(await makePptxWithPackageIssues());
    const zip = await JSZip.loadAsync(sanitized);

    const contentTypes = await zip.file('[Content_Types].xml')!.async('text');
    expect(contentTypes.match(/<Default /g)).toHaveLength(1);
    expect(contentTypes.match(/PartName="\/ppt\/presentation.xml"/g)).toHaveLength(1);
    expect(contentTypes).not.toContain('/ppt/slides/missing.xml');

    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('id="1"');
    expect(slideXml).toContain('id="2"');
    expect(slideXml).not.toContain('id="7"');
  });
});
