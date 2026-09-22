import { describe, expect, it } from 'vitest';
import { JudgeRecordTool } from 'src/tools/evaluation/judge_record/JudgeRecordTool';
import { projectJudgeRecordPresentation } from './projectJudgeRecordPresentation';
import type { ToolPresentationProjectorInput } from '../types';
const args = { target: 'workspace:/article.md', review_output: 'workspace:/review.md', materials: [],
  rubric: 'Evidence', findings: [{ criterion: 'external accuracy', assessment: 'unverified',
    explanation: 'Primary source was not provided.', evidence: [] }] };
function input(extra: Partial<ToolPresentationProjectorInput>): ToolPresentationProjectorInput {
  return { sourceToolName: 'judge_record', uiKey: 'judge_record', args, result: undefined,
    status: 'loading', phase: 'start', ...extra };
}
describe('judge review tool live/history presentation', () => {
  it('renders incomplete loading and argument failure without interpreting a result as success', () => {
    expect(projectJudgeRecordPresentation(input({ args: {} })).data.kind).toBe('lifecycle');
    expect(projectJudgeRecordPresentation(input({ args: {}, status: 'error', phase: 'error' })).data.kind).toBe('lifecycle');
  });
  it('projects the same real tool result for live completion and serialized history reload', async () => {
    const result: unknown = JSON.parse(await new JudgeRecordTool().run(args));
    const complete = input({ status: 'success', phase: 'complete', result });
    const live = projectJudgeRecordPresentation(complete);
    expect(live.data.findings?.[0]?.assessment).toBe('unverified');
    expect(live.data.output).toBe(args.review_output);
    expect(projectJudgeRecordPresentation({ ...complete, result: JSON.parse(JSON.stringify(result)) })).toEqual(live);
  });
  it('rejects incompatible success data instead of leaving a misleading completed card', () => {
    expect(() => projectJudgeRecordPresentation(input({ status: 'success', phase: 'complete', result: {} }))).toThrow();
  });
});
