/**
 * 生成文本的纵向锚点一致性：预览 RenderModel 与导出 PPTX 必须表达同一 verticalAlign，
 * 且导出的 `bodyPr@anchor` 经正式 TextBodyParser 重新导入后不变。
 */

import { describe, expect, it } from 'vitest';
import type { DeckSpec, RenderNode, TextRenderNode } from '@plugin/slides/shared';
import { DeckAssembler } from '../engine/DeckAssembler.js';
import { FreeformCompiler } from '../engine/FreeformCompiler.js';
import { StructuredCompiler } from '../engine/StructuredCompiler.js';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper.js';
import { findTextBodyAnchor, readPptxSlideXml, readTextBodyAnchors } from './helpers/pptx-text-body-anchors.js';

const SLIDE_SIZE = { width: 10, height: 5.625 };

const deck: DeckSpec = {
  title: 'Vertical anchor round trip',
  slides: [
    {
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [
          { type: 'title', content: 'S title', position: { x: 0.5, y: 0.2, w: 9, h: 0.9 } },
          { type: 'text', content: 'S text', position: { x: 0.5, y: 1.2, w: 3, h: 1.2 } },
          { type: 'text', content: 'S text bottom', position: { x: 3.6, y: 1.2, w: 3, h: 1.2 }, style: { valign: 'bottom' } },
          {
            type: 'bulletList',
            items: [{ text: 'S bullet' }],
            position: { x: 6.7, y: 1.2, w: 3, h: 1.2 },
          },
          {
            type: 'numberedList',
            items: [{ text: 'S number middle' }],
            position: { x: 0.5, y: 2.6, w: 3, h: 1.2 },
            style: { valign: 'middle' },
          },
          { type: 'shape', geometry: 'rect', position: { x: 3.6, y: 2.6, w: 3, h: 1.2 }, text: 'S shape' },
          { type: 'shape', geometry: 'rect', position: { x: 6.7, y: 2.6, w: 3, h: 1.2 }, text: 'S shape a\nS shape b' },
        ],
      },
    },
    {
      slideNumber: 2,
      spec: {
        type: 'freeform',
        elements: [
          { type: 'text', content: 'F text', position: { x: 0.5, y: 0.5, w: 3, h: 1.2 } },
          {
            type: 'text',
            content: [{ text: 'F rich', style: { italic: true } }],
            position: { x: 3.6, y: 0.5, w: 3, h: 1.2 },
          },
          { type: 'text', content: 'F text middle', position: { x: 6.7, y: 0.5, w: 3, h: 1.2 }, style: { valign: 'middle' } },
          {
            type: 'text',
            content: 'F vertical',
            position: { x: 0.5, y: 2, w: 1.2, h: 3 },
            style: { writingMode: 'vertical-rl' },
          },
          { type: 'shape', geometry: 'rect', position: { x: 3.6, y: 2, w: 3, h: 1.2 }, content: 'F shape' },
          {
            type: 'shape',
            geometry: 'rect',
            position: { x: 6.7, y: 2, w: 3, h: 1.2 },
            content: 'F shape top',
            style: { valign: 'top' },
          },
        ],
      },
    },
  ],
};

function collectTextNodes(nodes: readonly RenderNode[]): TextRenderNode[] {
  return nodes.flatMap((node): TextRenderNode[] => {
    if (node.kind === 'text') return [node];
    if (node.kind === 'shape') return node.innerText ? [node.innerText] : [];
    if (node.kind === 'group') return collectTextNodes(node.children);
    return [];
  });
}

function nodeText(node: TextRenderNode): string {
  return node.paragraphs
    .flatMap((paragraph) => paragraph.runs)
    .map((run) => ('text' in run ? run.text : ''))
    .join('');
}

describe('generated text vertical anchor round trip', () => {
  it('exports and re-imports the same verticalAlign the preview RenderModel uses', async () => {
    const renderModel = new RenderModelMapper().fromGeneratedDeck('anchor-roundtrip', 1, deck.title, deck, SLIDE_SIZE);
    const buffer = await new DeckAssembler(new StructuredCompiler(), new FreeformCompiler()).assemble(deck);

    const compared: Array<{ text: string; preview: string; exported: string | undefined }> = [];
    for (const [index, slide] of renderModel.slides.entries()) {
      const anchors = readTextBodyAnchors(await readPptxSlideXml(buffer, index + 1));
      for (const node of collectTextNodes(slide.elements)) {
        const text = nodeText(node);
        compared.push({
          text,
          preview: node.verticalAlign,
          exported: findTextBodyAnchor(anchors, text).verticalAlign,
        });
      }
    }

    expect(compared).toHaveLength(13);
    for (const entry of compared) {
      expect({ text: entry.text, verticalAlign: entry.exported })
        .toEqual({ text: entry.text, verticalAlign: entry.preview });
    }
    // 样本必须覆盖三种锚点，避免全部缺省时测试失去区分力。
    expect(new Set(compared.map((entry) => entry.preview))).toEqual(new Set(['top', 'middle', 'bottom']));
  });
});
