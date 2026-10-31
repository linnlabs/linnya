import { readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SandboxProfileRegistry } from 'src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from 'src/features/sandbox/SandboxService';
import { createSandboxEvaluatorTestRunner } from 'src/features/sandbox/testing/createSandboxEvaluatorTestRunner';
import { pptComposeProfile, readPptComposeRawPayload } from '../../src/backend/sandbox/pptComposeProfile';
import { anchorAuthoringSource } from '../../src/backend/sandbox/authoringIdentity';
import { compileFlexInput, initYoga } from '../../src/backend/codegen/compose/flex-layout';
import { isFlexComposeInput, type LayoutNode } from '../../src/shared';

const corpusPath = process.env.SLIDES_IDENTITY_CORPUS;
it.skipIf(!corpusPath)('real corpus: source anchors preserve compiled semantics and provide every visible author identity', async () => {
  if (!corpusPath) throw new Error('Pass SLIDES_IDENTITY_CORPUS explicitly');
  const corpus: unknown = JSON.parse(readFileSync(corpusPath, 'utf8'));
  if (!Array.isArray(corpus)) throw new Error('Corpus must be an array');
  const profiles = new SandboxProfileRegistry(); profiles.register(pptComposeProfile);
  const sandbox = new SandboxService(profiles, createSandboxEvaluatorTestRunner());
  await initYoga();
  let decks=0, objects=0, stablePathObjects=0, revisionBoundObjects=0, explicitObjects=0, sourceBytes=0, anchoredBytes=0;
  const byType: Record<string, number> = {};
  const times: number[]=[];
  const failures: {index:number;stage:string}[]=[];
  for (const [index, entry] of corpus.entries()) {
    if (!entry || typeof entry !== 'object' || !('source' in entry) || typeof entry.source!=='string') throw new Error('Invalid corpus entry');
    const source=entry.source;
    sourceBytes+=Buffer.byteLength(source); anchoredBytes+=Buffer.byteLength(anchorAuthoringSource(source));
    try {
      const outputs=[];
      for (const text of [source, anchorAuthoringSource(source)]) {
        const start=performance.now();
        const result=await sandbox.execute({profileId:'ppt_compose',language:'javascript',source:text});
        if (!result.success) throw new Error('sandbox: '+result.error?.type);
        const raw=readPptComposeRawPayload(result.value)?.rawPayload;
        if (!isFlexComposeInput(raw)) throw new Error('Missing author tree');
        const compiled=compileFlexInput(raw);
        if (!compiled.input || compiled.rejectedSlides?.length) throw new Error('compose: '+(compiled.error ?? compiled.rejectedSlides?.map(slide=>slide.reason).join(';')));
        times.push(performance.now()-start);
        outputs.push(compiled.input);
        // 与未分配系统身份的同一作者树比较，不屏蔽布局或资产字段。
        function removeSystemKeys(node:LayoutNode):void {
          if ('editKey' in node && /^sys[ur]_/.test(node.editKey ?? '')) delete node.editKey;
          if (node._type==='Slide' && node.slideKey?.startsWith('sysp_')) delete node.slideKey;
          if ('children' in node) node.children.forEach(removeSystemKeys);
        }
        raw.slides.forEach(removeSystemKeys);
        const baseline=compileFlexInput(raw);
        const visual=(value:unknown)=>JSON.stringify(value,(key,v)=>key==='_authoringRef'||key==='_authoringAncestorRefs'?undefined:v);
        expect(visual(compiled.input)).toBe(visual(baseline.input));
      }
      expect(outputs[1]).toEqual(outputs[0]);
      for (const slide of outputs[0].slides) for (const element of slide.elements) {
        expect(element._authoringRef).toBeDefined();
        objects++;
        const key=element._authoringRef?.editKey ?? '';
        if(key.startsWith('sysr_')) revisionBoundObjects++; else if(key.startsWith('sysu_')) stablePathObjects++; else explicitObjects++;
        byType[element.type]=(byType[element.type]??0)+1;
      }
      decks++;
    } catch(error) {
      failures.push({index,stage:error instanceof Error?error.message.slice(0,120):'unknown'});
    }
  }
  times.sort((a,b)=>a-b);
  const report={decks,of:corpus.length,objects,byType,stablePathObjects,revisionBoundObjects,explicitObjects,sourceBytes,anchoredBytes,p50Ms:times[Math.floor(times.length*0.5)],p95Ms:times[Math.floor(times.length*0.95)],failures};
  if(process.env.SLIDES_IDENTITY_REPORT) writeFileSync(process.env.SLIDES_IDENTITY_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  expect(failures).toEqual([]);
},60000);
