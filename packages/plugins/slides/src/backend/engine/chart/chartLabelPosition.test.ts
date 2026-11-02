import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { DeckSpec, StructuredElement } from '@plugin/slides/shared';
import { validateChartSemantics } from '../../codegen/compose/inputParsers/chartParsers';
import { DeckAssembler } from '../DeckAssembler';
import { FreeformCompiler } from '../FreeformCompiler';
import { StructuredCompiler } from '../StructuredCompiler';

type Chart = Extract<StructuredElement, { type: 'chart' }>;

const chart = (overrides: Partial<Chart>): Chart => ({
  type: 'chart',
  chartType: 'bar',
  position: { x: 0.5, y: 0.5, w: 9, h: 4.5 },
  data: {
    categories: ['A', 'B'],
    series: [{ name: 'S', labels: ['A', 'B'], values: [1, 2] }],
  },
  options: { showValue: true },
  ...overrides,
});

const positions = async (element: Chart): Promise<string[]> => {
  const deck: DeckSpec = {
    title: 'labels',
    slides: [{ slideNumber: 1, spec: { type: 'structured', elements: [element] } }],
  };
  const assembler = new DeckAssembler(new StructuredCompiler(), new FreeformCompiler());
  const zip = await JSZip.loadAsync(await assembler.assemble(deck));
  const path = Object.keys(zip.files).find(p => /^ppt\/charts\/chart\d*\.xml$/.test(p));
  const xml = await zip.file(path ?? '')?.async('text');
  return [...(xml ?? '').matchAll(/<c:dLblPos val="([^"]*)"/g)].map(m => m[1]);
};

describe('PowerPoint data label positions', () => {
  it.each(['center', 'inside', 'outside'] as const)('omits dLblPos on doughnut charts for %s', async (dataLabelPosition) => {
    expect(await positions(chart({ chartType: 'doughnut', dataLabelPosition }))).toEqual([]);
  });

  it('omits dLblPos on area charts', async () => {
    expect(await positions(chart({ chartType: 'area', dataLabelPosition: 'inside' }))).toEqual([]);
  });

  it('never writes outEnd on stacked bars', async () => {
    const found = await positions(chart({ stacking: 'stacked', dataLabelPosition: 'outside' }));
    expect(found.length).toBeGreaterThan(0);
    expect(found).not.toContain('outEnd');
  });

  it('keeps positions PowerPoint accepts', async () => {
    expect(await positions(chart({ dataLabelPosition: 'outside' }))).toContain('outEnd');
    expect(await positions(chart({ chartType: 'pie', dataLabelPosition: 'center' }))).toContain('ctr');
    expect(await positions(chart({ chartType: 'line', dataLabelPosition: 'outside' }))).toContain('t');
  });

  it('rejects positions the export cannot honour', () => {
    expect(() => validateChartSemantics(chart({ chartType: 'doughnut', dataLabelPosition: 'outside' }))).toThrow('环图');
    expect(() => validateChartSemantics(chart({ stacking: 'stacked', dataLabelPosition: 'outside' }))).toThrow('堆叠柱');
    expect(() => validateChartSemantics(chart({ chartType: 'doughnut', dataLabelPosition: 'center' }))).not.toThrow();
  });
});
