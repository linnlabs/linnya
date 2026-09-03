import { z } from 'zod';
import { ConversationReferenceIdSchema } from './reference-identity';
import { JsonValueSchema } from '../json-value';

const NonBlankIdentitySchema = z.string().refine(
  value => value.trim().length > 0 && value === value.trim(),
  { message: '引用身份不能为空或包含首尾空白' },
);

/** 持久化与 host 请求使用的 snake_case 引用条目。 */
export const UserQuoteItemSchema = z.object({
  quote_id: ConversationReferenceIdSchema,
  plugin_id: NonBlankIdentitySchema,
  kind: NonBlankIdentitySchema,
  uri: z.string().optional(),
  text: z.string(),
  label: z.string().optional(),
  source: z.record(JsonValueSchema).optional(),
  metadata: z.record(JsonValueSchema).optional(),
}).strict();

/** `user_input.metadata.user_quote` 的唯一 wire schema。 */
export const UserQuoteSchema = z.object({
  items: z.array(UserQuoteItemSchema).min(1),
}).strict().superRefine((quote, ctx) => {
  const seen = new Set<string>();
  quote.items.forEach((item, index) => {
    if (!seen.has(item.quote_id)) {
      seen.add(item.quote_id);
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items', index, 'quote_id'],
      message: 'quote_id must be unique within one user quote',
    });
  });
});

export type UserQuoteItemData = z.infer<typeof UserQuoteItemSchema>;
export type UserQuoteData = z.infer<typeof UserQuoteSchema>;
