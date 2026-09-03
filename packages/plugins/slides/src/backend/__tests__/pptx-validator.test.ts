import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';import { PptxValidator } from '../engine/pptx/PptxValidator.js';import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import type { DeckSpec } from '@plugin/slides/shared';

const validator = new PptxValidator();
const compiler = new StructuredCompiler();

function makeDeck(title = 'Test'): DeckSpec {
  return {
    title,
    layout: '16x9',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [
          { type: 'title', content: title, position: { x: 1, y: 1, w: 8, h: 1 } },
        ],
      },
    }],
  };
}

describe('PptxValidator', () => {
  it('validates a well-formed PPTX as valid', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const result = await validator.validate(buffer);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.structure.hasContentTypes).toBe(true);
    expect(result.structure.hasPresentation).toBe(true);
    expect(result.structure.hasPresentationRels).toBe(true);
    expect(result.structure.slideCount).toBe(1);
    expect(result.structure.slideFiles.length).toBeGreaterThan(0);
  });

  it('validates a multi-slide PPTX', async () => {
    const deck: DeckSpec = {
      title: 'Multi',
      slides: [
        { slideNumber: 1, spec: { type: 'structured', elements: [{ type: 'title', content: 'S1', position: { x: 1, y: 1, w: 8, h: 1 } }] } },
        { slideNumber: 2, spec: { type: 'structured', elements: [{ type: 'text', content: 'S2', position: { x: 1, y: 1, w: 8, h: 1 } }] } },
        { slideNumber: 3, spec: { type: 'structured', elements: [{ type: 'text', content: 'S3', position: { x: 1, y: 1, w: 8, h: 1 } }] } },
      ],
    };
    const buffer = await compiler.compileDeck(deck);
    const result = await validator.validate(buffer);

    expect(result.valid).toBe(true);
    expect(result.structure.slideCount).toBe(3);
  });

  it('rejects an empty buffer', async () => {
    const result = await validator.validate(Buffer.alloc(0));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Not a valid ZIP archive');
  });

  it('rejects a non-ZIP buffer', async () => {
    const result = await validator.validate(Buffer.from('not a zip file'));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Not a valid ZIP archive');
  });

  it('rejects a ZIP without Content_Types', async () => {
    const zip = new JSZip();
    zip.file('dummy.txt', 'hello');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(buffer as Buffer);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing [Content_Types].xml');
  });

  it('rejects a ZIP without presentation.xml', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(buffer as Buffer);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing ppt/presentation.xml'))).toBe(true);
  });

  it('warns on duplicate Content_Types overrides', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const zip = await JSZip.loadAsync(buffer);

    // 手动注入重复 override
    const ct = await zip.file('[Content_Types].xml')!.async('text');
    const injected = ct.replace(
      '</Types>',
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    );
    zip.file('[Content_Types].xml', injected);
    const modified = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(modified as Buffer);
    expect(result.structure.duplicateOverrides.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('Duplicate'))).toBe(true);
  });

  it('rejects Content_Types overrides that reference missing parts', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const zip = await JSZip.loadAsync(buffer);

    const ct = await zip.file('[Content_Types].xml')!.async('text');
    const injected = ct.replace(
      '</Types>',
      '<Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/></Types>',
    );
    zip.file('[Content_Types].xml', injected);
    const modified = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(modified as Buffer);
    expect(result.valid).toBe(false);
    expect(result.structure.missingOverrideParts).toContain('/ppt/slideMasters/slideMaster2.xml');
    expect(result.errors.some((e) => e.includes('missing parts'))).toBe(true);
  });

  it('detects orphaned rels', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const zip = await JSZip.loadAsync(buffer);

    // 注入一个指向不存在文件的 rel
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const rels = await zip.file(relsPath)!.async('text');
    const injected = rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdOrphan" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slideNONEXISTENT.xml"/></Relationships>',
    );
    zip.file(relsPath, injected);
    const modified = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(modified as Buffer);
    expect(result.valid).toBe(false);
    expect(result.structure.orphanedRels.length).toBeGreaterThan(0);
  });

  it('rejects slides with duplicate non-visual object ids', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const zip = await JSZip.loadAsync(buffer);
    const slidePath = 'ppt/slides/slide1.xml';
    const slide = await zip.file(slidePath)!.async('text');
    const injected = slide.replace(/(<p:cNvPr id=")2(")/, (_match, prefix: string, suffix: string) => `${prefix}1${suffix}`);
    zip.file(slidePath, injected);
    const modified = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await validator.validate(modified as Buffer);
    expect(result.valid).toBe(false);
    expect(result.structure.duplicateObjectIds[0]).toContain('ppt/slides/slide1.xml');
  });

  it('reports theme and master files', async () => {
    const buffer = await compiler.compileDeck(makeDeck());
    const result = await validator.validate(buffer);

    expect(result.structure.themeFiles.length).toBeGreaterThan(0);
  });
});
