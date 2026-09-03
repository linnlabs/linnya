import type { BaseMessage } from '../../../types';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';
import type { TimelineMarker } from '../definitions/timelineMarker';
import type { TimelineTurnIndexItemDto } from '../definitions/timelineTurnIndex';

export function normalizeTimelineSummary(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function projectTimelineMarkersFromMessages(
  messages: readonly BaseMessage[],
): TimelineMarker[] {
  // live fallback 与 durable `/turns` 必须共享同一派生函数，否则两路合并会重复 marker。
  return messages
    .filter(message => message.type === 'user_input')
    .map((message, turnIndex) => ({
      visualTurnId: conversationVisualTurnIdFromUserMessageId(message.id),
      turnIndex,
      summary: normalizeTimelineSummary(message.content),
      anchorMessageId: message.id,
      sortSeq: null,
    }));
}

export function projectTimelineMarkersFromTurnIndex(
  turns: readonly TimelineTurnIndexItemDto[],
): TimelineMarker[] {
  return [...turns]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((turn, turnIndex) => ({
      visualTurnId: turn.visual_turn_id,
      // 后端 ordinal 为 1-based；UI 位置合同统一使用 0-based 连续序号。
      turnIndex,
      summary: normalizeTimelineSummary(turn.summary),
      anchorMessageId: turn.anchor_message_id,
      sortSeq: turn.sort_seq,
    }));
}

/**
 * 后端 index 是已持久化历史的权威基线；窗口/live 消息只覆盖同轮摘要并追加尚未落盘的新轮次。
 */
export function mergeTimelineMarkersWithVisibleMessages(
  indexedMarkers: readonly TimelineMarker[],
  visibleMessages: readonly BaseMessage[],
): TimelineMarker[] {
  const merged = indexedMarkers.map(marker => ({ ...marker }));
  const markerIndexById = new Map(merged.map((marker, index) => [marker.visualTurnId, index]));

  for (const message of visibleMessages) {
    if (message.type !== 'user_input') continue;
    const visualTurnId = conversationVisualTurnIdFromUserMessageId(message.id);
    const existingIndex = markerIndexById.get(visualTurnId);
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        summary: normalizeTimelineSummary(message.content),
      };
      continue;
    }

    markerIndexById.set(visualTurnId, merged.length);
    merged.push({
      visualTurnId,
      turnIndex: merged.length,
      summary: normalizeTimelineSummary(message.content),
      anchorMessageId: message.id,
      sortSeq: null,
    });
  }

  return merged;
}
