import { z } from 'zod';

/** answer segment 被封口的业务原因。 */
export const FinalAnswerCompletionReason = z.enum([
  'terminal',
  'tool_call',
  'interrupted',
]);
export type FinalAnswerCompletionReason = z.infer<typeof FinalAnswerCompletionReason>;
