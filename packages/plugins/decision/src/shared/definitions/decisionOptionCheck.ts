import { z } from 'zod';
import { DecisionIdSchema } from './decisionInput';

export const DecisionOptionCheckSchema = z.object({ optionIds: z.array(DecisionIdSchema).min(1) }).strict();
export type DecisionOptionCheck = z.infer<typeof DecisionOptionCheckSchema>;
