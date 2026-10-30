import { z } from 'zod';
import { DecisionIdSchema as id, DecisionTextSchema as text } from './decisionInput';
import { DecisionExpressionSchema as expression } from './decisionExpression';

/** 先列固定分期，最后一期始终由总额扣除分期；情景只能通过输入改变总额或日期。 */
export const DecisionObligationSchema = z.object({
  id, label: text,
  direction: z.enum(['outflow', 'inflow', 'pay_reserve', 'release_reserve']),
  total: expression,
  installments: z.array(z.object({ id, label: text, amount: z.number().finite().nonnegative(), at: expression.nullable() }).strict()),
  final: z.object({ id, label: text, at: expression.nullable() }).strict(),
}).strict();
export const DecisionFundsSchema = z.object({
  unit: text, timeAnchor: text.nullable(), bank: expression, reserve: expression,
}).strict();
export type DecisionObligation = z.infer<typeof DecisionObligationSchema>;
