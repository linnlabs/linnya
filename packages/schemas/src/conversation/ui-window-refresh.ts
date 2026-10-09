import { z } from 'zod';

export const CONVERSATION_UI_WINDOW_MAX_ROWS = 320;

/** 当前窗口后台同步；边界来自已接纳的 durable rows，不表达滚动或 run 控制命令。 */
export const ConversationUiWindowRefreshQuerySchema = z.object({
  known_revision: z.coerce.number().int().nonnegative(),
  first_sort_seq: z.coerce.number().int().nonnegative(),
  last_sort_seq: z.coerce.number().int().nonnegative(),
  follow_tail: z.enum(['true', 'false']).transform(value => value === 'true'),
}).strict().refine(value => value.first_sort_seq <= value.last_sort_seq, {
  message: 'Window start must not follow its end',
});

export type ConversationUiWindowRefreshQuery = z.output<typeof ConversationUiWindowRefreshQuerySchema>;

export const ConversationUiWindowUnchangedSchema = z.object({
  success: z.literal(true),
  status: z.literal('unchanged'),
  conversation_id: z.string().min(1),
  revision: z.number().int().nonnegative(),
}).strict();

export type ConversationUiWindowUnchanged = z.infer<typeof ConversationUiWindowUnchangedSchema>;
