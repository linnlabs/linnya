import {
  loadAround,
  readConversationLiveMessages,
  type LoadAroundResult,
} from '../../../message-window';
import type { ConversationCompleteVisualTurnId } from '@app/schemas';
import type { TimelineMarker } from '../definitions/timelineMarker';

export type TimelineNavigationResult = 'scrolled-mounted' | 'loaded-and-scrolled';

interface NavigateToTimelineTurnDeps {
  readonly scrollToVisualTurn: (visualTurnId: ConversationCompleteVisualTurnId) => Promise<boolean>;
  readonly waitForVisualTurnMounted: (visualTurnId: ConversationCompleteVisualTurnId) => Promise<void>;
  readonly loadAroundTurn?: (
    conversationId: string,
    anchorMessageId: string,
  ) => Promise<LoadAroundResult>;
}

/** 窗口内直接定位；窗口外按 user message anchor 换窗后再定位。 */
export async function navigateToTimelineVisualTurn(
  conversationId: string,
  marker: TimelineMarker,
  deps: NavigateToTimelineTurnDeps,
): Promise<TimelineNavigationResult> {
  if (await deps.scrollToVisualTurn(marker.visualTurnId)) return 'scrolled-mounted';

  const loadAroundTurn = deps.loadAroundTurn ?? ((id, anchorId) => loadAround(
    id,
    anchorId,
    {},
    { readLiveMessages: readConversationLiveMessages },
  ));
  const loadResult = await loadAroundTurn(conversationId, marker.anchorMessageId);
  if (loadResult === 'superseded') {
    const error = new Error('timeline navigation superseded');
    error.name = 'AbortError';
    throw error;
  }
  if (loadResult === 'preparing') {
    throw new Error(`timeline read model is still preparing: ${conversationId}`);
  }
  await deps.waitForVisualTurnMounted(marker.visualTurnId);

  if (!await deps.scrollToVisualTurn(marker.visualTurnId)) {
    throw new Error(`timeline visual turn was not mounted after loadAround: ${marker.visualTurnId}`);
  }
  return 'loaded-and-scrolled';
}
