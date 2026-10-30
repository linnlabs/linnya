import { z } from 'zod';
import { DecisionIdSchema } from './decisionInput';
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

export const DecisionExpressionSchema: z.ZodType<DecisionExpression, DecisionExpression> = z.lazy(() => z.union([
  z.object({ input: id }).strict(),
  z.object({ literal: z.number().finite() }).strict(),
  z.object({
    op: z.enum(['add', 'subtract', 'multiply', 'divide']),
    left: DecisionExpressionSchema,
    right: DecisionExpressionSchema,
  }).strict(),
]));

