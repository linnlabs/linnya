import { JudgeRecordArgsSchema, JudgeRecordResultSchema } from '@app/schemas';
import { BaseTool, type ToolArgs, type ToolParameterSchema } from '../../types';

/** 只记录评委明确提交的判断。执行与持久化仍归正式 ToolNode/EventStore。 */
export class JudgeRecordTool extends BaseTool {
  readonly name = 'judge_record';
  readonly description = `Record evidence-grounded document assessments, including unverified criteria.
This validates the record shape and declared evidence scope, NOT truth, quote accuracy or semantic support.
Use after reading the specified target and allowed materials. Then save an independent Markdown review
with write_file and read it back. This tool neither writes a document nor invokes another model.`;
  readonly parameters: ToolParameterSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      target: { type: 'string', minLength: 1, description: 'Reviewed workspace:/...md document.' },
      review_output: { type: 'string', minLength: 1, description: 'Planned NEW workspace:/...md review; recording does not save it.' },
      materials: { type: 'array', description: 'Explicitly allowed workspace Markdown evidence documents; empty when none.',
        items: { type: 'string', minLength: 1, description: 'Allowed material document locator.' } },
      rubric: { type: 'string', minLength: 1, description: 'User-supplied or explicitly declared review criteria; never a hidden score.' },
      findings: { type: 'array', minItems: 1, description: 'Separate assessments with exact quotations or an explicit unverified reason.',
        items: { type: 'object', description: 'Evidence-grounded assessment record.', additionalProperties: false,
          properties: {
            criterion: { type: 'string', minLength: 1, description: 'Specific review criterion.' },
            assessment: { type: 'string', description: 'Model-reported judgment, not a mechanical fact-check.', enum: ['supported', 'revision_needed', 'unverified'] },
            explanation: { type: 'string', minLength: 1, description: 'Reason and limits supporting the judgment.' },
            evidence: { type: 'array', description: 'Exact relevant quotations; required unless unverified.', items: { type: 'object', description: 'Evidence-grounded assessment record.', additionalProperties: false,
              properties: { locator: { type: 'string', minLength: 1, description: 'Declared source document.' }, quote: { type: 'string', minLength: 1, description: 'Exact source quotation.' } },
              required: ['locator', 'quote'] } },
          }, required: ['criterion', 'assessment', 'explanation', 'evidence'],
        } },
    }, required: ['target', 'review_output', 'materials', 'rubric', 'findings'],
  };
  protected override validateArguments(args: Record<string, unknown>) {
    const parsed = JudgeRecordArgsSchema.safeParse(args);
    return parsed.success ? { success: true } : { success: false, error: parsed.error.message };
  }
  async run(args: ToolArgs): Promise<string> {
    const record = JudgeRecordArgsSchema.parse(args);
    const count = (assessment: 'supported' | 'revision_needed' | 'unverified') =>
      record.findings.filter(finding => finding.assessment === assessment).length;
    return JSON.stringify(JudgeRecordResultSchema.parse({
      data: { target: record.target, review_output: record.review_output, document_delivery: 'not_checked', assessment_origin: 'model_reported', semantic_validation: 'not_performed',
        supported: count('supported'), revision_needed: count('revision_needed'), unverified: count('unverified') },
      observation: `Recorded ${record.findings.length} model-reported assessments for ${record.target}. ` +
        `Supported: ${count('supported')}; revision needed: ${count('revision_needed')}; unverified: ${count('unverified')}. ` +
        'Record admission is not fact verification. Save the review to a new Workspace Markdown document and read it back.',
    }));
  }
}
