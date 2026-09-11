import { describe, expect, it } from 'vitest';
import {
  buildDeckSpecFromDirectInput,
  readDirectComposeInput,
} from '@plugin/slides/backend-codegen';

describe('presentationComposeInput', () => {
  it('normalizes a custom document-level canvas before building DeckSpec', () => {
    const parsed = readDirectComposeInput({
      title: 'Vertical Deck',
      layout: { width: 5.625, height: 10, unit: 'in' },
      slides: [{ elements: [] }],
    });

    expect(parsed).toMatchObject({
      input: {
        layout: { width: 5.625, height: 10, unit: 'in' },
      },
    });
    expect(buildDeckSpecFromDirectInput(parsed.input!).layout).toEqual({
      width: 5.625,
      height: 10,
      unit: 'in',
    });
  });

  it('rejects invalid custom canvas dimensions at compose admission', () => {
    expect(readDirectComposeInput({
      title: 'Broken Canvas',
      layout: { width: 0, height: 10, unit: 'in' },
      slides: [{ elements: [] }],
    }).error).toContain('layout.width');
  });

  it('parses direct compose theme/chart/table input through shared parsers', () => {
    const parsed = readDirectComposeInput({
      title: 'Direct Compose Deck',
      theme: {
        colors: { accent1: '#112233' },
        fonts: { major: 'Aptos Display', minor: 'Aptos' },
        chart: { palette: ['#112233', '#445566'] },
        logo: 'https://example.com/logo.png',
      },
      slides: [
        {
          elements: [
            {
              type: 'chart',
              position: { x: 0.5, y: 0.8, w: 4.2, h: 2.4 },
              chartType: 'bar',
              categories: ['Q1', 'Q2'],
              series: [
                {
                  name: 'Revenue',
                  labels: ['Q1', 'Q2'],
                  values: [12, 18],
                },
              ],
            },
            {
              type: 'table',
              position: { x: 5.1, y: 0.8, w: 4.2, h: 2.4 },
              headers: ['Region', 'Growth'],
              rows: [
                ['China', '18%'],
                [{ text: 'US', fill: '#F5F5F5' }, { text: '12%' }],
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBeUndefined();
    if (!parsed.input) {
      throw new Error('expected direct compose input to be parsed');
    }

    expect(parsed.input.theme).toEqual({
      colors: { accent1: '#112233' },
      fonts: { major: 'Aptos Display', minor: 'Aptos' },
      chart: { palette: ['#112233', '#445566'] },
      logo: 'https://example.com/logo.png',
    });

    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    expect(deckSpec.slides).toHaveLength(1);
    expect(deckSpec.slides[0]?.spec.type).toBe('structured');
    if (deckSpec.slides[0]?.spec.type !== 'structured') {
      throw new Error('expected structured slide spec');
    }

    expect(deckSpec.slides[0].spec.elements[0]).toMatchObject({
      type: 'chart',
      data: {
        categories: ['Q1', 'Q2'],
        series: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }],
      },
    });
    expect(deckSpec.slides[0].spec.elements[1]).toMatchObject({
      type: 'table',
      headers: ['Region', 'Growth'],
      rows: [
        [{ text: 'China' }, { text: '18%' }],
        [{ text: 'US', fill: '#F5F5F5' }, { text: '12%' }],
      ],
    });
  });

  it('keeps chartStyle and table border as canonical cross-renderer semantics', () => {
    const parsed = readDirectComposeInput({
      title: 'Visual Style Contract',
      slides: [{
        elements: [
          {
            type: 'chart',
            position: { x: 0, y: 0, w: 5, h: 3 },
            chartType: 'line',
            categories: ['A', 'B'],
            series: [{ name: 'S', values: [1, 2] }],
            chartStyle: {
              axisLabelColor: '#475569',
              dataLabelColor: '#0F172A',
              gridlineColor: '#CBD5E1',
            },
          },
          {
            type: 'table',
            position: { x: 5, y: 0, w: 5, h: 3 },
            rows: [['A']],
            border: { color: '#94A3B8', width: 0.75 },
          },
        ],
      }],
    });

    expect(parsed.error).toBeUndefined();
    if (!parsed.input) throw new Error('expected direct compose input');
    const deck = buildDeckSpecFromDirectInput(parsed.input);
    const slide = deck.slides[0]?.spec;
    if (slide?.type !== 'structured') throw new Error('expected structured slide');
    expect(slide.elements[0]).toMatchObject({
      chartStyle: {
        axisLabelColor: '#475569',
        dataLabelColor: '#0F172A',
        gridlineColor: '#CBD5E1',
      },
    });
    expect(slide.elements[1]).toMatchObject({
      border: { width: 0.75, paint: { type: 'solid', color: '#94A3B8' } },
    });
  });

  it('rejects fields outside the public chart and table style contracts', () => {
    const chart = readDirectComposeInput({
      title: 'Broken Chart Style',
      slides: [{ elements: [{
        type: 'chart',
        position: { x: 0, y: 0, w: 5, h: 3 },
        categories: ['A'],
        series: [{ name: 'S', values: [1] }],
        chartStyle: { axisLabelColor: '#475569', axisLabelFontSize: 10 },
      }] }],
    });
    expect(chart.error).toContain('chartStyle');
    expect(chart.error).toContain('axisLabelFontSize');

    const table = readDirectComposeInput({
      title: 'Broken Table Border',
      slides: [{ elements: [{
        type: 'table',
        position: { x: 0, y: 0, w: 5, h: 3 },
        rows: [['A']],
        border: { color: '#94A3B8', width: 0.75, dash: 'dash' },
      }] }],
    });
    expect(table.error).toContain('{ color, width }');
  });

  it('rejects invalid chart series instead of filtering malformed entries', () => {
    const parsed = readDirectComposeInput({
      title: 'Broken Chart',
      slides: [
        {
          elements: [
            {
              type: 'chart',
              position: { x: 0.5, y: 0.8, w: 4.2, h: 2.4 },
              chartType: 'bar',
              categories: ['Q1', 'Q2'],
              series: [
                {
                  name: 'Revenue',
                  labels: ['Q1', { quarter: 2 }],
                  values: [12, 18],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBe(
      'slides[0].elements[0]: 图表数据的 series/datasets 必须是非空数组；每项需包含 name 和 values（也兼容 data）数字数组。',
    );
  });

  it('rejects invalid table rows instead of silently skipping malformed cells', () => {
    const parsed = readDirectComposeInput({
      title: 'Broken Table',
      slides: [
        {
          elements: [
            {
              type: 'table',
              position: { x: 0.5, y: 0.8, w: 4.2, h: 2.4 },
              rows: [
                ['ok'],
                [{ text: '' }],
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBe(
      'slides[0].elements[0]: 表格数据的 rows/body/data 必须是合法二维数组；单元格支持字符串、数字、布尔或 { text/content/value }。',
    );
  });

  it('parses image source contract and visual options into deck spec', () => {
    const parsed = readDirectComposeInput({
      title: 'Image Contract',
      slides: [
        {
          elements: [
            {
              type: 'image',
              position: { x: 0.8, y: 1.1, w: 3.6, h: 2.4 },
              src: { kind: 'external_url', url: 'https://example.com/hero.png' },
              alt: 'Hero',
              fitMode: 'cover',
              rounding: true,
              transparency: 0.2,
              rotate: 8,
              flipH: true,
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBeUndefined();
    if (!parsed.input) {
      throw new Error('expected direct compose input to be parsed');
    }

    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    const slide = deckSpec.slides[0]?.spec;
    expect(slide?.type).toBe('freeform');
    if (slide?.type !== 'freeform') {
      throw new Error('expected freeform slide spec');
    }

    expect(slide.elements[0]).toMatchObject({
      type: 'image',
      src: { kind: 'external_url', url: 'https://example.com/hero.png' },
      alt: 'Hero',
      fitMode: 'cover',
      rounding: true,
      transparency: 0.2,
      rotate: 8,
      flipH: true,
    });
  });

  it('parses background image source contract without collapsing it to a string', () => {
    const parsed = readDirectComposeInput({
      title: 'Background Image Contract',
      slides: [
        {
          background: {
            color: '#101820',
            image: { kind: 'external_url', url: 'https://example.com/background.png' },
          },
          elements: [
            {
              type: 'text',
              position: { x: 1, y: 1, w: 4, h: 1 },
              content: 'Headline',
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBeUndefined();
    if (!parsed.input) {
      throw new Error('expected direct compose input to be parsed');
    }

    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    expect(deckSpec.slides[0]?.spec.background).toEqual({
      image: { kind: 'external_url', url: 'https://example.com/background.png' },
    });
  });

  it('parses background gradient as structured intent', () => {
    const parsed = readDirectComposeInput({
      title: 'Gradient Background',
      slides: [
        {
          background: {
            color: '#101820',
            gradient: {
              type: 'linear',
              angle: 135,
              stops: [
                { color: '#101820', position: 0 },
                { color: '#237A78', position: 0.5, opacity: 0.6 },
                { color: '#2A9D8F', position: 1 },
              ],
            },
          },
          elements: [
            {
              type: 'text',
              position: { x: 1, y: 1, w: 4, h: 1 },
              content: 'Gradient',
            },
          ],
        },
      ],
    });

    expect(parsed.error).toBeUndefined();
    if (!parsed.input) {
      throw new Error('expected direct compose input to be parsed');
    }
    const deckSpec = buildDeckSpecFromDirectInput(parsed.input);
    expect(deckSpec.slides[0]?.spec.background?.paint).toEqual({
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#101820', position: 0 },
        { color: '#237A78', position: 0.5, opacity: 0.6 },
        { color: '#2A9D8F', position: 1 },
      ],
      rotateWithShape: true,
    });
  });

  it('rejects invalid background gradient stops', () => {
    const parsed = readDirectComposeInput({
      title: 'Broken Gradient Background',
      slides: [
        {
          background: {
            gradient: {
              type: 'linear',
              angle: 135,
              stops: [
                { color: '#101820', position: 0 },
                { color: '#2A9D8F', position: 2 },
              ],
            },
          },
          elements: [],
        },
      ],
    });

    expect(parsed.error).toBe(
      'slides[0].background: background.gradient.stops[1].position 必须是 0 到 1 之间的有限数字。',
    );
  });
});
