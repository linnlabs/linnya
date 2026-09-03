import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';import { PptxReader } from '../engine/parser/PptxReader.js';

const FIXTURES_DIR = join(__dirname, 'fixtures');

function loadFixture(name: string): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}

async function buildSyntheticPptx(options?: {
  groupedText?: string;
  groupedTextBodyXml?: string;
  theme1Accent1?: string;
  theme2Accent1?: string;
  theme2Major?: string;
  theme2Minor?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  const groupedText = options?.groupedText ?? 'Grouped child text';
  const groupedTextBodyXml = options?.groupedTextBodyXml ?? `
                <a:bodyPr/>
                <a:lstStyle/>
                <a:p>
                  <a:r><a:t>${groupedText}</a:t></a:r>
                </a:p>`;
  const theme1Accent1 = options?.theme1Accent1 ?? 'FF0000';
  const theme2Accent1 = options?.theme2Accent1 ?? '00FF00';
  const theme2Major = options?.theme2Major ?? 'Theme Two Major';
  const theme2Minor = options?.theme2Minor ?? 'Theme Two Minor';

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
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
      <p:cSld>
        <p:spTree>
          <p:grpSp>
            <p:nvGrpSpPr>
              <p:cNvPr id="1" name="Group 1"/>
            </p:nvGrpSpPr>
            <p:grpSpPr>
              <a:xfrm>
                <a:off x="914400" y="914400"/>
                <a:ext cx="3657600" cy="1828800"/>
                <a:chOff x="0" y="0"/>
                <a:chExt cx="3657600" cy="1828800"/>
              </a:xfrm>
            </p:grpSpPr>
            <p:sp>
              <p:nvSpPr>
                <p:cNvPr id="2" name="Grouped Text"/>
              </p:nvSpPr>
              <p:spPr>
                <a:xfrm>
                  <a:off x="457200" y="457200"/>
                  <a:ext cx="1828800" cy="457200"/>
                </a:xfrm>
                <a:prstGeom prst="rect"/>
              </p:spPr>
              <p:txBody>
                ${groupedTextBodyXml}
              </p:txBody>
            </p:sp>
          </p:grpSp>
        </p:spTree>
      </p:cSld>
    </p:sld>`);

  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
    </Relationships>`);

  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld name="Layout 1">
        <p:spTree/>
      </p:cSld>
    </p:sldLayout>`);

  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld name="Master 1">
        <p:spTree/>
      </p:cSld>
    </p:sldMaster>`);

  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/>
    </Relationships>`);

  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Theme One">
      <a:themeElements>
        <a:clrScheme name="Theme One Colors">
          <a:dk1><a:srgbClr val="000000"/></a:dk1>
          <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
          <a:accent1><a:srgbClr val="${theme1Accent1}"/></a:accent1>
        </a:clrScheme>
        <a:fontScheme name="Theme One Fonts">
          <a:majorFont><a:latin typeface="Theme One Major"/></a:majorFont>
          <a:minorFont><a:latin typeface="Theme One Minor"/></a:minorFont>
        </a:fontScheme>
      </a:themeElements>
    </a:theme>`);

  zip.file('ppt/theme/theme2.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Theme Two">
      <a:themeElements>
        <a:clrScheme name="Theme Two Colors">
          <a:dk1><a:srgbClr val="111111"/></a:dk1>
          <a:lt1><a:srgbClr val="EEEEEE"/></a:lt1>
          <a:accent1><a:srgbClr val="${theme2Accent1}"/></a:accent1>
        </a:clrScheme>
        <a:fontScheme name="Theme Two Fonts">
          <a:majorFont><a:latin typeface="${theme2Major}"/></a:majorFont>
          <a:minorFont><a:latin typeface="${theme2Minor}"/></a:minorFont>
        </a:fontScheme>
      </a:themeElements>
    </a:theme>`);

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('PptxReader', () => {
  const reader = new PptxReader();

  // ─── simple.pptx ──────────────────────────────────────────────────────

  describe('simple.pptx', () => {
    it('parses slide count and size', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.slideCount).toBe(1);
      // 12192000 EMU = 13.333 inches, 6858000 EMU = 7.5 inches (standard 16:9)
      expect(info.slideSize.width).toBeCloseTo(13.333, 1);
      expect(info.slideSize.height).toBeCloseTo(7.5, 1);
    });

    it('parses slide elements', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      const slide = info.slides[0];
      expect(slide.number).toBe(1);
      expect(slide.elements.length).toBeGreaterThanOrEqual(2);

      // "Text 0" — title text
      const title = slide.elements.find((e) => e.name === 'Text 0');
      expect(title).toBeDefined();
      expect(title!.type).toBe('text');
      expect(title!.text).toBe('Simple Fixture');
      expect(title!.position).toBeDefined();

      // "Text 1" — subtitle text
      const subtitle = slide.elements.find((e) => e.name === 'Text 1');
      expect(subtitle).toBeDefined();
      expect(subtitle!.type).toBe('text');
      expect(subtitle!.text).toBe('Phase 0 scaffold validation fixture');
      expect(title!.editableTarget).toMatchObject({
        slideNumber: 1,
        elementName: 'Text 0',
        operations: ['modify_text', 'modify_style', 'modify_geometry', 'reorder_layer'],
      });
    });

    it('parses theme colors', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.theme.colors.dk1).toBe('#000000');
      expect(info.theme.colors.lt1).toBe('#FFFFFF');
      expect(info.theme.colors.accent1).toBe('#4472C4');
      expect(info.theme.colors.accent2).toBe('#ED7D31');
      expect(info.theme.colors.hlink).toBe('#0563C1');
    });

    it('derives chart palette from theme accents in Office chart order', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.theme.chart?.palette).toEqual([
        '#ED7D31',
        '#4472C4',
        '#A5A5A5',
        '#FFC000',
        '#5B9BD5',
        '#70AD47',
      ]);
    });

    it('parses theme fonts', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.theme.fonts.major).toBe('Calibri Light');
      expect(info.theme.fonts.minor).toBe('Calibri');
    });

    it('parses theme name', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.theme.name).toBe('Office Theme');
    });

    it('parses masters and layouts', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.masters.length).toBeGreaterThanOrEqual(1);
      const master = info.masters[0];
      expect(master.layouts).toContain('DEFAULT');
    });

    it('resolves slide layout name', async () => {
      const info = await reader.parse(loadFixture('simple.pptx'));
      expect(info.slides[0].layoutName).toBe('DEFAULT');
    });
  });

  // ─── themed.pptx ─────────────────────────────────────────────────────

  describe('themed.pptx', () => {
    it('parses slide with shape and text elements', async () => {
      const info = await reader.parse(loadFixture('themed.pptx'));
      expect(info.slideCount).toBe(1);

      const slide = info.slides[0];
      // "Shape 0" — a filled rectangle with no text
      const shape = slide.elements.find((e) => e.name === 'Shape 0');
      expect(shape).toBeDefined();
      expect(shape!.type).toBe('shape');

      // "Text 1" — title text
      const title = slide.elements.find((e) => e.name === 'Text 1');
      expect(title).toBeDefined();
      expect(title!.type).toBe('text');
      expect(title!.text).toBe('Themed Fixture');
    });

    it('extracts element positions', async () => {
      const info = await reader.parse(loadFixture('themed.pptx'));
      const shape = info.slides[0].elements.find((e) => e.name === 'Shape 0');
      expect(shape!.position).toBeDefined();
      expect(shape!.position!.x).toBeGreaterThan(0);
      expect(shape!.position!.w).toBeGreaterThan(0);
    });
  });

  // ─── with-chart.pptx ─────────────────────────────────────────────────

  describe('with-chart.pptx', () => {
    it('identifies chart element', async () => {
      const info = await reader.parse(loadFixture('with-chart.pptx'));
      expect(info.slideCount).toBe(1);

      const slide = info.slides[0];
      const chart = slide.elements.find((e) => e.type === 'chart');
      expect(chart).toBeDefined();
      expect(chart!.name).toBe('Chart 0');
      expect(chart!.position).toBeDefined();
    });

    it('also parses text elements alongside chart', async () => {
      const info = await reader.parse(loadFixture('with-chart.pptx'));
      const slide = info.slides[0];
      const text = slide.elements.find((e) => e.name === 'Text 0');
      expect(text).toBeDefined();
      expect(text!.text).toBe('Chart Fixture');
    });
  });

  // ─── 异常处理 ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on invalid buffer', async () => {
      await expect(reader.parse(Buffer.from('not a zip'))).rejects.toThrow();
    });

    it('throws on ZIP without presentation.xml', async () => {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('dummy.txt', 'hello');
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      await expect(reader.parse(buf)).rejects.toThrow('Invalid PPTX');
    });
  });

  describe('master/theme and grouped content edge cases', () => {
    it('reads the active theme through the slide master relationship chain', async () => {
      const buffer = await buildSyntheticPptx();

      const info = await reader.parse(buffer);
      expect(info.theme.name).toBe('Theme Two');
      expect(info.theme.colors.accent1).toBe('#00FF00');
      expect(info.theme.fonts.major).toBe('Theme Two Major');
      expect(info.theme.fonts.minor).toBe('Theme Two Minor');
      expect(info.theme.chart?.palette).toEqual([
        '#B64646',
        '#00FF00',
        '#59714B',
        '#7A548E',
        '#41A5B4',
        '#D88C3A',
      ]);
    });

    it('preserves grouped child content during inspect', async () => {
      const buffer = await buildSyntheticPptx({ groupedText: 'Grouped text survives' });

      const info = await reader.parse(buffer);
      const group = info.slides[0].elements.find((e) => e.type === 'group');

      expect(group).toBeDefined();
      expect(group?.children).toHaveLength(1);
      expect(group?.children?.[0]).toMatchObject({
        type: 'text',
        text: 'Grouped text survives',
      });
      expect(group?.children?.[0]?.position).toBeDefined();
      expect(group?.children?.[0]?.position?.x).toBeGreaterThan(group!.position!.x);
      expect(group?.children?.[0]?.position?.y).toBeGreaterThan(group!.position!.y);
    });

    it('extracts imported text body semantics and paragraph metadata', async () => {
      const buffer = await buildSyntheticPptx({
        groupedTextBodyXml: `
                <a:bodyPr wrap="none" anchor="ctr" lIns="91440" rIns="45720" tIns="45720" bIns="22860">
                  <a:normAutofit/>
                </a:bodyPr>
                <a:lstStyle/>
                <a:p>
                  <a:pPr indent="45720">
                    <a:lnSpc><a:spcPct val="140000"/></a:lnSpc>
                    <a:spcBef><a:spcPts val="600"/></a:spcBef>
                    <a:spcAft><a:spcPts val="400"/></a:spcAft>
                  </a:pPr>
                  <a:r>
                    <a:rPr sz="1800" b="1" i="1">
                      <a:latin typeface="Aptos"/>
                    </a:rPr>
                    <a:t>Grouped child text</a:t>
                  </a:r>
                </a:p>`,
      });

      const info = await reader.parse(buffer);
      const group = info.slides[0].elements.find((e) => e.type === 'group');
      const child = group?.children?.[0];

      expect(child?.textBody).toEqual({
        wrap: 'none',
        autoFit: 'shrink-text',
        verticalAlign: 'middle',
        padding: {
          left: 0.1,
          right: 0.05,
          top: 0.05,
          bottom: 0.025,
        },
      });
      expect(child?.textStyle).toEqual({
        fontFamily: 'Aptos',
        fontSize: 18,
        bold: true,
        italic: true,
      });
      expect(child?.paragraphs).toEqual([{
        runs: [{
          text: 'Grouped child text',
          fontFamily: 'Aptos',
          resolvedFontFamily: 'Aptos',
          fontScript: 'latin',
          fontResolution: 'not-ready',
          fontSize: 18,
          bold: true,
          italic: true,
        }],
        align: undefined,
        spacingBeforePt: 6,
        spacingAfterPt: 4,
        indentInches: 0.05,
        lineSpacing: { kind: 'multiple', value: 1.4 },
        lineSpacingResolution: { source: 'paragraph' },
      }]);
    });

    it('keeps ordered paragraphs, rich runs, soft breaks, empty paragraphs, and per-paragraph spacing', async () => {
      const buffer = await buildSyntheticPptx({
        groupedTextBodyXml: `
                <a:bodyPr/>
                <a:lstStyle>
                  <a:lvl1pPr><a:lnSpc><a:spcPct val="130000"/></a:lnSpc></a:lvl1pPr>
                </a:lstStyle>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr sz="1200" b="1"/><a:t>First</a:t></a:r>
                  <a:br/>
                  <a:r><a:rPr sz="1000" i="1"/><a:t>continued</a:t></a:r>
                </a:p>
                <a:p>
                  <a:r><a:t>Second</a:t></a:r>
                </a:p>
                <a:p/>`,
      });

      const child = (await reader.parse(buffer)).slides[0].elements
        .find((element) => element.type === 'group')
        ?.children?.[0];

      expect(child?.text).toBe('First\ncontinued\nSecond\n');
      expect(child?.paragraphs).toHaveLength(3);
      expect(child?.paragraphs?.[0]).toMatchObject({
        runs: [
          { text: 'First', fontSize: 12, bold: true },
          { text: '\n' },
          { text: 'continued', fontSize: 10, italic: true },
        ],
        lineSpacing: { kind: 'exactPt', value: 18 },
        lineSpacingResolution: { source: 'paragraph' },
      });
      expect(child?.paragraphs?.[1]).toMatchObject({
        runs: [{ text: 'Second' }],
        lineSpacing: { kind: 'multiple', value: 1.3 },
        lineSpacingResolution: { source: 'list-style' },
      });
      expect(child?.paragraphs?.[2]).toMatchObject({
        runs: [{ text: '' }],
        lineSpacingResolution: { source: 'list-style' },
      });
    });
  });

  // ─── shape + text 语义保留（imported / patched 路径） ─────────────────

  describe('shape vs textbox semantic split', () => {
    function buildSpTreeWithCustomSp(spXml: string): JSZip {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
        </Types>`);
      zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
        <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
          <p:sldSz cx="12192000" cy="6858000"/>
        </p:presentation>`);
      zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        </Relationships>`);
      zip.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
          xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>${spXml}</p:spTree></p:cSld>
        </p:sld>`);
      return zip;
    }

    it('keeps prstGeom="rect" textbox without visual props as text', async () => {
      const zip = buildSpTreeWithCustomSp(`
        <p:sp>
          <p:nvSpPr><p:cNvPr id="1" name="Plain Text"/><p:cNvSpPr txBox="1"/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="457200"/></a:xfrm>
            <a:prstGeom prst="rect"/>
          </p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:t>Plain</a:t></a:r></a:p></p:txBody>
        </p:sp>`);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const info = await reader.parse(buffer);
      const el = info.slides[0].elements[0]!;
      expect(el.type).toBe('text');
      expect(el.text).toBe('Plain');
      expect(el.shapeVisual).toBeUndefined();
    });

    it('treats non-rect prstGeom as shape and preserves innerText + visual', async () => {
      const zip = buildSpTreeWithCustomSp(`
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="Decorated Roundrect"/><p:cNvSpPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm rot="5400000"><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
            <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 16667"/></a:avLst></a:prstGeom>
            <a:solidFill><a:srgbClr val="FF8800"/></a:solidFill>
            <a:ln w="12700"><a:solidFill><a:srgbClr val="003366"/></a:solidFill><a:prstDash val="solid"/></a:ln>
            <a:effectLst>
              <a:outerShdw blurRad="38100" dist="38100" dir="2700000">
                <a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr>
              </a:outerShdw>
            </a:effectLst>
          </p:spPr>
          <p:txBody><a:bodyPr/><a:p><a:r><a:t>Inside Shape</a:t></a:r></a:p></p:txBody>
        </p:sp>`);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const info = await reader.parse(buffer);
      const el = info.slides[0].elements[0]!;
      expect(el.type).toBe('shape');
      expect(el.text).toBe('Inside Shape');
      expect(el.fill).toBe('#FF8800');
      expect(el.rotation).toBe(90);
      expect(el.shapeVisual?.shapeKind).toBe('roundRect');
      expect(el.shapeVisual?.border).toMatchObject({
        paint: { type: 'solid', color: '#003366' },
        dash: 'solid',
      });
      expect(el.shapeVisual?.border?.width).toBeCloseTo(1, 3);
      expect(el.shapeVisual?.cornerRadius).toBeGreaterThan(0);
      expect(el.shapeVisual?.shadow?.color).toBe('#000000');
      expect(el.shapeVisual?.shadow?.opacity).toBeCloseTo(0.4, 3);
    });

    it('treats prstGeom="rect" with solidFill as shape, not textbox', async () => {
      const zip = buildSpTreeWithCustomSp(`
        <p:sp>
          <p:nvSpPr><p:cNvPr id="3" name="Filled Rect"/><p:cNvSpPr/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"/>
            <a:solidFill><a:srgbClr val="00AAFF"/></a:solidFill>
          </p:spPr>
        </p:sp>`);
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      const info = await reader.parse(buffer);
      const el = info.slides[0].elements[0]!;
      expect(el.type).toBe('shape');
      expect(el.fill).toBe('#00AAFF');
      expect(el.shapeVisual?.shapeKind).toBe('rect');
    });
  });

  // ─── 段前 / 段后间距 a:spcPct 解析 ────────────────────────────────────

  describe('paragraph spacing in percent (a:spcPct)', () => {
    it('resolves spcPct based on paragraph max font size', async () => {
      const buffer = await buildSyntheticPptx({
        groupedTextBodyXml: `
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr>
              <a:spcBef><a:spcPct val="50000"/></a:spcBef>
              <a:spcAft><a:spcPct val="100000"/></a:spcAft>
            </a:pPr>
            <a:r><a:rPr sz="2000"/><a:t>20pt text</a:t></a:r>
          </a:p>`,
      });
      const info = await reader.parse(buffer);
      const child = info.slides[0].elements
        .find((e) => e.type === 'group')
        ?.children?.[0];
      expect(child?.paragraphs?.[0]).toMatchObject({
        // 50% × 20pt = 10pt
        spacingBeforePt: 10,
        // 100% × 20pt = 20pt
        spacingAfterPt: 20,
      });
    });
  });

  // ─── round-trip: StructuredCompiler → PptxReader ──────────────────────

  describe('round-trip with StructuredCompiler', () => {
    it('parses a compiler-generated PPTX', async () => {
      const { StructuredCompiler } = await import('../engine/StructuredCompiler.js');
      const compiler = new StructuredCompiler();
      const buffer = await compiler.compileDeck({
        title: 'Round Trip',
        layout: '16x9',
        slides: [
          {
            slideNumber: 1,
            spec: {
              type: 'structured',
              elements: [
                { type: 'title', content: 'Hello World', position: { x: 1, y: 1, w: 8, h: 1 } },
                { type: 'text', content: 'Body text here', position: { x: 1, y: 2.5, w: 8, h: 1 } },
              ],
            },
          },
        ],
      });

      const info = await reader.parse(buffer);
      expect(info.slideCount).toBe(1);
      expect(info.slides[0].elements.length).toBeGreaterThanOrEqual(2);

      // 验证文本内容被正确解析
      const texts = info.slides[0].elements
        .filter((e) => e.type === 'text' && e.text)
        .map((e) => e.text);
      expect(texts).toContain('Hello World');
      expect(texts).toContain('Body text here');
    });
  });
});
