import { beforeAll, expect, it } from 'vitest';
import type { FlexComposeInput, SlidesInsertedObject, TextRenderNode } from '@plugin/slides/shared';
import { readInsertedObjects } from '@plugin/slides/shared/authoringEditing';
import { createInsertedObject } from '../../../../renderer/features/elementInsertion/functions/createInsertedObject';
import { compileFlexInput, initYoga } from '../../../codegen/compose/flex-layout';
import { buildDeckSpecFromDirectInput } from '../../../codegen/compose/presentationComposeInput';
import { copyManualObjects } from '../../../features/presentationManualEditing';
import { RenderModelMapper } from '../../parser/RenderModelMapper';
import { applyTextLayoutToRenderModel } from '../renderModelTextLayout';

beforeAll(initYoga);

function render(objects: readonly SlidesInsertedObject[]) {
  const admitted = readInsertedObjects(JSON.parse(JSON.stringify(objects)));
  if ('error' in admitted) throw new Error(admitted.error);
  const input: FlexComposeInput = {
    title: 'Text height',
    slides: [{ _type: 'Slide', slideKey: 'page', children: [
      { _type: 'Text', editKey: 'authored', x: 1, y: 1, width: 4, height: 1.5, content: 'Hi', fontSize: 28 },
    ] }],
    manualEdits: { version: 2, slides: [{ slideKey: 'page', targets: [], additions: [...admitted.value] }] },
  };
  const compiled = compileFlexInput(input);
  if (!compiled.input) throw new Error(compiled.error);
  const deck = buildDeckSpecFromDirectInput(compiled.input);
  const model = new RenderModelMapper().fromGeneratedDeck('height', 1, input.title, deck, { width: 10, height: 5.625 });
  applyTextLayoutToRenderModel(model, {
    getClusterAdvances: (clusters, style) => ({ source: 'heuristic', advances: clusters.map(() => style.fontSizePt / 144) }),
  }, { getMetrics: () => undefined });
  function text(editKey: string): TextRenderNode {
    const node = model.slides[0].elements.find(element => element.authoringRef?.editKey === editKey);
    if (node?.kind !== 'text') throw new Error(`Missing text ${editKey}`);
    return node;
  }
  return { deck, text };
}

it('UI text grows and shrinks with content while authored, copied and legacy height constraints remain intact', () => {
  const created = createInsertedObject('text', { width: 10, height: 5.625 }, 'Hi', 'new-text', { text: '#111827', fill: '#224466' });
  if (created.kind !== 'text') throw new Error('Expected text insertion');
  const initial = render([created]);
  const short = initial.text(created.editKey);
  expect(short.box.h).toBeLessThan(created.box.h);
  expect(short.box.h).toBeCloseTo(short.layout?.requiredHeightInches ?? 0, 4);
  expect(initial.text('authored').box.h).toBe(1.5);

  const long = render([{ ...created, content: 'Longer text wraps onto many lines. '.repeat(6) }]).text(created.editKey);
  expect(long.box.h).toBeGreaterThan(created.box.h);
  const small = render([{ ...created, style: { ...created.style, fontSize: 10 } }]).text(created.editKey);
  expect(small.box.h).toBeLessThan(short.box.h);
  expect(small.box.h).toBeCloseTo(small.layout?.requiredHeightInches ?? 0, 4);
  expect(render([created]).text(created.editKey).box).toEqual(short.box);

  const copies = copyManualObjects(initial.deck, [{ slideKey: 'page', editKey: 'authored' }]);
  expect(render(copies).text(copies[0].editKey).box).toEqual(initial.text('authored').box);
  const copy = copies[0];
  if (copy.kind !== 'text') throw new Error('Expected text copy');
  expect(render([{ ...copy, style: { ...copy.style, fontSize: 10 } }]).text(copy.editKey).box.h).toBe(1.5);

  const legacy: SlidesInsertedObject = {
    kind: 'text', editKey: 'legacy', box: created.box, content: created.content, style: created.style,
  };
  expect(render([legacy]).text(legacy.editKey).box.h).toBe(created.box.h);
  expect(readInsertedObjects([{ ...created, heightMode: 'unknown' }])).toHaveProperty('error');
});
