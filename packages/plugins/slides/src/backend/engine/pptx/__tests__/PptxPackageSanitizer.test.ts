import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { PptxPackageSanitizer } from '../PptxPackageSanitizer';
import type { PptxPaintWarning } from '../../visual/pptxPaintPostProcessor';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
  registerPptxTextEffects,
} from '../../visual/pptxPaintPatchPlan';

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

async function makePptxWithRunLanguages(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    '</Types>',
  ].join(''));
  zip.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="text"/></p:nvSpPr><p:txBody>',
    '<a:p><a:r><a:rPr lang="en-US" altLang="zh-CN"/><a:t>日本語の資料。</a:t></a:r></a:p>',
    '<a:p><a:r><a:rPr lang="en-US"/><a:t>一二三，四五六。</a:t></a:r></a:p>',
    '</p:txBody></p:sp></p:spTree></p:cSld>',
    '</p:sld>',
  ].join(''));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readSlide(buffer: Buffer): Promise<string> {
  return (await JSZip.loadAsync(buffer)).file('ppt/slides/slide1.xml')!.async('text');
}

describe('PptxPackageSanitizer run language', () => {
  it('leaves author run languages and the slide part untouched unless the caller opts in', async () => {
    const source = await makePptxWithRunLanguages();
    const sanitized = await new PptxPackageSanitizer().sanitize(source);

    expect(sanitized.equals(source)).toBe(true);
    expect(await readSlide(sanitized)).toBe(await readSlide(source));
  });

  it('marks default en-US runs by script when the generated-deck option is on', async () => {
    const sanitized = await new PptxPackageSanitizer().sanitize(
      await makePptxWithRunLanguages(),
      { markEastAsianRunLanguage: true },
    );
    const xml = await readSlide(sanitized);

    expect(xml).toContain('<a:rPr lang="ja-JP" altLang="zh-CN"/><a:t>日本語の資料。</a:t>');
    expect(xml).toContain('<a:rPr lang="zh-CN" altLang="en-US"/><a:t>一二三，四五六。</a:t>');
  });
});

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

describe('PptxPackageSanitizer paint warnings', () => {
  it('forwards the text-opacity warning and leaves a run without an explicit fill untouched', async () => {
    const plan = createPptxPaintPatchPlan();
    const marker = registerPptxTextEffects(createPptxPaintCompileContext(plan, 0), { opacity: 0.4 });
    const zip = new JSZip();
    zip.file('[Content_Types].xml', [
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '</Types>',
    ].join(''));
    zip.file('ppt/slides/slide1.xml', [
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      `<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="${marker}"/></p:nvSpPr><p:txBody>`,
      '<a:p><a:r><a:rPr lang="en-US"></a:rPr><a:t>Text</a:t></a:r></a:p>',
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    ].join(''));
    const warnings: PptxPaintWarning[] = [];

    const sanitized = await new PptxPackageSanitizer().sanitize(
      await zip.generateAsync({ type: 'nodebuffer' }),
      { paintPlan: plan, onWarning: (warning) => warnings.push(warning) },
    );

    const xml = await (await JSZip.loadAsync(sanitized)).file('ppt/slides/slide1.xml')!.async('text');
    expect(xml).toContain('<a:rPr lang="en-US"/>');
    expect(xml).not.toContain('alpha');
    expect(warnings).toEqual([expect.objectContaining({ code: 'text_opacity_not_written', slideNumber: 1 })]);
  });
});
