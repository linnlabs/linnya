import type { ConversationCompleteVisualTurnId } from '@app/schemas';

export interface TimelineMarker {
  /** Timeline、visual-row 与 virtualizer 共用的唯一 UI 轮次身份。 */
  readonly visualTurnId: ConversationCompleteVisualTurnId;
  readonly turnIndex: number;
  readonly summary: string;
  readonly anchorMessageId: string;
  readonly sortSeq: number | null;
}
