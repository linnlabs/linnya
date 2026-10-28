import { expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { CodegenDeckBuilder } from '../../../codegen/CodegenDeckBuilder.js';
import { pptComposeProfile } from '../../../sandbox/pptComposeProfile.js';
import { createInProcessPresentationBuildExecution } from '../../presentationBuildExecution/index.js';
import { insertBlankSlideIntoDeckSource } from './insertBlankSlideIntoDeckSource.js';
import { projectBlankSlideInsertion } from './projectBlankSlideInsertion.js';

const source = `function heading(text) { return createText({ content: text, width: 2, height: 1 }); }
const first = createSlide({ slideKey: 'first', notes: 'Keep notes' });
const outer = createFrame({ editKey: 'outer', width: 5, height: 3, backgroundColor: '#112233' });
const inner = createFrame({ editKey: 'inner', width: 4, height: 2, backgroundColor: '#223344' });
inner.add(createText({ editKey: 'text', content: [{ text: 'Nested', style: { bold: true } }], width: 3, height: 1 }));
outer.add(inner); first.add(outer);

const last = createSlide({ slideKey: 'last' });
last.add(heading('Shared helper'));
compose({ title: 'Projection', layout: '4x3', slides: [first, last], manualEdits: {
  version: 2, slides: [{ slideKey: 'first', targets: [{ kind: 'frame', editKey: 'inner', translation: { dx: 0.5, dy: 0.25 } }] }]
} });`;

it('beginning/middle/end insertion equals full compilation including nested author metadata and shared source locations', async () => {
  const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
  const unused = async (): Promise<never> => { throw new Error('Read-only compiler must not persist or export'); };
  const builder = new CodegenDeckBuilder({
    presentationRepo: { getPresentation: async () => null, createPresentation: unused, commitPresentation: unused },
    engine: { assembleDeck: unused }, sandbox: new SandboxService(profiles, createSandboxEvaluatorTestRunner()),
    buildExecution: createInProcessPresentationBuildExecution(),
  });
  const deck = await builder.buildDeckSpecFromSource({ nodeId: 'deck', source });
  for (const index of [0, 1, 2]) {
    const insertion = insertBlankSlideIntoDeckSource(source, { index, slideCount: 2, backgroundColor: '#FFFFFF' });
    const projection = projectBlankSlideInsertion(deck, insertion, index, '#FFFFFF');
    expect(projection.kind).toBe('projected');
    if (projection.kind !== 'projected') throw new Error('Expected projection');
    expect(projection.deckSpec).toEqual(await builder.buildDeckSpecFromSource({ nodeId: 'deck', source: insertion.source }));
  }
  const named = source.replace("compose({ title: 'Projection', layout: '4x3', slides: [first, last]", "const pages = [first, last];\ncompose({ title: 'Projection', layout: '4x3', slides: pages");
  const insertion = insertBlankSlideIntoDeckSource(named, { index: 1, slideCount: 2, backgroundColor: '#FFFFFF' });
  expect(projectBlankSlideInsertion(deck, insertion, 1, '#FFFFFF').kind).toBe('requires_full_compile');
});
