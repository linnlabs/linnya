import { describe, expect, it } from 'vitest';
import {
  ParentResearchDocumentArgsSchema,
  ResearchRunArtifactSchema,
  ResearchRunDataSchema,
  SubmitResearchDocumentArgsSchema,
  SubmitResearchDocumentResultSchema,
  SubmitResearchDocumentToolOutputSchema,
} from './research-run';
import { CompleteResearchResultSchema } from './complete-research';

const document = {
  path: 'workspace:/research/draft.md',
  inode: 'draft-document',
  sha256: 'a'.repeat(64),
  citation_sha256: 'b'.repeat(64),
};
const observation = '文稿已经保存，可以继续独立复核。';
const control = { terminateRun: true, finalAnswer: '阶段文稿已保存。' };
const parentArtifact = { ...document, stage: 'draft', run_id: 'research-parent' };
const childArtifact = { ...document, stage: 'argument_review', subrun_id: 'argument-child' };

describe('research document producer and submission lifecycle', () => {
  it('keeps the parent writing stages distinct from a bound child submission', () => {
    const content = '  # Preserve original Markdown whitespace\n';
    expect(SubmitResearchDocumentArgsSchema.parse({ content }).content).toBe(content);
    expect(ParentResearchDocumentArgsSchema.parse({
      stage: 'draft', input_documents: ['workspace:/research/investigation.md'], content,
    }).content).toBe(content);
    for (const invalid of [
      { content, stage: 'draft' },
      { content, stage: 'source_review', input_documents: [] },
      { content, stage: 'draft', input_documents: ['workspace:/same.md', 'workspace:/same.md'] },
      { content, stage: 'draft', input_documents: [], run_id: 'model-assigned' },
    ]) expect(() => SubmitResearchDocumentArgsSchema.parse(invalid)).toThrow();
  });

  it('requires a real producer identity and forbids a parent pretending to be an independent review', () => {
    expect(ResearchRunArtifactSchema.parse(parentArtifact)).toEqual(parentArtifact);
    expect(ResearchRunArtifactSchema.parse(childArtifact)).toEqual(childArtifact);
    for (const invalid of [
      { ...parentArtifact, subrun_id: 'invented-child' },
      { ...document, stage: 'draft' },
      { ...parentArtifact, stage: 'source_review' },
    ]) expect(() => ResearchRunArtifactSchema.parse(invalid)).toThrow();
  });

  it('continues the parent after saving while terminating only the bound child', () => {
    expect(SubmitResearchDocumentToolOutputSchema.parse({
      data: parentArtifact, observation,
    })).toEqual({ data: parentArtifact, observation });
    expect(SubmitResearchDocumentToolOutputSchema.parse({
      data: childArtifact, observation, control,
    })).toEqual({ data: childArtifact, observation, control });
    expect(() => SubmitResearchDocumentToolOutputSchema.parse({
      data: parentArtifact, observation, control,
    })).toThrow();
    expect(() => SubmitResearchDocumentToolOutputSchema.parse({
      data: childArtifact, observation,
    })).toThrow();
    // 展示与回放只接纳业务结果，不把执行控制当作持久化的质量或完成状态。
    for (const data of [parentArtifact, childArtifact]) {
      expect(SubmitResearchDocumentResultSchema.parse({ data, observation })).toEqual({ data, observation });
      expect(() => SubmitResearchDocumentResultSchema.parse({ data, observation, control })).toThrow();
    }
  });

  it('does not admit parent artifacts into the historical six-child Host result', () => {
    const stages = ['investigation', 'investigation_review', 'draft', 'argument_review', 'source_review', 'revision'];
    const artifacts = stages.map(stage => ({ ...document, stage, subrun_id: `child-${stage}` }));
    const data = { status: 'delivered', model_id: 'model', artifacts,
      subrun_ids: artifacts.map(artifact => artifact.subrun_id) };
    expect(ResearchRunDataSchema.parse(data)).toEqual(data);
    expect(() => ResearchRunDataSchema.parse({ ...data,
      artifacts: artifacts.map(artifact => artifact.stage === 'draft' ? parentArtifact : artifact),
    })).toThrow();
  });

  it('delivers either author lineage only with two distinct independent child reviews', () => {
    const reviews = [childArtifact, { ...childArtifact, stage: 'source_review', subrun_id: 'source-child' }];
    const authors = [
      { ...parentArtifact, stage: 'revision' },
      { ...document, stage: 'revision', subrun_id: 'revision-child' },
    ];
    for (const artifact of authors) {
      const result = { data: { artifact, review_artifacts: reviews }, observation };
      expect(CompleteResearchResultSchema.parse(result)).toEqual(result);
      expect(() => CompleteResearchResultSchema.parse({ ...result, data: {
        ...result.data, review_artifacts: [reviews[0], { ...reviews[1], subrun_id: 'argument-child' }],
      } })).toThrow();
      expect(() => CompleteResearchResultSchema.parse({ ...result, data: {
        ...result.data, review_artifacts: [reviews[0], { ...parentArtifact, stage: 'source_review' }],
      } })).toThrow();
    }
    expect(() => CompleteResearchResultSchema.parse({ data: {
      artifact: { ...document, stage: 'revision', subrun_id: 'argument-child' }, review_artifacts: reviews,
    }, observation })).toThrow();
  });
});
