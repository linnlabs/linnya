import { z } from 'zod';
import { DecisionIdSchema as id, DecisionTextSchema as text } from './decisionInput';
import { DecisionExpressionSchema } from './decisionExpression';

/** 数组次序就是声明的收付款次序；不解析label猜日期，也不推断资金已到账。 */
export const DecisionCashFlowSchema = z.object({
  id, label: text, optionId: id, unit: text,
  openingBalance: DecisionExpressionSchema,
  entries: z.array(z.object({
    id, label: text, direction: z.enum(['inflow', 'outflow']), amount: DecisionExpressionSchema,
  }).strict()).min(1),
}).strict();
export type DecisionCashFlow = z.infer<typeof DecisionCashFlowSchema>;
