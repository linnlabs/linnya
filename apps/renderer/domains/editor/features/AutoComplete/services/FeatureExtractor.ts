/**
 * FeatureExtractor - 特征提取器
 *
 * 职责：
 * - 把行为窗口压缩成稳定的可预测输入（特征）
 * - 提供节奏特征、操作分布特征、结构编辑特征
 */

import type { BehaviorTracker } from './BehaviorTracker'
import type {
  BehaviorSummary,
  TypingRhythmFeatures,
  OperationDistribution,
  StructuralEditingFeatures,
} from '../types/behaviorTracking'
import { BEHAVIOR_TRACKING_CONFIG } from '../types/behaviorTracking'
import type { EditorState } from 'prosemirror-state'

export class FeatureExtractor {
  /**
   * 提取节奏特征
   */
  static extractTypingRhythm(
    tracker: BehaviorTracker,
    windowMs: number = 60000
  ): TypingRhythmFeatures {
    const summary = tracker.getSummary(windowMs)
    const insertEvents = tracker.getEventsByType('insert', windowMs)
    const now = Date.now()

    // 平均打字速度（字符/秒）
    const timeSpanSec = windowMs / 1000
    const typingSpeedCps =
      timeSpanSec > 0 ? summary.totalInsertedChars / timeSpanSec : 0

    // 突发输入检测
    let burstCount = 0
    let lastBurstEndTs: number | null = null

    for (let i = 0; i < insertEvents.length; i++) {
      const event = insertEvents[i]

      // 如果是突发的第一个事件
      if (i === 0 || (lastBurstEndTs && event.ts - lastBurstEndTs > BEHAVIOR_TRACKING_CONFIG.BURST_INTERVAL_THRESHOLD)) {
        // 检查接下来是否有连续快速输入
        let consecutiveCount = 1
        for (let j = i + 1; j < insertEvents.length; j++) {
          const nextEvent = insertEvents[j]
          const timeDiff = nextEvent.ts - insertEvents[j - 1].ts
          if (timeDiff <= BEHAVIOR_TRACKING_CONFIG.BURST_INTERVAL_THRESHOLD) {
            consecutiveCount++
          } else {
            break
          }
        }

        if (consecutiveCount >= BEHAVIOR_TRACKING_CONFIG.BURST_MIN_EVENTS) {
          burstCount++
          lastBurstEndTs = insertEvents[i + consecutiveCount - 1].ts
        }
      }
    }

    // 突发后暂停时间
    const lastEvent = tracker.getLastEvent()
    const pauseMsAfterBurst =
      lastBurstEndTs && lastEvent ? lastEvent.ts - lastBurstEndTs : 0

    // 最近一次输入到现在的时间间隔
    const timeSinceLastInput = summary.lastEventTs ? now - summary.lastEventTs : Infinity

    return {
      typingSpeedCps,
      burstCount,
      pauseMsAfterBurst,
      timeSinceLastInput,
    }
  }

  /**
   * 提取操作分布特征
   */
  static extractOperationDistribution(
    tracker: BehaviorTracker,
    windowMs: number = 60000
  ): OperationDistribution {
    const summary = tracker.getSummary(windowMs)
    const total = summary.totalEvents || 1 // 避免除以 0

    return {
      insertRatio: summary.eventCounts.insert / total,
      deleteRatio: summary.eventCounts.delete / total,
      pasteRatio: summary.eventCounts.paste / total,
      selectionMoveRatio: summary.eventCounts.selection_move / total,
      undoRedoRatio: (summary.eventCounts.undo + summary.eventCounts.redo) / total,
    }
  }

  /**
   * 提取结构编辑特征
   */
  static extractStructuralEditingFeatures(
    tracker: BehaviorTracker,
    editorState: EditorState,
    windowMs: number = 60000
  ): StructuralEditingFeatures {
    const summary = tracker.getSummary(windowMs)
    const { selection } = editorState
    const { $from, $to } = selection

    // 检测光标是否在块末尾
    const cursorAtEndOfBlock = $from.parentOffset === $from.parent.content.size

    // 获取光标后的文本（用于检测后缀）
    let suffixStartsWithDelimiter = false
    let justTypedListMarker = false

    try {
      // 获取光标后的文本（最多 100 字符）
      const cursorPos = selection.from
      const endPos = Math.min(cursorPos + 100, editorState.doc.content.size)
      const suffixText = editorState.doc.textBetween(cursorPos, endPos, '\n')

      // 检测后缀是否以分隔符开头
      suffixStartsWithDelimiter = BEHAVIOR_TRACKING_CONFIG.DELIMITER_REGEX.test(suffixText)

      // 获取光标前的文本（最多 20 字符）
      const startPos = Math.max(0, cursorPos - 20)
      const prefixText = editorState.doc.textBetween(startPos, cursorPos, '\n')

      // 检测是否刚输入了列表标记
      justTypedListMarker = BEHAVIOR_TRACKING_CONFIG.LIST_MARKER_REGEX.test(prefixText)
    } catch (e) {
      // 忽略错误
    }

    // 检测最近是否有大段删除
    const deleteEvents = tracker.getEventsByType('delete', windowMs)
    let hasLargeRecentDelete = false
    let recentDeletedChars = 0

    for (const event of deleteEvents) {
      const deletedChars = Math.abs(event.deltaChars)
      recentDeletedChars += deletedChars

      if (deletedChars >= BEHAVIOR_TRACKING_CONFIG.LARGE_DELETE_THRESHOLD) {
        hasLargeRecentDelete = true
      }
    }

    return {
      cursorAtEndOfBlock,
      suffixStartsWithDelimiter,
      justTypedListMarker,
      hasLargeRecentDelete,
      recentDeletedChars,
    }
  }

  /**
   * 提取所有特征（完整特征集）
   */
  static extractAllFeatures(
    tracker: BehaviorTracker,
    editorState: EditorState,
    windowMs: number = 60000
  ) {
    return {
      rhythm: this.extractTypingRhythm(tracker, windowMs),
      distribution: this.extractOperationDistribution(tracker, windowMs),
      structural: this.extractStructuralEditingFeatures(tracker, editorState, windowMs),
      summary: tracker.getSummary(windowMs),
    }
  }
}
