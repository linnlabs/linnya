import { z } from 'zod';

const text = z.string().trim().min(1);
const id = text.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);

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

export const DecisionInputSchema = z.object({
  id,
  label: text,
  kind: z.enum(['fact', 'preference', 'constraint', 'assumption']),
  value: z.union([z.number().finite(), z.string(), z.boolean(), z.null()]),
  unit: z.string().optional(),
  origin: text,
  status: z.enum(['available', 'withdrawn']),
}).strict();

export const DecisionOptionSchema = z.object({ id, label: text, description: text }).strict();
export const DecisionCalculationSchema = z.object({
  id,
  label: text,
  unit: text,
  expression: DecisionExpressionSchema,
}).strict();
export const DecisionCheckSchema = z.object({
  id,
  optionId: id,
  label: text,
  left: DecisionExpressionSchema,
  operator: z.enum(['lte', 'gte', 'eq']),
  right: DecisionExpressionSchema,
}).strict();

export const DecisionModelSchema = z.object({
  title: text,
  question: text,
  inputs: z.array(DecisionInputSchema),
  options: z.array(DecisionOptionSchema).min(1),
  calculations: z.array(DecisionCalculationSchema),
  checks: z.array(DecisionCheckSchema),
}).strict();
export type DecisionModel = z.infer<typeof DecisionModelSchema>;

export const DecisionRecommendationSchema = z.object({
  optionIds: z.array(id).min(1),
  rationale: text,
  changeConditions: text,
  nextAction: text,
  unresolved: z.array(text),
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
