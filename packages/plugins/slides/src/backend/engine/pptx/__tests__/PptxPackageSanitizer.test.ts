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
  it('removes duplicate/missing Content_Types entries and renumbers non-visual ids for generated decks', async () => {
    const sanitizer = new PptxPackageSanitizer();
    const sanitized = await sanitizer.sanitize(await makePptxWithPackageIssues(), { renumberObjectIds: true });
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

const SLIDE_NS = [
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"',
].join(' ');

function shape(id: number | string | undefined, name: string): string {
  const idAttribute = id === undefined ? '' : ` id="${id}"`;
  return `<p:sp><p:nvSpPr><p:cNvPr${idAttribute} name="${name}"/></p:nvSpPr></p:sp>`;
}

function connector(id: number, name: string, from: number, to: number): string {
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvCxnSpPr><a:stCxn id="${from}" idx="3"/><a:endCxn id="${to}" idx="1"/></p:cNvCxnSpPr></p:nvCxnSpPr></p:cxnSp>`;
}

function group(id: number, name: string, children: string): string {
  return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/></p:nvGrpSpPr>${children}</p:grpSp>`;
}

async function makePptxWithSlideTree(tree: string, extra = ''): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', [
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    '</Types>',
  ].join(''));
  zip.file('ppt/slides/slide1.xml', `<p:sld ${SLIDE_NS}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld>${extra}</p:sld>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function objectIds(xml: string): string[] {
  return [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1]);
}

describe('PptxPackageSanitizer object ids of imported decks', () => {
  it('leaves non-contiguous author ids and the part untouched by default', async () => {
    const source = await makePptxWithSlideTree(
      shape(1, 'root') + shape(4, 'start') + shape(9, 'end') + connector(17, 'link', 4, 9),
      '<p:timing><p:tgtEl><p:spTgt spid="9"/></p:tgtEl></p:timing>',
    );

    const sanitized = await new PptxPackageSanitizer().sanitize(source);

    expect(sanitized.equals(source)).toBe(true);
  });

  it('gives a conflicting object a fresh id above every existing one and keeps the first owner', async () => {
    const source = await makePptxWithSlideTree(
      shape(2, 'first') + shape(8, 'second') + shape(2, 'pasted copy') + connector(12, 'link', 2, 8),
    );

    const xml = await readSlide(await new PptxPackageSanitizer().sanitize(source));

    expect(objectIds(xml)).toEqual(['2', '8', '13', '12']);
    expect(xml).toContain('<p:cNvPr id="13" name="pasted copy"/>');
    expect(xml).toContain('<a:stCxn id="2" idx="3"/><a:endCxn id="8" idx="1"/>');
  });

  it('allocates ids for objects whose id is missing or not a valid drawing element id', async () => {
    const source = await makePptxWithSlideTree(
      shape(3, 'a') + shape(undefined, 'no id') + shape(0, 'zero') + shape('x1', 'text'),
    );

    const xml = await readSlide(await new PptxPackageSanitizer().sanitize(source));

    expect(xml).toContain('<p:cNvPr id="3" name="a"/>');
    expect(xml).toContain('<p:cNvPr name="no id" id="4"/>');
    expect(xml).toContain('<p:cNvPr id="5" name="zero"/>');
    expect(xml).toContain('<p:cNvPr id="6" name="text"/>');
  });

  it('lets an mc:Fallback object share the id of its mc:Choice twin', async () => {
    const alternate = '<mc:AlternateContent><mc:Choice Requires="p14">'
      + shape(5, 'model') + '</mc:Choice><mc:Fallback>' + shape(5, 'model') + '</mc:Fallback></mc:AlternateContent>';
    const source = await makePptxWithSlideTree(shape(2, 'a') + alternate + shape(7, 'b'));

    const sanitized = await new PptxPackageSanitizer().sanitize(source);

    expect(sanitized.equals(source)).toBe(true);
  });

  it('rewrites connector ends inside a pasted group but not references from outside it', async () => {
    const original = group(10, 'group', shape(11, 'a') + shape(12, 'b') + connector(13, 'inner link', 11, 12));
    const pasted = group(10, 'group copy', shape(11, 'a copy') + shape(12, 'b copy') + connector(13, 'inner link copy', 11, 12));
    const source = await makePptxWithSlideTree(
      original + pasted + connector(20, 'outer link', 11, 12),
      '<p:timing><p:tgtEl><p:spTgt spid="12"/></p:tgtEl></p:timing>',
    );

    const xml = await readSlide(await new PptxPackageSanitizer().sanitize(source));

    expect(objectIds(xml)).toEqual(['10', '11', '12', '13', '21', '22', '23', '24', '20']);
    expect(xml).toContain('<p:cNvPr id="21" name="group copy"/>');
    expect(xml).toContain('<p:cNvPr id="24" name="inner link copy"/><p:cNvCxnSpPr><a:stCxn id="22" idx="3"/><a:endCxn id="23" idx="1"/>');
    expect(xml).toContain('<p:cNvPr id="13" name="inner link"/><p:cNvCxnSpPr><a:stCxn id="11" idx="3"/><a:endCxn id="12" idx="1"/>');
    expect(xml).toContain('<p:cNvPr id="20" name="outer link"/><p:cNvCxnSpPr><a:stCxn id="11" idx="3"/><a:endCxn id="12" idx="1"/>');
    expect(xml).toContain('<p:spTgt spid="12"/>');
  });

  it('applies the same rule to layouts, masters and notes parts', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', [
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '</Types>',
    ].join(''));
    const layout = `<p:sldLayout ${SLIDE_NS}><p:cSld><p:spTree>${shape(1, 'root') + shape(6, 'title') + shape(9, 'body')}</p:spTree></p:cSld></p:sldLayout>`;
    const notes = `<p:notes ${SLIDE_NS}><p:cSld><p:spTree>${shape(1, 'root') + shape(3, 'note') + shape(3, 'dup')}</p:spTree></p:cSld></p:notes>`;
    zip.file('ppt/slideLayouts/slideLayout1.xml', layout);
    zip.file('ppt/slideMasters/slideMaster1.xml', layout.replace('sldLayout', 'sldMaster').replace('sldLayout', 'sldMaster'));
    zip.file('ppt/notesSlides/notesSlide1.xml', notes);

    const sanitized = await JSZip.loadAsync(
      await new PptxPackageSanitizer().sanitize(await zip.generateAsync({ type: 'nodebuffer' })),
    );

    expect(await sanitized.file('ppt/slideLayouts/slideLayout1.xml')!.async('text')).toBe(layout);
    expect(objectIds(await sanitized.file('ppt/slideMasters/slideMaster1.xml')!.async('text'))).toEqual(['1', '6', '9']);
    expect(objectIds(await sanitized.file('ppt/notesSlides/notesSlide1.xml')!.async('text'))).toEqual(['1', '3', '4']);
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
