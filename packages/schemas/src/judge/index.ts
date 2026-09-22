import { z } from 'zod';
import { WorkspaceFileLocatorSchema } from '../file-locator';

const text = z.string().min(1).refine(value => value.trim().length > 0);
const locator = WorkspaceFileLocatorSchema.refine(value => value.endsWith('.md'),
  'Use an explicit workspace:/...md document locator.');
export const JudgeFindingSchema = z.object({
  criterion: text,
  assessment: z.enum(['supported', 'revision_needed', 'unverified']),
  explanation: text,
  evidence: z.array(z.object({ locator, quote: text }).strict()),
}).strict().superRefine((finding, ctx) => {
  if (finding.assessment !== 'unverified' && finding.evidence.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['evidence'],
      message: 'A supported or revision-needed assessment requires exact document quotations.' });
  }
});

export const JudgeRecordArgsSchema = z.object({
  target: locator,
  review_output: locator,
  materials: z.array(locator),
  rubric: text,
  findings: z.array(JudgeFindingSchema).min(1),
}).strict().superRefine((args, ctx) => {
  const allowed = new Set([args.target, ...args.materials]);
  if (allowed.has(args.review_output)) ctx.addIssue({ code: z.ZodIssueCode.custom,
    path: ['review_output'], message: 'Review output must differ from every input document.' });
  args.findings.forEach((finding, i) => finding.evidence.forEach((evidence, j) => {
    if (!allowed.has(evidence.locator)) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ['findings', i, 'evidence', j, 'locator'],
      message: 'Evidence must reference the declared target or supplied materials.' });
  }));
});

// 回执确认的是评价已记录；内容真实性、引用匹配与语义支持没有由此工具执行验证。
export const JudgeRecordResultSchema = z.object({
  observation: text,
  data: z.object({
    target: locator,
    review_output: locator,
    document_delivery: z.literal('not_checked'),
    assessment_origin: z.literal('model_reported'),
    semantic_validation: z.literal('not_performed'),
    supported: z.number().int().nonnegative(),
    revision_needed: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type JudgeRecordArgs = z.infer<typeof JudgeRecordArgsSchema>;
export type JudgeRecordResult = z.infer<typeof JudgeRecordResultSchema>;
