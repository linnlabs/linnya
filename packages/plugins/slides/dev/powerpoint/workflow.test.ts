import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { createConformanceDeck } from './samples';
import { DeckAssembler } from '../../src/backend/engine/DeckAssembler';
import { FreeformCompiler } from '../../src/backend/engine/FreeformCompiler';
import { StructuredCompiler } from '../../src/backend/engine/StructuredCompiler';
import { compareConformance } from './compareReport';
import type { Manifest } from './definitions';
import { getElementByTag, getElements } from '../../src/backend/engine/parser/xml/XmlNode';

it('compiles eleven synthetic pages including line, horizontal bar, doughnut and three legend positions', async () => {
  const deck = createConformanceDeck();
  const zip = await JSZip.loadAsync(
    await new DeckAssembler(new StructuredCompiler(), new FreeformCompiler()).assemble(deck)
  );
  expect(
    Object.keys(zip.files).filter(file => /^ppt\/slides\/slide\d+\.xml$/.test(file))
  ).toHaveLength(11);
  expect(await zip.file('ppt/slides/slide2.xml')!.async('text')).toMatch(
    /normAutofit fontScale="\d+" lnSpcReduction="\d+"/
  );
  expect(await zip.file('ppt/slides/slide3.xml')!.async('text')).toContain('vert="eaVert"');
  const spacing = await zip.file('ppt/slides/slide4.xml')!.async('text');
  expect(spacing).toContain('spcPct val="140000"');
  expect(spacing).toContain('spcPts val="3200"');
  // 预览缺省 top；PowerPoint 的文本框锚点必须一致，否则框高与内容不同时纵向错位。
  const bodyAnchors = (xml: string) =>
    getElements(new DOMParser().parseFromString(xml, 'application/xml'), 'a:bodyPr').map(body =>
      body.getAttribute('anchor')
    );
  expect(bodyAnchors(await zip.file('ppt/slides/slide1.xml')!.async('text'))).toEqual(['t']);
  expect(bodyAnchors(spacing)).toEqual(['t', 't']);
  const charts = await Promise.all(
    Object.keys(zip.files)
      .filter(file => /^ppt\/charts\/chart\d+\.xml$/.test(file))
      .map(file => zip.file(file)!.async('text'))
  );
  expect(charts).toHaveLength(7);
  expect(charts[0]).toContain('<c:gapWidth val="50"/>');
  expect(charts[0]).toContain('<c:overlap val="0"/>');
  expect(charts[1]).toContain('<c:gapWidth val="300"/>');
  expect(charts[1]).toContain('<c:overlap val="50"/>');
  expect(charts[2]).toContain('<c:lineChart>');
  expect(charts[3]).toContain('<c:barDir val="bar"/>');
  const horizontal = new DOMParser().parseFromString(charts[3], 'application/xml');
  const categoryAxis = getElementByTag(horizontal, 'c:catAx');
  const valueAxis = getElementByTag(horizontal, 'c:valAx');
  if (!categoryAxis || !valueAxis) throw new Error('Expected horizontal sample axes');
  expect(getElementByTag(categoryAxis, 'c:orientation')?.getAttribute('val')).toBe('maxMin');
  expect(getElementByTag(valueAxis, 'c:crosses')?.getAttribute('val')).toBe('max');
  expect(charts[4]).toContain('<c:doughnutChart>');
  expect(charts[4]).toContain('<c:showPercent val="1"/>');
  for (const color of ['2468C4', 'D85C28', '33854B']) expect(charts[4]).toContain(color);
  expect(charts[5]).toContain('<c:legendPos val="r"/>');
  expect(charts[6]).toContain('<c:legendPos val="t"/>');
});

describe('independent comparison report', () => {
  it('writes review evidence, detects a visible regression, missing pages and stale Office output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'slides-conformance-test-'));
    try {
      await mkdir(path.join(root, 'preview'));
      await mkdir(path.join(root, 'office'));
      const pptx = Buffer.from('synthetic test identity');
      const hash = createHash('sha256').update(pptx).digest('hex');
      const manifest: Manifest = {
        version: 1,
        width: 210,
        height: 100,
        deckSha256: hash,
        font: 'test',
        platform: 'fixture',
        pages: [
          {
            id: 'synthetic-text',
            regions: [
              {
                id: 'text',
                kind: 'text',
                box: { x: 10, y: 10, w: 180, h: 70 },
                probe: { x: 0, y: 0, w: 210, h: 100 },
                previewLines: ['Synthetic line one', 'Synthetic line two'],
              },
            ],
          },
        ],
      };
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(path.join(root, 'sample.pptx'), pptx);
      await writeFile(
        path.join(root, 'office/export.json'),
        JSON.stringify({
          deckSha256: hash,
          method: 'powerpoint-macos-pdf',
          version: 'fixture',
          status: 'complete',
        })
      );
      const base = await readFile(new URL('./fixtures/text.png', import.meta.url));
      await writeFile(path.join(root, 'preview/slide-001.png'), base);
      await writeFile(path.join(root, 'office/slide-001.png'), base);
      expect((await compareConformance(root)).status).toBe('review');
      expect(await readFile(path.join(root, 'report.html'), 'utf8')).toContain('等待人工确认');
      manifest.pages[0].regions[0].previewLines = ['one', 'two', 'three'];
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
      const indeterminate = await compareConformance(root);
      expect(indeterminate.status).toBe('review');
      expect(indeterminate.pages[0].regions[0].result.indeterminate).toContain('line-segmentation');
      expect(await readFile(path.join(root, 'report.html'), 'utf8')).toContain('不可判定');
      manifest.pages[0].regions[0].previewLines = ['Synthetic line one', 'Synthetic line two'];
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(
        path.join(root, 'office/slide-001.png'),
        await readFile(new URL('./fixtures/text-wrap.png', import.meta.url))
      );
      expect((await compareConformance(root)).status).toBe('difference');
      await rm(path.join(root, 'office/slide-001.png'));
      const missing = await compareConformance(root);
      expect(missing.status).toBe('incomplete');
      expect(missing.errors.join()).toContain('slide-001.png');
      await writeFile(path.join(root, 'office/slide-001.png'), base);
      await writeFile(path.join(root, 'sample.pptx'), 'changed');
      expect((await compareConformance(root)).errors.join()).toContain('hash differs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
