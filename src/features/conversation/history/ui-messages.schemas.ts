import { z } from 'zod';
import type {
  ConversationCitationDependencySnapshot,
  ConversationCompleteVisualTurnId,
  ConversationUiMessage,
} from '@app/schemas';
import {
  SubRunTraceKind as RuntimeSubRunTraceKindSchema,
  type SubRunTraceEvent,
} from '@linnlabs/linnkit/contracts';

const DEFAULT_LIMIT = 80;
const MIN_LIMIT = 1;
const MAX_LIMIT = 200;
const DEFAULT_SUBRUN_TRACE_LIMIT = 2000;
const MAX_SUBRUN_TRACE_LIMIT = 2000;

/** HTTP query 直接消费 Linnkit Runtime kind；Host 不拥有第二套 trace enum。 */
export const SubrunTraceKindSchema = RuntimeSubRunTraceKindSchema;

function parseSubrunTraceKinds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.flatMap(parseSubrunTraceKinds).filter((kind): kind is string => typeof kind === 'string');
  }
  if (typeof value !== 'string') return undefined;
  const kinds = value
    .split(',')
    .map(kind => kind.trim())
    .filter(kind => kind.length > 0);
  return kinds.length > 0 ? kinds : undefined;
}

export const UiMessagesLimitQuerySchema = z.object({
  limit: z.coerce.number()
    .int()
    .min(MIN_LIMIT)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

export const UiMessagesCursorQuerySchema = UiMessagesLimitQuerySchema.extend({
  cursor: z.coerce.number().int().positive(),
});

export const UiMessagesAroundQuerySchema = UiMessagesLimitQuerySchema.extend({
  anchor_message_id: z.string().trim().min(1),
});

export const SubrunTraceQuerySchema = z.object({
  parent_tool_call_id: z.string().trim().min(1),
  subrun_id: z.string().trim().min(1),
  kinds: z.preprocess(
    parseSubrunTraceKinds,
    z.array(SubrunTraceKindSchema).min(1).optional(),
  ),
  limit: z.coerce.number()
    .int()
    .min(1)
    .max(MAX_SUBRUN_TRACE_LIMIT)
    .default(DEFAULT_SUBRUN_TRACE_LIMIT),
  cursor: z.coerce.number().int().positive().optional(),
});

export type UiMessagesLimitQuery = z.infer<typeof UiMessagesLimitQuerySchema>;
export type UiMessagesCursorQuery = z.infer<typeof UiMessagesCursorQuerySchema>;
export type UiMessagesAroundQuery = z.infer<typeof UiMessagesAroundQuerySchema>;
export type SubrunTraceQuery = z.infer<typeof SubrunTraceQuerySchema>;
export type SubrunTraceKind = z.infer<typeof SubrunTraceKindSchema>;

export type UiMessageResponse = ConversationUiMessage;

export type UiMessagesWindowResponse =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly messages: readonly UiMessageResponse[];
      readonly citation_dependencies: Readonly<Record<string, ConversationCitationDependencySnapshot>>;
      readonly has_more_before: boolean;
      readonly has_more_after: boolean;
      readonly prev_cursor?: number;
      readonly next_cursor?: number;
      readonly revision: number;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    }
  | {
      readonly status: 'anchor-not-found';
      readonly conversation_id: string;
      readonly anchor_message_id: string;
    };

export interface ConversationTurnIndexItemResponse {
  readonly visual_turn_id: ConversationCompleteVisualTurnId;
  readonly ordinal: number;
  readonly summary: string;
  readonly anchor_message_id: string;
  readonly sort_seq: number;
}

export type ConversationTurnIndexResponse =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly turns: readonly ConversationTurnIndexItemResponse[];
      readonly revision: number;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    };

export type ConversationSubrunTraceResponse =
  | {
      readonly status: 'ready';
      readonly conversation_id: string;
      readonly parent_tool_call_id: string;
      readonly subrun_id: string;
      readonly events: readonly SubRunTraceEvent[];
      readonly next_cursor: number | null;
      readonly revision: number;
    }
  | {
      readonly status: 'preparing';
      readonly conversation_id: string;
    };
