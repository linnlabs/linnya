import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type {
  ConversationCitationDependencySnapshot,
  ConversationUiMessage,
  ConversationUiWindowUnchanged,
  ConversationContextUsageSource,
} from '@app/schemas';

export type UiMessageDto = ConversationUiMessage;

export interface UiMessagesWindowReadyDto {
  readonly success: true;
  readonly conversation_id: string;
  readonly messages: readonly UiMessageDto[];
  readonly latest_context_usage: ConversationContextUsageSource | null;
  readonly citation_dependencies: Readonly<Record<string, ConversationCitationDependencySnapshot>>;
  readonly has_more_before: boolean;
  readonly has_more_after: boolean;
  readonly prev_cursor?: number;
  readonly next_cursor?: number;
  readonly revision: number;
}

export interface UiMessagesPreparingDto {
  readonly success: false;
  readonly status: 'preparing';
  readonly conversation_id: string;
}

export interface UiMessagesAnchorNotFoundDto {
  readonly success: false;
  readonly error: string;
  readonly conversation_id: string;
  readonly anchor_message_id: string;
}

export type UiMessagesWindowDto =
  | UiMessagesWindowReadyDto
  | UiMessagesPreparingDto
  | UiMessagesAnchorNotFoundDto;

export type UiMessagesRefreshDto = UiMessagesWindowDto | ConversationUiWindowUnchanged;

export interface ConversationSubrunTraceReadyDto {
  readonly success: true;
  readonly conversation_id: string;
  readonly parent_tool_call_id: string;
  readonly events: readonly RuntimeEvent[];
  readonly next_cursor: number | null;
  readonly revision: number;
}
