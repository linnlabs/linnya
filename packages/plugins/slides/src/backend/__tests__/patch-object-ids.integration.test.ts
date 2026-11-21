import { describe, expect, it } from 'vitest';
import type { PatchSpec } from '@plugin/slides/shared';
import { PatchCompiler } from '../engine/patch/PatchCompiler';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import {
  AUTHORED_SLIDES,
  buildConnectorAnimationDeck,
  expectedReferences,
  readSlidesInOrder,
  resolveSlideReferences,
} from './helpers/authored-connector-deck';

const patchCompiler = new PatchCompiler(new StructuredCompiler());

function expectReferencesIntact(xml: string, slideIndex: number): void {
  const { connectors, animationTargets } = resolveSlideReferences(xml);
  expect({ connectors, animationTargets }).toEqual(expectedReferences(AUTHORED_SLIDES[slideIndex]));
}

describe('导入稿导出不重排对象编号', () => {
  it('前提：源稿编号不连续，连接线与动画引用指向预期形状', async () => {
    const slides = await readSlidesInOrder(await buildConnectorAnimationDeck());

    expect(resolveSlideReferences(slides[0]).ids).toEqual(['1', '4', '9', '14', '17', '21']);
    slides.forEach((xml, index) => expectReferencesIntact(xml, index));
  });

  it('只改一页样式（直接改 XML）：其余页逐字节不变，被改页的编号与引用不变', async () => {
    const source = await buildConnectorAnimationDeck();
    const patch: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'modify_style', target: { slideNumber: 2, elementName: 'Hub' }, style: { fill: '#FF0000' } }],
    };

    const result = await patchCompiler.compile(source, patch);

    const before = await readSlidesInOrder(source);
    const after = await readSlidesInOrder(result);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after[1]).not.toBe(before[1]);
    expect(resolveSlideReferences(after[1]).ids).toEqual(resolveSlideReferences(before[1]).ids);
    expectReferencesIntact(after[1], 1);
  });

  it('改文字（经 pptx-automizer 重组包）：编号不变，连接线与动画仍指向原形状', async () => {
    const source = await buildConnectorAnimationDeck();
    const patch: PatchSpec = {
      type: 'patch',
      operations: [{ op: 'modify_text', target: { slideNumber: 2, elementName: 'Hub' }, text: 'Central' }],
    };

    const result = await patchCompiler.compile(source, patch);

    const before = await readSlidesInOrder(source);
    const after = await readSlidesInOrder(result);
    expect(after).toHaveLength(3);
    after.forEach((xml, index) => {
      expect(resolveSlideReferences(xml).ids).toEqual(resolveSlideReferences(before[index]).ids);
      expectReferencesIntact(xml, index);
    });
    expect(after[1]).toContain('Central');
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it('删页后留下的作者页编号与引用保持原样', async () => {
    const source = await buildConnectorAnimationDeck();
    const patch: PatchSpec = { type: 'patch', operations: [{ op: 'delete_slide', slideNumber: 2 }] };

    const result = await patchCompiler.compile(source, patch);

    const before = await readSlidesInOrder(source);
    const after = await readSlidesInOrder(result);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[2]);
    expectReferencesIntact(after[0], 0);
    expectReferencesIntact(after[1], 2);
  });

  it('插入新页：作者页编号不变，新页自己的对象编号互不冲突', async () => {
    const source = await buildConnectorAnimationDeck();
    const patch: PatchSpec = {
      type: 'patch',
      operations: [{
        op: 'insert_slide',
        slideNumber: 2,
        spec: {
          type: 'structured',
          elements: [
            { type: 'title', content: 'Inserted', position: { x: 1, y: 0.5, w: 8, h: 1 } },
            { type: 'text', content: 'Body', position: { x: 1, y: 2, w: 8, h: 1 } },
            { type: 'shape', geometry: 'rect', position: { x: 1, y: 3.5, w: 2, h: 1 }, style: { fill: '#2468C4' } },
          ],
        },
      }],
    };

    const result = await patchCompiler.compile(source, patch);

    const before = await readSlidesInOrder(source);
    const after = await readSlidesInOrder(result);
    expect(after).toHaveLength(4);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(after[3]).toBe(before[2]);
    expectReferencesIntact(after[0], 0);
    expectReferencesIntact(after[2], 1);
    expectReferencesIntact(after[3], 2);
    const insertedIds = resolveSlideReferences(after[1]).ids;
    expect(insertedIds.length).toBeGreaterThanOrEqual(4);
    expect(new Set(insertedIds).size).toBe(insertedIds.length);
  });
});
