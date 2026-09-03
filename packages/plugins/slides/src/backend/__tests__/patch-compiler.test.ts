import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';import { PatchCompiler } from '../engine/patch/PatchCompiler.js';import { StructuredCompiler } from '../engine/StructuredCompiler.js';import { PptxReader } from '../engine/parser/PptxReader.js';
import type { DeckSpec, PatchSpec, StructuredSlideSpec } from '@plugin/slides/shared';

const structuredCompiler = new StructuredCompiler();
const patchCompiler = new PatchCompiler(structuredCompiler);
const pptxReader = new PptxReader();
const FIXTURES_DIR = join(__dirname, 'fixtures');

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

function makeSlide(title: string): StructuredSlideSpec {
  return {
    type: 'structured',
    elements: [
      { type: 'title', content: title, position: { x: 1, y: 1, w: 8, h: 1 } },
      { type: 'text', content: `Body of ${title}`, position: { x: 1, y: 2.5, w: 8, h: 1 } },
    ],
  };
}

function makeDeck(titles: string[]): DeckSpec {
  return {
    title: 'Test Deck',
    layout: '16x9',
    slides: titles.map((t, i) => ({
      slideNumber: i + 1,
      spec: makeSlide(t),
    })),
  };
}

function makeShapeDeck(): DeckSpec {
  return {
    title: 'Shape Deck',
    layout: '16x9',
    slides: [
      {
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [
            {
              type: 'shape',
              geometry: 'rect',
              position: { x: 1, y: 1.4, w: 2.2, h: 1.1 },
              style: { fill: '#FF0000' },
              text: 'Back Box',
            },
            {
              type: 'shape',
              geometry: 'rect',
              position: { x: 1.4, y: 1.7, w: 2.2, h: 1.1 },
              style: { fill: '#0000FF' },
              text: 'Front Box',
            },
          ],
        },
      },
    ],
  };
}

async function makeBuffer(titles: string[]): Promise<Buffer> {
  return structuredCompiler.compileDeck(makeDeck(titles));
}

async function countSlides(buffer: Buffer): Promise<number> {
  const info = await pptxReader.parse(buffer);
  return info.slideCount;
}

