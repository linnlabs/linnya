import { z } from 'zod';
import { DecisionIdSchema as id, DecisionTextSchema as text } from './decisionInput';
import { DecisionExpressionSchema } from './decisionExpression';

/** 时点是相对同一锚点的天数；null明确保留旧记录或当前未知，不从label猜日期。 */
export const DecisionCashFlowSchema = z.object({
  id, label: text, optionId: id, unit: text,
  timeAnchor: text.nullable(),
  openingBalance: DecisionExpressionSchema,
  entries: z.array(z.object({
    id, label: text, direction: z.enum(['inflow', 'outflow']), amount: DecisionExpressionSchema,
    at: DecisionExpressionSchema.nullable(),
  }).strict()).min(1),
}).strict();
export type DecisionCashFlow = z.infer<typeof DecisionCashFlowSchema>;
