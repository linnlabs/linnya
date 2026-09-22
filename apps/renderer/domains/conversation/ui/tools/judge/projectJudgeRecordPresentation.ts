import { JudgeRecordArgsSchema, JudgeRecordResultSchema, type JudgeRecordArgs } from '@app/schemas';
import type { ToolPresentationProjectorInput, ToolPresentationProjection } from '../types';

export interface JudgeRecordPresentationData {
  readonly kind: 'lifecycle' | 'record';
  readonly target?: string;
  readonly output?: string;
  readonly findings?: JudgeRecordArgs['findings'];
}
export const judgeRecordTitle = {
  key: 'conversation.tool.judgeRecord.title', fallback: 'Record review assessments',
};

/** live 与 reload 共用 admission；工具成功只表示记录完成，不投影“事实已通过”。 */
export function projectJudgeRecordPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<JudgeRecordPresentationData> {
  if (input.status !== 'success') {
    return { data: { kind: 'lifecycle' }, title: { text: judgeRecordTitle } };
  }
  const args = JudgeRecordArgsSchema.parse(input.args);
  const result = JudgeRecordResultSchema.parse(input.result);
  const count = (assessment: 'supported' | 'revision_needed' | 'unverified') =>
    args.findings.filter(finding => finding.assessment === assessment).length;
  if (result.data.target !== args.target || result.data.review_output !== args.review_output ||
      result.data.supported !== count('supported') ||
      result.data.revision_needed !== count('revision_needed') ||
      result.data.unverified !== count('unverified')) {
    throw new Error('Judge record receipt does not match the submitted assessments.');
  }
  return {
    data: { kind: 'record', target: args.target, output: args.review_output, findings: args.findings },
    title: { text: judgeRecordTitle },
  };
}
