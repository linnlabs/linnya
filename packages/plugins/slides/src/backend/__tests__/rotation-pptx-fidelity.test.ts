import { describe, expect, it } from 'vitest';
import { Group } from 'konva/lib/Group';
import type { DeckSpec, ImageRenderNode, ShapeRenderNode } from '@plugin/slides/shared';
import { buildImageGroupConfig, buildShapeGroupConfig } from '../../renderer/features/konvaPreview';
import { collectRenderNodeSelectionGeometries, findRenderNodeSelectionGeometryAtPoint } from '../../renderer/features/renderNodeSelection';
import { DeckAssembler } from '../engine/DeckAssembler';
import { FreeformCompiler } from '../engine/FreeformCompiler';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { PptxReader } from '../engine/parser/PptxReader';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper';
import { CanonicalBuilder } from '../engine/parser/CanonicalBuilder';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y5WQAAAABJRU5ErkJggg==';
const position = { x: 2, y: 1, w: 4, h: 2 };
const cases = ['rect', 'ellipse', 'image'] as const;

function previewGroup(node: ShapeRenderNode | ImageRenderNode) {
  return new Group(node.kind === 'shape' ? buildShapeGroupConfig(node) : buildImageGroupConfig(node));
}

describe('原生图形与图片的旋转保真', () => {
  it.each(cases.flatMap(kind => [0, 90, -30].map(rotate => ({ kind, rotate }))))(
    '$kind / $rotate: 预览、选区与真实 PPTX 回读四角一致', async ({ kind, rotate }) => {
      const deck: DeckSpec = {
        title: 'Rotation fidelity', layout: '16x9',
        slides: [{ slideNumber: 1, spec: { type: 'freeform', elements: [kind === 'image'
          ? { type: 'image', src: PNG, fitMode: 'cover', position, rotate }
          : { type: 'shape', geometry: { type: 'preset', name: kind }, position,
              style: { fill: '#2563EB', rotate } },
        ] } }],
      };
      const model = new RenderModelMapper().fromGeneratedDeck('rotation', 1, deck.title, deck, { width: 10, height: 5.625 });
      const node = model.slides[0]?.elements[0];
      if (node?.kind !== 'shape' && node?.kind !== 'image') throw new Error('Expected shape or image');
      const group = previewGroup(node);
      const buffer = await new DeckAssembler(new StructuredCompiler(), new FreeformCompiler()).assemble(deck);
      const info = await new PptxReader().parse(buffer);
      const exported = info.slides[0]?.elements[0];
      if (!exported?.position) throw new Error('PPTX geometry missing');
      const box = exported.position;
      const angle = (exported.rotation ?? 0) * Math.PI / 180;
      const [selection] = collectRenderNodeSelectionGeometries([node], candidate => candidate.kind === 'shape' || candidate.kind === 'image');
      if (!selection) throw new Error('Selection geometry missing');
      // 独立从 Office 的中心旋转约定求四角，避免仅比较相同的 rotate 字段。
      for (const [index, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
        const point = group.getTransform().point({ x: u * node.box.w * 96, y: v * node.box.h * 96 });
        const dx = (u - 0.5) * box.w;
        const dy = (v - 0.5) * box.h;
        const expected = {
          x: box.x + box.w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: box.y + box.h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
        };
        expect(point.x / 96).toBeCloseTo(expected.x, 5);
        expect(point.y / 96).toBeCloseTo(expected.y, 5);
        expect(selection.polygon[index]?.x).toBeCloseTo(expected.x, 5);
        expect(selection.polygon[index]?.y).toBeCloseTo(expected.y, 5);
      }
      expect(findRenderNodeSelectionGeometryAtPoint([node], {
        x: box.x + box.w / 2, y: box.y + box.h / 2,
      }, candidate => candidate.kind === 'shape' || candidate.kind === 'image')?.elementId).toBe(node.id);

      const canonical = new CanonicalBuilder().build('rotation-import', 1, deck.title, info);
      const imported = new RenderModelMapper().fromCanonicalDeck(canonical, { title: deck.title, slides: [] }, 'imported').slides[0]?.elements[0];
      if (imported?.kind !== 'shape' && imported?.kind !== 'image') throw new Error('Imported visual missing');
      const importedPoint = previewGroup(imported).getTransform().point({ x: 0, y: 0 });
      const originalPoint = group.getTransform().point({ x: 0, y: 0 });
      expect(importedPoint.x).toBeCloseTo(originalPoint.x, 4);
      expect(importedPoint.y).toBeCloseTo(originalPoint.y, 4);
    },
  );
});
