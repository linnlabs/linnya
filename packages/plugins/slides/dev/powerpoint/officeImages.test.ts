import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { compareRegionImages } from './compareImages';
import type { Region } from './definitions';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}.png`, import.meta.url));
const chart: Region = {
  id: 'chart',
  kind: 'chart',
  box: { x: 0, y: 0, w: 864, h: 432 },
  probe: { x: 0, y: 0, w: 864, h: 432 },
};

describe('real synthetic PowerPoint image regressions', () => {
  for (const name of ['office-gap50', 'office-gap300']) {
    it(`${name}: separates plot bars from legend and axis antialiasing`, async () => {
      const result = await compareRegionImages(
        await fixture(`${name}-preview`),
        await fixture(`${name}-office`),
        chart
      );
      expect(result.preview.chart?.bars.map(bars => bars.length)).toEqual([3, 3, 3]);
      expect(result.office.chart?.bars.map(bars => bars.length)).toEqual([3, 3, 3]);
      expect(result.differences).not.toContain('bar-width');
      expect(result.differences).not.toContain('bar-geometry');
      expect(result.differences).not.toContain('plot-area');
      expect(result.preview.chart?.plot).toEqual({ x: 59, y: 9, w: 796, h: 353 });
      expect(result.office.chart?.plot).toEqual({ x: 59, y: 10, w: 797, h: 353 });
      expect(result.preview.chart?.legend).toEqual([
        { x: 315, y: 408, w: 14, h: 10 },
        { x: 386, y: 408, w: 13, h: 10 },
        { x: 459, y: 408, w: 13, h: 10 },
      ]);
      expect(result.office.chart?.legend).toEqual([
        { x: 338, y: 409, w: 8, h: 7 },
        { x: 411, y: 409, w: 7, h: 7 },
        { x: 486, y: 409, w: 7, h: 7 },
      ]);
      expect(result.preview.chart?.legendText).toEqual({ x: 335, y: 405, w: 179, h: 12 });
      expect(result.office.chart?.legendText).toEqual({ x: 351, y: 406, w: 182, h: 12 });
      // 色块大小和位置确有不同；不能因柱子的误报修复而吞掉图例差异。
      expect(result.differences).toContain('legend');
    });
  }

  it('resolves three tight shrink-text lines instead of joining across blank pixel rows', async () => {
    const region: Region = {
      id: 'shrink',
      kind: 'text',
      box: { x: 0, y: 0, w: 269, h: 70 },
      probe: { x: 0, y: 0, w: 269, h: 70 },
      previewLines: [
        'Shrink this synthetic shape text',
        'Second line with more words',
        'Third line 中文缩字',
      ],
    };
    const result = await compareRegionImages(
      await fixture('office-shrink-preview'),
      await fixture('office-shrink-office'),
      region
    );
    expect(result.preview.text?.bands).toHaveLength(3);
    expect(result.office.text?.bands).toHaveLength(3);
    expect(result.differences).not.toContain('line-count');
    expect(result.differences).not.toContain('line-break');
  });

  it('retains real text displacement and multiple line-spacing differences', async () => {
    const boundary: Region = {
      id: 'boundary',
      kind: 'text',
      box: { x: 18, y: 66, w: 292.8, h: 169.6 },
      probe: { x: 0, y: 0, w: 329, h: 260 },
      previewLines: [
        'Boundary words ',
        'wrap near the right ',
        'edge. 中文边界，',
        '标点与 mixed ',
        'words。',
      ],
    };
    const shifted = await compareRegionImages(
      await fixture('office-boundary-preview'),
      await fixture('office-boundary-office'),
      boundary
    );
    expect(shifted.differences).toEqual(expect.arrayContaining(['text-position', 'overflow']));
    expect(shifted.indeterminate).toContain('line-segmentation');
    const spacing: Region = {
      id: 'multiple',
      kind: 'text',
      box: { x: 0, y: 0, w: 288, h: 192 },
      probe: { x: 0, y: 0, w: 288, h: 192 },
      previewLines: ['Multiple spacing', 'Second line', 'Third line'],
    };
    const result = await compareRegionImages(
      await fixture('office-spacing-preview'),
      await fixture('office-spacing-office'),
      spacing
    );
    expect(result.differences).toContain('line-spacing');
    expect(result.preview.text?.bands.map(band => band.start)).toEqual([13, 58, 103]);
    expect(result.office.text?.bands.map(band => band.start)).toEqual([36, 90, 144]);
  });

  it('joins detached vertical punctuation to its nearest column without joining two full columns', async () => {
    const region: Region = {
      id: 'vertical',
      kind: 'vertical',
      box: { x: 0, y: 0, w: 100, h: 330 },
      probe: { x: 0, y: 0, w: 100, h: 330 },
      previewLines: ['春风徐来，清水长流。', '纵向文字 ABC 123。'],
    };
    const result = await compareRegionImages(
      await fixture('office-vertical-preview'),
      await fixture('office-vertical-office'),
      region
    );
    expect(result.preview.text?.bands).toHaveLength(2);
    expect(result.office.text?.bands).toHaveLength(2);
    expect(result.differences).not.toContain('line-count');
  });
});

describe('fixed image comparison boundaries', () => {
  it('measures horizontal bar thickness on the vertical axis', async () => {
    const region: Region = {
      id: 'horizontal',
      kind: 'chart',
      box: { x: 0, y: 0, w: 210, h: 150 },
      probe: { x: 0, y: 0, w: 210, h: 150 },
      chart: { type: 'bar', legendPosition: 'top' },
    };
    const changed = await compareRegionImages(
      await fixture('chart-horizontal'),
      await fixture('chart-horizontal-drift'),
      region
    );
    expect(changed.differences).toEqual(expect.arrayContaining(['bar-width', 'bar-geometry']));
    expect(changed.preview.chart?.bars[0][0].w).toBe(changed.office.chart?.bars[0][0].w);
    expect(changed.preview.chart?.bars[0][0].h).not.toBe(changed.office.chart?.bars[0][0].h);
  });

  it('detects changed legend text bounds even when markers and bars are identical', async () => {
    const region: Region = {
      id: 'legend-text',
      kind: 'chart',
      box: { x: 0, y: 0, w: 210, h: 150 },
      probe: { x: 0, y: 0, w: 210, h: 150 },
      chart: { type: 'column', legendPosition: 'top' },
    };
    const result = await compareRegionImages(
      await fixture('chart-top'),
      await fixture('chart-top-text-drift'),
      region
    );
    expect(result.preview.chart?.legend).toEqual(result.office.chart?.legend);
    expect(result.differences).toEqual(['legend']);
  });

  for (const type of ['line', 'doughnut'] as const) {
    it(`measures ${type} series geometry without interpreting it as bars`, async () => {
      const region: Region = {
        id: type,
        kind: 'chart',
        box: { x: 0, y: 0, w: 210, h: 150 },
        probe: { x: 0, y: 0, w: 210, h: 150 },
        chart: { type, legendPosition: 'top' },
      };
      const base = await fixture(`chart-${type}`);
      const identical = await compareRegionImages(base, base, region);
      expect(identical.differences).toEqual([]);
      expect(identical.preview.chart?.bars).toEqual([]);
      expect(identical.preview.chart?.series.every(series => series.length > 0)).toBe(true);
      const changed = await compareRegionImages(base, await fixture(`chart-${type}-drift`), region);
      expect(changed.differences).toContain('series-geometry');
      expect(changed.differences).not.toContain('bar-width');
    });
  }
  for (const position of ['top', 'right'] as const) {
    it(`measures ${position} legend markers and labels independently from bars`, async () => {
      const png = await fixture(`chart-${position}`);
      const region: Region = {
        id: position,
        kind: 'chart',
        box: { x: 0, y: 0, w: 210, h: 150 },
        probe: { x: 0, y: 0, w: 210, h: 150 },
        chart: { type: 'column', legendPosition: position },
      };
      const result = await compareRegionImages(png, png, region);
      expect(result.preview.chart?.legend).toHaveLength(3);
      expect(result.preview.chart?.legendText).not.toBeNull();
      expect(result.preview.chart?.bars.map(bars => bars.length)).toEqual([1, 1, 1]);
      expect(result.differences).toEqual([]);
    });
  }

  it('reports unresolved merged ink as indeterminate instead of a false wrap difference', async () => {
    const region: Region = {
      id: 'merged',
      kind: 'text',
      box: { x: 10, y: 10, w: 180, h: 70 },
      probe: { x: 0, y: 0, w: 210, h: 100 },
      previewLines: ['one', 'two', 'three'],
    };
    // 固定图只有两条连通墨迹带，不能强行按三行作者事实切开。
    const result = await compareRegionImages(
      await fixture('text'),
      await fixture('text-wrap'),
      region
    );
    expect(result.indeterminate).toContain('line-segmentation');
    expect(result.differences).not.toContain('line-count');
    expect(result.differences).not.toContain('line-break');
  });
});
