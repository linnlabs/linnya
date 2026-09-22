import { describe, expect, it } from 'vitest';
import { JudgeRecordResultSchema } from '@app/schemas';
import { JudgeRecordTool } from './JudgeRecordTool';

const request = {
  target: 'workspace:/article.md', review_output: 'workspace:/review.md', materials: [],
  rubric: 'Explain the causal mechanism and disclose evidence limits.',
  findings: [{ criterion: 'causal explanation', assessment: 'revision_needed',
    explanation: 'The intermediate mechanism is absent.',
    evidence: [{ locator: 'workspace:/article.md', quote: 'A happened. Therefore B.' }] }],
};
describe('judge_record execution contract', () => {
  it('records explicit assessments without claiming semantic verification or document delivery', async () => {
    const tool = new JudgeRecordTool();
    const result = JudgeRecordResultSchema.parse(JSON.parse(await tool.run(request)));
    expect(result.data).toEqual({ target: request.target, review_output: request.review_output,
      document_delivery: 'not_checked', assessment_origin: 'model_reported', semantic_validation: 'not_performed',
      supported: 0, revision_needed: 1, unverified: 0 });
  });
  it('admits missing evidence only as unverified, refuses self-certified supported findings', async () => {
    const tool = new JudgeRecordTool();
    const finding = { ...request.findings[0], evidence: [], assessment: 'supported' };
    await expect(tool.run({ ...request, findings: [finding] })).rejects.toThrow('exact document quotations');
    const result = JudgeRecordResultSchema.parse(JSON.parse(await tool.run({
      ...request, findings: [{ ...finding, assessment: 'unverified' }],
    })));
    expect(result.data.unverified).toBe(1);
  });
  it('rejects undeclared evidence, overwriting input, unknown fields and empty records', async () => {
    const tool = new JudgeRecordTool();
    for (const args of [
      { ...request, review_output: request.target },
      { ...request, extra: true }, { ...request, target: 'workspace:/a/../article.md' }, { ...request, findings: [] },
      { ...request, findings: [{ ...request.findings[0], evidence: [{ locator: 'workspace:/other-review.md', quote: 'X' }] }] },
    ]) await expect(tool.run(args)).rejects.toThrow();
  });
});
