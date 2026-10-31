import { insertBlankSlideIntoDeckSource } from '../../features/presentationManualEditing/functions/insertBlankSlideIntoDeckSource';
import { describe, it, expect, beforeAll } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile, readPptComposeRawPayload } from '../pptComposeProfile';
import { anchorAuthoringSource, preserveAuthoringGeneration } from './index';
import { compileFlexInput, initYoga } from '../../codegen/compose/flex-layout';
import { isFlexComposeInput } from '@plugin/slides/shared';
import { resolveManualEditTargets } from '../../codegen/compose/flex-layout/resolveManualEditTargets';
import { writeManualEditsToDeckSource } from '../../features/presentationManualEditing/functions/writeManualEditsToDeckSource';

const registry = new SandboxProfileRegistry();
registry.register(pptComposeProfile);
const sandbox = new SandboxService(registry, createSandboxEvaluatorTestRunner());
async function execute(source: string) {
  const result = await sandbox.execute({ profileId: 'ppt_compose', language: 'javascript', source });
  if (!result.success) throw new Error(JSON.stringify(result.error));
  const payload = readPptComposeRawPayload(result.value)?.rawPayload;
  if (!isFlexComposeInput(payload)) throw new Error('Missing flex output');
  const compiled = compileFlexInput(payload);
  if (!compiled.input || compiled.error) throw new Error(compiled.error);
  return { payload, input: compiled.input };
}
const SOURCE = `
function stat(value) { const frame=createFrame({backgroundColor:'#FFFFFF',padding:0.1}); frame.add(createText(value)); return frame; }
const slide=createSlide();
slide.add(stat(42),stat(false));
['100','100'].forEach(value=>slide.add(createText(value)));
slide.add(createShape({geometry:'rect',fill:'#FF0000',width:1,height:1}));
compose({title:'Identity',slides:[slide]});`;
function refs(input: Awaited<ReturnType<typeof execute>>['input']) {
  return input.slides.flatMap(slide => slide.elements.map(node => node._authoringRef));
}
beforeAll(initYoga);
describe('system authoring identity through sandbox and Yoga', () => {
  it('covers helpers, repeated text, decoration and shapes without author keys; anchoring preserves all compiled facts', async () => {
    const before = await execute(SOURCE);
    const anchored = anchorAuthoringSource(SOURCE);
    expect(anchorAuthoringSource(anchored)).toBe(anchored);
    const after = await execute(anchored);
    expect(after.input).toEqual(before.input);
    expect(refs(before.input).every(Boolean)).toBe(true);
    expect(new Set(refs(before.input).map(ref=>ref?.editKey)).size).toBe(7);
  });
  it('keeps identities and values across consecutive manual writes and source anchoring', async () => {
    const before = await execute(SOURCE);
    const target = refs(before.input).find(ref=>ref?.targetKind==='text');
    if (!target) throw new Error('No text target');
    const written = writeManualEditsToDeckSource(SOURCE, {op:'set_text_style',target,fontSizePt:32});
    const anchored = anchorAuthoringSource(written.source);
    const after = await execute(anchored);
    expect(refs(after.input)).toEqual(refs(before.input));
    expect(resolveManualEditTargets(after.payload).diagnostics).toEqual([]);
    expect(after.input.slides[0].elements.some(node=>node.type==='text' && node.style?.fontSize===32)).toBe(true);
  });
  it('suspends repeated-instance edits after generating logic changes, including indistinguishable labels', async () => {
    const anchored = anchorAuthoringSource(SOURCE);
    const before = await execute(anchored);
    const target = refs(before.input).find(ref=>ref?.editKey.startsWith('sysr_'));
    if (!target) throw new Error('No repeated target');
    const written = writeManualEditsToDeckSource(anchored,{op:'translate_by',target,targetKind:'text',delta:{dx:1,dy:0}});
    const after = await execute(written.source.replace("['100','100']", "['100','100'].reverse()"));
    expect(resolveManualEditTargets(after.payload).diagnostics).toHaveLength(1);
    expect(refs(after.input).some(ref=>ref?.editKey===target.editKey)).toBe(false);
  });
  it('retains anchored unique helper instances across unrelated AI changes and variable renaming', async () => {
    const anchored=anchorAuthoringSource(SOURCE);
    const before=await execute(anchored);
    const after=await execute(anchored.replaceAll('stat','makeStat').replace("title:'Identity'","title:'Revised'"));
    expect(refs(after.input).filter(ref=>ref?.editKey.startsWith('sysu_')))
      .toEqual(refs(before.input).filter(ref=>ref?.editKey.startsWith('sysu_')));
  });
});

it('treats one-item loops and indirect callbacks as revision-bound rather than stable identities', async () => {
  for (const body of [
    "for (const value of ['100']) slide.add(createText(value));",
    "function label(value){slide.add(createText(value));} ['100'].forEach(label);",
  ]) {
    const result = await execute(`const slide=createSlide(); ${body} compose({title:'single',slides:[slide]});`);
    expect(refs(result.input)[0]?.editKey).toMatch(/^sysr_/);
  }
});

it('does not truncate editing identities with the 1024-node diagnostic registry', async () => {
  const result = await execute(`const slide=createSlide(); for(let i=0;i<1100;i++) slide.add(createText(String(i))); compose({title:'large',slides:[slide]});`);
  expect(refs(result.input)).toHaveLength(1100);
  expect(new Set(refs(result.input).map(ref=>ref?.editKey)).size).toBe(1100);
});

it('edits one mounted instance when author code reuses the same node object', async () => {
  const source=anchorAuthoringSource(`const slide=createSlide(); const value=createText('same'); slide.add(value,value); compose({title:'shared',slides:[slide]});`);
  const before=await execute(source);
  const targets=refs(before.input);
  expect(new Set(targets.map(target=>target?.editKey)).size).toBe(2);
  const target=targets[0]; if(!target) throw new Error('Missing mounted instance');
  const written=writeManualEditsToDeckSource(source,{op:'set_text_style',target,fontSizePt:40});
  const after=await execute(written.source);
  expect(after.input.slides[0].elements.filter(element=>element.type==='text'&&element.style?.fontSize===40)).toHaveLength(1);
});

it('fixes page identity without changing properties observed by the author program', async () => {
  const source=`const slide=createSlide(); slide.add(createText(slide.slideKey ? 'changed' : 'original')); compose({title:'page semantics',slides:[slide]});`;
  expect((await execute(anchorAuthoringSource(source))).input).toEqual((await execute(source)).input);
});

it('preserves loop overrides for certified blank-page insertion, but not a subsequent AI rewrite', async () => {
  const source=anchorAuthoringSource(SOURCE);
  const before=await execute(source);
  const target=refs(before.input).find(ref=>ref?.editKey.startsWith('sysr_'));
  if(!target) throw new Error('No loop target');
  const written=writeManualEditsToDeckSource(source,{op:'set_text_style',target,fontSizePt:40});
  const insertion=insertBlankSlideIntoDeckSource(written.source,{index:0,slideCount:1,backgroundColor:'#FFFFFF'});
  const preserved=preserveAuthoringGeneration(written.source,insertion.source);
  const after=await execute(preserved);
  expect(resolveManualEditTargets(after.payload).diagnostics).toHaveLength(0);
  expect(after.input.slides[1].elements.filter(node=>node.type==='text'&&node.style?.fontSize===40)).toHaveLength(1);
  const aiChanged=await execute(preserved.replace("['100','100']","['100','100'].reverse()"));
  expect(resolveManualEditTargets(aiChanged.payload).diagnostics).toHaveLength(1);
});
