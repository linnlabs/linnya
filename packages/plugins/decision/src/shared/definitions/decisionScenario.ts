import { z } from 'zod';
import { DecisionInputSchema } from './decisionRecord';

/** 假设只替换已有输入的值，不允许借试算改公式或把来源状态恢复为有效。 */
export const DecisionScenariosSchema = z.object({
  cases: z.array(z.object({
    id: DecisionInputSchema.shape.id,
    label: DecisionInputSchema.shape.label,
    inputs: z.array(z.object({
      inputId: DecisionInputSchema.shape.id,
      value: DecisionInputSchema.shape.value,
    }).strict()).min(1),
  }).strict()).min(1),
}).strict();

export type DecisionScenarios = z.infer<typeof DecisionScenariosSchema>;
