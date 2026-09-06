import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { DeckSpec } from '@plugin/slides/shared';
import { renderDeck } from './helpers/render-model-mapping-harness';
import {
  applyTextLayoutToRenderModel,
  collectClusterAdvanceRequestsForRenderModel,
  prewarmTextLayoutForRenderModel,
} from '../engine/text/renderModelTextLayout';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildSceneGraph } from '../tools/inspectFeedback/sceneGraph';
import { buildTableCellLayouts } from '../../renderer/features/konvaPreview/functions/konvaTable';
import { buildCellTextNode } from '../../renderer/features/konvaPreview/functions/builders/tableBuilder';
import { buildTextLineConfigs } from '../../renderer/features/konvaPreview/functions/builders/textBuilder';

describe('table explicit line breaks', () => {
  it('preserves multiline cells through measurement, inspection, preview projection and native PPTX', async () => {
    const cellText = 'Factory automation\nService robots';
    const deck: DeckSpec = {
      title: 'Multiline table',
      layout: '16x9',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [{
            type: 'table',
            position: { x: 1, y: 1, w: 8, h: 2 },
            headers: ['Segment'],
            rows: [[{ text: cellText, style: { fontSize: 16 } }]],
          }],
        },
      }],
    };
    const model = renderDeck(deck);
    const table = model.slides[0]?.elements[0];
    if (table?.kind !== 'table') throw new Error('Expected table render node');
    const bodyCell = table.cells.find(cell => cell.row === 1);
    expect(bodyCell?.paragraphs[0]?.runs[0]?.text).toBe(cellText);

    const requests = collectClusterAdvanceRequestsForRenderModel(model);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some(request => request.clusters.join('') === cellText.replace('\n', ''))).toBe(true);
    expect(requests.every(request => !request.clusters.includes('\n'))).toBe(true);
    await prewarmTextLayoutForRenderModel(model);
    applyTextLayoutToRenderModel(model);

    const layout = bodyCell?.textLayout;
    expect(layout?.lines.map(line => line.slices.map(slice => slice.text).join('')))
      .toEqual(cellText.split('\n'));
    expect(layout?.overflow).toEqual({ horizontal: false, vertical: false, hiddenLineCount: 0 });
    expect(layout?.appliedFontScale).toBe(1);
    expect(buildSceneGraph(model)[0]?.rootNode.children?.[0]?.kind).toBe('table');

    const cellLayout = buildTableCellLayouts(table).find(cell => cell.cell === bodyCell);
    if (!cellLayout) throw new Error('Expected table cell');
    const textNode = buildCellTextNode(table, cellLayout);
    expect(textNode.layout).toBe(layout);
    const configs = buildTextLineConfigs(textNode);
    expect(configs.map(config => config.text)).toEqual(cellText.split('\n'));
    expect(configs[1]?.y).toBeGreaterThan(configs[0]!.y);
    expect(configs.every(config => config.wrap === 'none')).toBe(true);

    // 检查真实导出保留两行，而不是让预览修复以删除源换行为代价。
    const pptx = await materializePresentationPptx({ deckSpec: deck, svgAssets: [], svgFallbacks: [] });
    const zip = await JSZip.loadAsync(pptx);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    if (!xml) throw new Error('Expected slide XML');
    const document = new DOMParser().parseFromString(xml, 'text/xml');
    const paragraphs = Array.from(document.getElementsByTagName('a:p'));
    expect(paragraphs.map(paragraph => paragraph.textContent)).toEqual(['Segment', ...cellText.split('\n')]);
    expect(bodyCell?.paragraphs[0]?.runs[0]?.text).toBe(cellText);
  });
});
