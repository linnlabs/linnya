import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileFlexInput, initYoga } from '../../src/backend/codegen/compose/flex-layout';
import { buildDeckSpecFromDirectInput } from '../../src/backend/codegen/compose/presentationComposeInput';
import { RenderModelMapper } from '../../src/backend/engine/parser/RenderModelMapper';
import { preparePreviewFixture } from './preparedPreviewFixture';
import type { FlexComposeInput } from '../../src/shared';

/** 原生浏览器消费真实编译器生成的前后修订；不把期望几何硬编码进浏览器。 */
await initYoga();
const frames = [
  { width: 2.5, shift: 0 }, { width: 1.25, shift: 0 }, { width: 2, shift: -0.75 },
].map(({ width, shift }, index) => {
  const input: FlexComposeInput = { title: 'Native flow width', layout: { width: 6.5, height: 3.5, unit: 'in' },
    slides: [{ _type: 'Slide', slideKey: 'overview', children: [{ _type: 'View', x: 0.5, y: 1, width: 5.5, height: 4,
      flexDirection: 'column', gap: 0.1, children: [
        { _type: 'Text', editKey: 'standalone', content: 'Width preview wraps immediately while saving the text box.', width: 2.5, minHeight: 0.35, fontSize: 14 },
        { _type: 'View', editKey: 'following', flexDirection: 'column', width: 3, padding: 0.1, backgroundColor: '#224466', children: [
          { _type: 'Text', content: 'The following block moves with the text above.', fontSize: 12, color: '#FFFFFF' },
        ] },
      ] }] }], manualEdits: { version: 2, slides: [{ slideKey: 'overview', targets: [
      { kind: 'text', editKey: 'standalone', width, translation: { dx: shift, dy: 0 } },
    ] }] } };
  const compiled = compileFlexInput(input);
  if (!compiled.input) throw new Error(compiled.error);
  const model = new RenderModelMapper().fromGeneratedDeck('interaction-fixture', index + 1, input.title, buildDeckSpecFromDirectInput(compiled.input), { width: 6.5, height: 3.5 });
  const slide = model.slides[0];
  return { ...slide, elements: slide.elements.map(node => {
    const identified = { ...node, id: node.authoringRef?.editKey ?? node.id };
    return identified.kind === 'text' ? preparePreviewFixture(identified, 'plain-textbox') : identified;
  }) };
});
const output = fileURLToPath(new URL('../../dist/dev/', import.meta.url));
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'flow-width-fixture.json'), JSON.stringify(frames));