async function buildMasterTemplate(layoutName = 'Imported Layout'): Promise<Buffer> {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
      <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
      <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
      <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
    </Types>`);

  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:sldMasterIdLst>
        <p:sldMasterId id="2147483648" r:id="rId1"/>
      </p:sldMasterIdLst>
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId2"/>
      </p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`);

  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>`);

  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree/></p:cSld>
    </p:sld>`);

  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`);

  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld name="${layoutName}">
        <p:spTree/>
      </p:cSld>
    </p:sldLayout>`);

  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
    </Relationships>`);

  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld name="Imported Master">
        <p:spTree/>
      </p:cSld>
    </p:sldMaster>`);

  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
    </Relationships>`);

  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Imported Theme">
      <a:themeElements>
        <a:clrScheme name="Imported Colors">
          <a:dk1><a:srgbClr val="000000"/></a:dk1>
          <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
          <a:accent1><a:srgbClr val="00AAFF"/></a:accent1>
        </a:clrScheme>
        <a:fontScheme name="Imported Fonts">
          <a:majorFont><a:latin typeface="Imported Major"/></a:majorFont>
          <a:minorFont><a:latin typeface="Imported Minor"/></a:minorFont>
        </a:fontScheme>
      </a:themeElements>
    </a:theme>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('PatchCompiler', () => {
  // ─── 空操作 ─────────────────────────────────────────────────────────

  it('returns source buffer unchanged for empty operations', async () => {
    const source = await makeBuffer(['Slide 1']);
    const patchSpec: PatchSpec = { type: 'patch', operations: [] };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(result).toBe(source);
  });

  // ─── modify_text ──────────────────────────────────────────────────────

  it('modifies text on a slide by element name', async () => {
    const source = await makeBuffer(['Original Title']);
    const info = await pptxReader.parse(source);
    const titleEl = info.slides[0].elements.find((e) => e.text === 'Original Title');
    expect(titleEl).toBeDefined();

    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_text',
          target: { slideNumber: 1, elementName: titleEl!.name },
          text: 'New Title',
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);

    const resultInfo = await pptxReader.parse(result);
    expect(resultInfo.slideCount).toBe(1);
    const texts = resultInfo.slides[0].elements
      .filter((e) => e.type === 'text' && e.text)
      .map((e) => e.text);
    expect(texts).toContain('New Title');
  });

  // ─── delete_slide ─────────────────────────────────────────────────────

  it('deletes a slide from a multi-slide deck', async () => {
    const source = await makeBuffer(['Slide 1', 'Slide 2', 'Slide 3']);
    expect(await countSlides(source)).toBe(3);

    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'delete_slide', slideNumber: 2 }],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(2);

    const info = await pptxReader.parse(result);
    const allTexts = info.slides.flatMap((s) =>
      s.elements.filter((e) => e.type === 'text' && e.text).map((e) => e.text),
    );
    expect(allTexts).toContain('Slide 1');
    expect(allTexts).not.toContain('Slide 2');
    expect(allTexts).toContain('Slide 3');
  });

  it('throws for delete_slide with out-of-range slideNumber', async () => {
    const source = await makeBuffer(['Slide 1']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'delete_slide', slideNumber: 5 }],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'out of range',
    );
  });

  it('deletes multiple slides', async () => {
    const source = await makeBuffer(['S1', 'S2', 'S3', 'S4']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'delete_slide', slideNumber: 1 },
        { op: 'delete_slide', slideNumber: 3 },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(2);
  });

  // ─── insert_slide ─────────────────────────────────────────────────────

  it('inserts a slide after the last slide (slideNumber = length + 1)', async () => {
    const source = await makeBuffer(['Slide 1']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'insert_slide',
          slideNumber: 2,
          spec: makeSlide('Inserted Slide'),
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(2);
  });

  it('inserts a slide before the first slide (slideNumber=1)', async () => {
    const source = await makeBuffer(['Slide 1']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'insert_slide',
          slideNumber: 1,
          spec: makeSlide('Prepended'),
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(2);
  });

  it('inserts a slide between existing slides', async () => {
    const source = await makeBuffer(['Slide 1', 'Slide 3']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'insert_slide',
          slideNumber: 2,
          spec: makeSlide('Slide 2'),
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(3);
  });

  // ─── reorder_slides ───────────────────────────────────────────────────

  it('reorders slides', async () => {
    const source = await makeBuffer(['First', 'Second', 'Third']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'reorder_slides', order: [3, 1, 2] }],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    expect(await countSlides(result)).toBe(3);

    const info = await pptxReader.parse(result);
    const firstSlideTexts = info.slides[0].elements
      .filter((e) => e.type === 'text' && e.text)
      .map((e) => e.text);
    expect(firstSlideTexts).toContain('Third');
  });

  it('throws for reorder referencing out-of-range slide', async () => {
    const source = await makeBuffer(['S1', 'S2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'reorder_slides', order: [1, 5] }],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'out of range',
    );
  });

  it('throws for reorder referencing deleted slide', async () => {
    const source = await makeBuffer(['S1', 'S2', 'S3']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'delete_slide', slideNumber: 2 },
        { op: 'reorder_slides', order: [3, 2, 1] },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'must contain exactly 2 surviving slides',
    );
  });

  it('throws for reorder with duplicate slides', async () => {
    const source = await makeBuffer(['S1', 'S2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'reorder_slides', order: [1, 1] }],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'duplicate slide',
    );
  });

  it('throws for reorder that omits surviving slides', async () => {
    const source = await makeBuffer(['S1', 'S2', 'S3']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'reorder_slides', order: [3, 1] }],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'must contain exactly 3 surviving slides',
    );
  });

  it('throws for multiple reorder_slides operations', async () => {
    const source = await makeBuffer(['S1', 'S2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'reorder_slides', order: [2, 1] },
        { op: 'reorder_slides', order: [1, 2] },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'Multiple reorder_slides',
    );
  });

  // ─── 组合操作 ─────────────────────────────────────────────────────────

  it('handles delete + insert in one patch', async () => {
    const source = await makeBuffer(['S1', 'S2', 'S3']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'delete_slide', slideNumber: 2 },
        {
          op: 'insert_slide',
          slideNumber: 2,
          spec: makeSlide('New S2'),
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    // S2 deleted, new slide inserted after S1 → still 3 slides
    expect(await countSlides(result)).toBe(3);
  });

  // ─── modify_style ─────────────────────────────────────────────────────

  it('modifies shape fill color', async () => {
    const source = loadFixture('themed.pptx');
    const info = await pptxReader.parse(source);
    const shapeEl = info.slides[0].elements.find((e) => e.name === 'Shape 0');
    expect(shapeEl).toBeDefined();

    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_style',
          target: { slideNumber: 1, elementName: shapeEl!.name },
          style: { fill: '#00FF00' },
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    const zip = await JSZip.loadAsync(result);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    expect(slideXml).toContain('00FF00');
  });

  it('throws for unsupported modify_style fields (borderRadius)', async () => {
    const source = await makeBuffer(['Styled']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_style',
          target: { slideNumber: 1, elementName: 'Title 1' },
          style: { borderRadius: 10 },
        },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'unsupported style fields',
    );
  });

  // ─── modify_geometry ──────────────────────────────────────────────────

  it('modifies element geometry on an existing slide', async () => {
    const source = await makeBuffer(['Geometry Title']);
    const info = await pptxReader.parse(source);
    const titleEl = info.slides[0].elements.find((e) => e.text === 'Geometry Title');
    expect(titleEl?.position).toBeDefined();

    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_geometry',
          target: { slideNumber: 1, elementName: titleEl!.name },
          position: { x: 2.25, y: 1.75, w: 5.5 },
        },
      ],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    const resultInfo = await pptxReader.parse(result);
    const patchedTitle = resultInfo.slides[0].elements.find((e) => e.name === titleEl!.name);

    expect(patchedTitle?.position).toMatchObject({
      x: 2.25,
      y: 1.75,
      w: 5.5,
    });
    expect(patchedTitle?.position?.h).toBeCloseTo(titleEl!.position!.h, 2);
  });

  it('throws for modify_geometry with no position fields', async () => {
    const source = await makeBuffer(['Geometry Title']);

    await expect(
      patchCompiler.compile(source, {
        type: 'patch',
        operations: [
          {
            op: 'modify_geometry',
            target: { slideNumber: 1, elementName: 'Title 1' },
            position: {},
          },
        ],
      }),
    ).rejects.toThrow('at least one of x, y, w, h is required');
  });

  // ─── reorder_layer ────────────────────────────────────────────────────

  it('reorders target element to the front of the slide layer stack', async () => {
    const source = await structuredCompiler.compileDeck(makeShapeDeck());
    const info = await pptxReader.parse(source);
    const shapeElements = info.slides[0].elements.filter((e) => e.type === 'text' && e.text);
    expect(shapeElements.length).toBeGreaterThanOrEqual(2);

    const backShape = shapeElements.find((element) => element.text === 'Back Box');
    const frontShape = shapeElements.find((element) => element.text === 'Front Box');
    expect(backShape).toBeDefined();
    expect(frontShape).toBeDefined();

    const result = await patchCompiler.compile(source, {
      type: 'patch',
      operations: [
        {
          op: 'reorder_layer',
          target: { slideNumber: 1, elementName: backShape!.name },
          placement: 'front',
        },
      ],
    });

    const zip = await JSZip.loadAsync(result);
    const slideXml = await zip.file('ppt/slides/slide1.xml')!.async('text');
    const backIndex = slideXml.indexOf(`name="${backShape!.name}"`);
    const frontIndex = slideXml.indexOf(`name="${frontShape!.name}"`);

    expect(backIndex).toBeGreaterThan(frontIndex);
  });

  // ─── apply_master ─────────────────────────────────────────────────────

  it('applies a template layout to a slide', async () => {
    const templateBuffer = await buildMasterTemplate('Imported Layout');
    const templateManager = {
      getTemplate: vi.fn(async () => ({
        id: 'template-1',
        name: 'Imported Template',
        description: undefined,
        spec: {
          id: 'template-1',
          name: 'Imported Template',
          theme: { colors: {}, fonts: { major: 'Imported Major', minor: 'Imported Minor' } },
          layouts: ['Imported Layout'],
          masters: ['Imported Master'],
        },
        sourcePptxBuffer: templateBuffer,
        createdAt: 0,
        updatedAt: 0,
        usageCount: 0,
      })),
    };
    const patchCompilerWithTemplates = new PatchCompiler(
      structuredCompiler,
      templateManager,
      pptxReader,
    );
    const source = await makeBuffer(['Slide 1']);

    const result = await patchCompilerWithTemplates.compile(source, {
      type: 'patch',
      operations: [
        {
          op: 'apply_master',
          slideNumber: 1,
          templateId: 'template-1',
          layoutName: 'Imported Layout',
        },
      ],
    });

    const info = await pptxReader.parse(result);
    expect(info.slides[0].layoutName).toBe('Imported Layout');
  });

  // ─── 验证 ─────────────────────────────────────────────────────────────

  it('throws for modify on a deleted slide', async () => {
    const source = await makeBuffer(['S1', 'S2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        { op: 'delete_slide', slideNumber: 1 },
        {
          op: 'modify_text',
          target: { slideNumber: 1, elementName: 'Title 1' },
          text: 'Nope',
        },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'marked for deletion',
    );
  });

  it('throws for modify on a slide deleted later in the same patch', async () => {
    const source = await makeBuffer(['S1', 'S2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_text',
          target: { slideNumber: 1, elementName: 'Title 1' },
          text: 'Nope',
        },
        { op: 'delete_slide', slideNumber: 1 },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'marked for deletion',
    );
  });

  it('throws for modify on out-of-range slide', async () => {
    const source = await makeBuffer(['S1']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [
        {
          op: 'modify_text',
          target: { slideNumber: 99, elementName: 'Title 1' },
          text: 'Nope',
        },
      ],
    };

    await expect(patchCompiler.compile(source, patchSpec)).rejects.toThrow(
      'out of range',
    );
  });

  // ─── 输出有效性 ───────────────────────────────────────────────────────

  it('produces a valid PPTX after patching', async () => {
    const source = await makeBuffer(['Slide 1', 'Slide 2']);
    const patchSpec: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'delete_slide', slideNumber: 1 }],
    };

    const result = await patchCompiler.compile(source, patchSpec);
    const zip = await JSZip.loadAsync(result);
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('ppt/presentation.xml')).not.toBeNull();
  });

  it('dedupes content type overrides after patching with inserted slides', async () => {
    const source = await makeBuffer(['Slide 1', 'Slide 2']);
    const result = await patchCompiler.compile(source, {
      type: 'patch',
      operations: [
        {
          op: 'insert_slide',
          slideNumber: 2,
          spec: makeSlide('Inserted Slide'),
        },
        {
          op: 'reorder_slides',
          order: [2, 1],
        },
      ],
    });

    const zip = await JSZip.loadAsync(result);
    const contentTypesXml = await zip.file('[Content_Types].xml')!.async('text');
    const partNames = [...contentTypesXml.matchAll(/PartName="([^"]+)"/g)].map((match) => match[1]);
    const duplicates = partNames.filter((partName, index) => partNames.indexOf(partName) !== index);

    expect(duplicates).toEqual([]);
  });
});
