import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compareRegionImages } from './compareImages';
import type { Region } from './definitions';
const fixture = (name: string) =>
  readFile(fileURLToPath(new URL(`./fixtures/${name}.png`, import.meta.url)));
const text: Region = {
  id: 'text',
  kind: 'text',
  box: { x: 10, y: 10, w: 180, h: 70 },
  probe: { x: 0, y: 0, w: 210, h: 100 },
};

describe('PowerPoint image conformance', () => {
  it('accepts identical fixed text images and records two visible lines', async () => {
    const png = await fixture('text');
    const result = await compareRegionImages(png, png, text);
    expect(result.differences).toEqual([]);
    expect(result.preview.text?.bands).toHaveLength(2);
  });
  it('detects extra wrapping, changed break length, spacing and overflow from fixed images', async () => {
    const base = await fixture('text');
    for (const [name, issue] of [
      ['text-wrap', 'line-count'],
      ['text-break', 'line-extent'],
      ['text-spacing', 'line-spacing'],
      ['text-overflow', 'overflow'],
    ] as const) {
      const result = await compareRegionImages(base, await fixture(name), text);
      expect(result.differences, name).toContain(issue);
    }
  });
  it('detects vertical column changes without treating glyph rows as text lines', async () => {
    const region: Region = { ...text, kind: 'vertical' };
    const result = await compareRegionImages(
      await fixture('vertical'),
      await fixture('vertical-wrap'),
      region
    );
    expect(result.preview.text?.bands).toHaveLength(2);
    expect(result.differences).toContain('line-count');
  });
  it('detects plot, bar width and legend differences, and rejects blank references', async () => {
    const region: Region = {
      id: 'chart',
      kind: 'chart',
      box: { x: 0, y: 0, w: 210, h: 100 },
      probe: { x: 0, y: 0, w: 210, h: 100 },
    };
    const base = await fixture('chart');
    expect((await compareRegionImages(base, base, region)).differences).toEqual([]);
    const changed = await compareRegionImages(base, await fixture('chart-drift'), region);
    expect(changed.differences).toEqual(
      expect.arrayContaining(['plot-area', 'bar-width', 'legend'])
    );
    expect(
      (await compareRegionImages(await fixture('blank'), await fixture('blank'), region))
        .differences
    ).toContain('missing-chart');
  });
  it('fails on missing text and mismatched page dimensions instead of resizing silently', async () => {
    const blank = await fixture('blank');
    expect((await compareRegionImages(blank, blank, text)).differences).toContain('missing-text');
    await expect(
      compareRegionImages(await fixture('text'), await fixture('wrong-size'), text)
    ).rejects.toThrow('dimensions');
  });
});
