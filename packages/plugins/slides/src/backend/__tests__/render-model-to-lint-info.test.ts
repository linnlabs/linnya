/**
 * renderModelToLintInfo 单元测试
 *
 * 重点验证 P1-B.2 新增的字段透传：fill / textColor / imageFit / imageNaturalAspect
 */
import { describe, expect, it } from 'vitest';
import type { PresentationRenderModel } from '@plugin/slides/shared';
import { renderModelToLintInfo } from '../engine/quality/renderModelToLintInfo.js';

function makeModel(elements: PresentationRenderModel['slides'][number]['elements']): PresentationRenderModel {
  return {
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        index: 0,
        elements,
      },
    ],
  } as PresentationRenderModel;
}

describe('renderModelToLintInfo - color & fit channels', () => {
  it('preserves layer facts used by the shared spatial classifier', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 'i1',
        kind: 'image',
        box: { x: 0, y: 0, w: 10, h: 5.625 },
        assetRef: { type: 'external', url: 'https://example.com/x.png' },
        zIndex: 3,
        opacity: 0.45,
        editableTarget: {
          semanticRole: 'primary-visual',
          operations: [],
        },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements[0]).toMatchObject({
      zIndex: 3,
      opacity: 0.45,
      semanticRole: 'primary-visual',
    });
  });

  it('preserves explicit RenderModel component parent identities', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 'component-1',
        kind: 'group',
        box: { x: 1, y: 1, w: 4, h: 2 },
        children: [
          {
            id: 'component-bg',
            kind: 'shape',
            geometry: { type: 'preset', name: 'rect' },
            box: { x: 1, y: 1, w: 4, h: 2 },
          },
          {
            id: 'component-label',
            kind: 'text',
            box: { x: 1.2, y: 1.2, w: 3, h: 0.5 },
            paragraphs: [{ runs: [{ text: 'Label' }] }],
          },
        ],
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements).toEqual([
      expect.objectContaining({ nodeId: 'component-1', parentNodeId: undefined }),
      expect.objectContaining({ nodeId: 'component-bg', parentNodeId: 'component-1' }),
      expect.objectContaining({ nodeId: 'component-label', parentNodeId: 'component-1' }),
    ]);
  });

  it('extracts solid fill color from shape nodes', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 's1',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0, y: 0, w: 5, h: 3 },
        fill: { type: 'solid', color: '#1F4F8A' },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.fill).toBe('#1F4F8A');
  });

  it('does not extract fill for gradient shapes', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 's1',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0, y: 0, w: 5, h: 3 },
        fill: { type: 'gradient', gradient: {} as never } as never,
      },
    ] as unknown as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.fill).toBeUndefined();
  });

  it('does not extract fill for none-fill shapes', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 's1',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0, y: 0, w: 5, h: 3 },
        fill: { type: 'none' },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements[0].fill).toBeUndefined();
  });

  it('extracts text color from first run that has color', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 't1',
        kind: 'text',
        box: { x: 0, y: 0, w: 5, h: 1 },
        paragraphs: [{
          runs: [
            { text: 'Hello', color: '#1A1A1A' },
            { text: ' World', color: '#FF0000' },
          ],
        }],
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements[0].textColor).toBe('#1A1A1A');
  });

  it('preserves resolved font facts for every text run', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 't1',
        kind: 'text',
        box: { x: 0, y: 0, w: 5, h: 1 },
        paragraphs: [{
          runs: [
            {
              text: 'Latin',
              fontFamily: 'Missing Latin',
              resolvedFontFamily: 'Aptos',
              fontScript: 'latin',
              fontResolution: 'substituted',
            },
            {
              text: '中文',
              fontFamily: 'Missing CJK',
              resolvedFontFamily: 'PingFang SC',
              fontScript: 'eastAsian',
              fontResolution: 'substituted',
            },
          ],
        }],
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements[0].paragraphs?.[0]?.runs).toEqual([
      expect.objectContaining({
        resolvedFontFamily: 'Aptos',
        fontScript: 'latin',
        fontResolution: 'substituted',
      }),
      expect.objectContaining({
        resolvedFontFamily: 'PingFang SC',
        fontScript: 'eastAsian',
        fontResolution: 'substituted',
      }),
    ]);
  });

  it('falls back to second run when first run has no color', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 't1',
        kind: 'text',
        box: { x: 0, y: 0, w: 5, h: 1 },
        paragraphs: [{
          runs: [
            { text: 'Hello' },
            { text: ' World', color: '#FF0000' },
          ],
        }],
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    expect(info.slides[0].elements[0].textColor).toBe('#FF0000');
  });

  it('extracts text color from shape inner text', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 's1',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0, y: 0, w: 5, h: 3 },
        fill: { type: 'solid', color: '#FFFFFF' },
        innerText: {
          id: 'inner',
          kind: 'text',
          box: { x: 0, y: 0, w: 5, h: 3 },
          paragraphs: [{ runs: [{ text: 'Card', color: '#0F0F0F' }] }],
        },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.fill).toBe('#FFFFFF');
    expect(el.textColor).toBe('#0F0F0F');
  });

  it('extracts imageFit and imageNaturalAspect from image nodes', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 'i1',
        kind: 'image',
        box: { x: 0, y: 0, w: 4, h: 3 },
        assetRef: { type: 'external', url: 'https://example.com/x.png' },
        fitMode: 'cover',
        naturalSize: { width: 800, height: 600 },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.imageFit).toBe('cover');
    expect(el.imageNaturalAspect).toBeCloseTo(800 / 600, 5);
  });

  it('omits imageNaturalAspect when naturalSize has zero dimensions', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 'i1',
        kind: 'image',
        box: { x: 0, y: 0, w: 4, h: 3 },
        assetRef: { type: 'external', url: 'https://example.com/x.png' },
        fitMode: 'stretch',
        naturalSize: { width: 0, height: 600 },
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.imageFit).toBe('stretch');
    expect(el.imageNaturalAspect).toBeUndefined();
  });

  it('omits color/fit fields when source data is absent', () => {
    const info = renderModelToLintInfo(makeModel([
      {
        id: 't1',
        kind: 'text',
        box: { x: 0, y: 0, w: 5, h: 1 },
        paragraphs: [{ runs: [{ text: 'plain' }] }],
      },
    ] as PresentationRenderModel['slides'][number]['elements']));

    const el = info.slides[0].elements[0];
    expect(el.fill).toBeUndefined();
    expect(el.textColor).toBeUndefined();
    expect(el.imageFit).toBeUndefined();
    expect(el.imageNaturalAspect).toBeUndefined();
  });

  it('projects final chart label facts without copying series values', () => {
    const info = renderModelToLintInfo(makeModel([{
      id: 'chart-1',
      kind: 'chart',
      chartType: 'doughnut',
      box: { x: 1, y: 1, w: 4, h: 3 },
      categories: ['执行器', '减速器', '传感器'],
      series: [{ name: 'BOM', values: [40, 35, 25] }],
      palette: ['#1F4F8A'],
      legend: { visible: false },
      dataLabels: {
        visible: true,
        position: 'outside',
        labelStyle: { fontSize: 9 },
      },
      labelStyle: { fontSize: 8 },
    }]));

    expect(info.slides[0].elements[0]).toMatchObject({
      chartType: 'doughnut',
      chartInfo: {
        chartType: 'doughnut',
        categoryLabels: ['执行器', '减速器', '传感器'],
        seriesNames: ['BOM'],
        legend: { visible: false, position: 'right', fontSizePt: 8 },
        dataLabels: {
          visible: true,
          position: 'outside',
          fontSizePt: 9,
          includesCategoryName: true,
        },
        categoryAxis: { visible: false, fontSizePt: 8 },
      },
    });
    expect(info.slides[0].elements[0].chartInfo).not.toHaveProperty('seriesValues');
  });

  it('projects table-cell text layout as narrow table facts instead of synthetic nodes', () => {
    const textLayout = {
      lines: [],
      contentHeightInches: 0.3,
      appliedFontScale: 1,
      appliedLineSpacingReduction: 0,
      advanceSource: 'harfbuzz' as const,
      overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
    };
    const info = renderModelToLintInfo(makeModel([{
      id: 'table-1',
      kind: 'table',
      box: { x: 1, y: 2, w: 4, h: 1 },
      columns: [1.5, 2.5],
      rows: [1],
      cells: [{
        row: 0,
        col: 1,
        paragraphs: [{ runs: [{ text: '共同发现', fontSize: 8 }] }],
        padding: { top: 0.05, right: 0.2, bottom: 0.05, left: 0.15 },
        textLayout,
      }],
    }]));

    expect(info.slides[0].elements).toHaveLength(1);
    expect(info.slides[0].elements[0].tableInfo?.cells[0]).toEqual({
      rowIndex: 0,
      columnIndex: 1,
      position: { x: 2.5, y: 2, w: 2.5, h: 1 },
      text: '共同发现',
      paragraphs: [expect.objectContaining({ runs: [expect.objectContaining({ text: '共同发现' })] })],
      padding: { top: 0.05, right: 0.2, bottom: 0.05, left: 0.15 },
      textLayout,
    });
  });
});
