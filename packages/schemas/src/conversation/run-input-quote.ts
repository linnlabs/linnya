import { z } from 'zod';

/** 只证明引语属于本次已接纳的用户角色文本，不认证真人、事实或作者推论。 */
export const RunInputQuoteSchema = z.object({
  conversationId: z.string().min(1),
  agentRunId: z.string().min(1),
  inputEventId: z.string().min(1),
  inputRunId: z.string().min(1),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  quote: z.string().min(1).max(2000),
}).strict();
export type RunInputQuote = z.infer<typeof RunInputQuoteSchema>;
