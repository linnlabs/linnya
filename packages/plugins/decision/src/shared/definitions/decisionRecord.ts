import { z } from 'zod';
import { DecisionIdSchema, DecisionTextSchema, DecisionInputSchema } from './decisionInput';
import { DecisionScenarioCaseSchema } from './decisionScenario';

export { DecisionInputSchema } from './decisionInput';

const text = DecisionTextSchema;
const id = DecisionIdSchema;

/** 只计算显式给出的四则式，不执行模型生成的 JS 或推断缺失输入。 */
export type DecisionExpression =
  | { readonly input: string }
  | { readonly literal: number }
  | {
      readonly op: 'add' | 'subtract' | 'multiply' | 'divide';
      readonly left: DecisionExpression;
      readonly right: DecisionExpression;
    };

export const DecisionExpressionSchema: z.ZodType<DecisionExpression> = z.lazy(() => z.union([
  z.object({ input: id }).strict(),
  z.object({ literal: z.number().finite() }).strict(),
  z.object({
    op: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: DecisionExpressionSchema,
    right: DecisionExpressionSchema,
  }).strict(),
]));

export const DecisionOptionSchema = z.object({ id, label: text, description: text }).strict();
export const DecisionCalculationSchema = z.object({
  id,
  label: text,
  unit: text,
  expression: DecisionExpressionSchema,
}).strict();
export const DecisionCheckSchema = z.union([
  z.object({
    id, optionId: id, label: text,
    left: DecisionExpressionSchema,
    operator: z.enum(['lte', 'gte', 'eq']),
    right: DecisionExpressionSchema,
  }).strict(),
  z.object({
    id, optionId: id, label: text,
    operator: z.literal('is'),
    inputId: id,
    value: z.union([z.boolean(), z.string().min(1)]),
  }).strict(),
]);
export type DecisionCheck = z.infer<typeof DecisionCheckSchema>;

export const DecisionModelSchema = z.object({
  title: text,
  question: text,
  inputs: z.array(DecisionInputSchema),
  options: z.array(DecisionOptionSchema).min(1),
  calculations: z.array(DecisionCalculationSchema),
  checks: z.array(DecisionCheckSchema),
}).strict();
export type DecisionModel = z.infer<typeof DecisionModelSchema>;

export const DecisionConditionalAdviceSchema = z.object({
  preference: z.object({
    inputIds: z.array(id).min(1),
    optionOrder: z.array(id).min(1),
    reason: text,
  }).strict().optional(),
  cases: z.array(DecisionScenarioCaseSchema.extend({ nextAction: text.optional() })).min(1).optional(),
  whenNonePass: text,
  whenUndetermined: text,
}).strict();
export type DecisionConditionalAdvice = z.infer<typeof DecisionConditionalAdviceSchema>;

export const DecisionRecommendationSchema = z.object({
  // 空选择只用于显式条件性建议的暂不选择，业务校验不能把它当成漏填。
  optionIds: z.array(id),
  rationale: text,
  changeConditions: text,
  nextAction: text,
  unresolved: z.array(text),
  conditionalAdvice: DecisionConditionalAdviceSchema.optional(),
  // 作者只选既有算式与检查；值和边界方向由程序生成，避免再手填一份阈值。
  numericBasis: z.object({
    calculationIds: z.array(id),
    boundaries: z.array(z.object({ checkId: id, inputId: id }).strict()),
  }).strict().optional(),
}).strict();
export type DecisionRecommendation = z.infer<typeof DecisionRecommendationSchema>;

/** 条件和建议分开写入，避免更新条件时顺带把旧建议标为已核。 */
export const DecisionUpdateSchema = z.object({
  reason: text,
  inputs: z.array(DecisionInputSchema).optional(),
  options: z.array(DecisionOptionSchema).min(1).optional(),
  calculations: z.array(DecisionCalculationSchema).optional(),
  checks: z.array(DecisionCheckSchema).optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'reason'), {
  message: 'Specify inputs, options, calculations or checks to update.',
});
export type DecisionUpdate = z.infer<typeof DecisionUpdateSchema>;

export const DecisionRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  inputRevision: z.number().int().positive(),
  reason: text,
  model: DecisionModelSchema,
  recommendation: z.object({
    basedOnInputRevision: z.number().int().positive(),
    content: DecisionRecommendationSchema,
  }).strict().nullable(),
}).strict();
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
