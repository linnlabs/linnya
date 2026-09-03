/**
 * 时间轴位置计算逻辑
 * 功能 (What): 计算和管理时间轴标记点的位置
 */

import { ref, computed, type Ref } from 'vue';
import { applyMinGap, calculateNormalizedPosition } from '../utils/timelineHelpers';
import type { TimelineMarker } from '../../../../features/timeline';
import type { ConversationVisualTurnId } from '@app/schemas';

export interface PositionInfo {
  visualTurnId: ConversationVisualTurnId;
  top: number;        // 在滚动容器中的绝对位置
  normalizedTop: number; // 归一化位置 (0-1)
}

/**
 * 使用时间轴位置计算
 */
export function useTimelinePositions(
  markers: Ref<readonly TimelineMarker[]>,
  trackHeight: Ref<number>
) {
  // 从 ConversationView 接收的位置信息
  const visualTurnPositions = ref<Map<ConversationVisualTurnId, number>>(new Map());
  
  // 时间轴配置
  const TRACK_PADDING = 12;  // 轨道内边距
  const MIN_GAP = 20;        // 最小间距（圆点直径的2.5倍，确保hover时不重叠）

  /**
   * 更新轮次位置信息
   * 由 ConversationView 调用
   */
  function updateTurnPositions(positions: PositionInfo[]) {
    if (positions.length === 0) {
      visualTurnPositions.value.clear();
      return;
    }

    // 更新位置映射
    visualTurnPositions.value.clear();
    positions.forEach(pos => {
      visualTurnPositions.value.set(pos.visualTurnId, pos.top);
    });

  }

  function getVisualTurnTop(visualTurnId: ConversationVisualTurnId): number | null {
    const top = visualTurnPositions.value.get(visualTurnId);
    return typeof top === 'number' ? top : null;
  }

  /**
   * 计算每个标记点在时间轴上的位置
   */
  const calculatedPositions = computed(() => {
    const markerList = markers.value;
    if (markerList.length === 0) return [];

    const usableHeight = Math.max(1, trackHeight.value - 2 * TRACK_PADDING);
    const lastOrdinal = Math.max(markerList[markerList.length - 1]?.turnIndex ?? 0, 1);
    const measuredMarkers = markerList
      .map(marker => ({ marker, top: visualTurnPositions.value.get(marker.visualTurnId) }))
      .filter((entry): entry is { marker: TimelineMarker; top: number } => entry.top !== undefined);
    const firstMeasured = measuredMarkers[0];
    const lastMeasured = measuredMarkers[measuredMarkers.length - 1];
    const measuredSpan = firstMeasured && lastMeasured
      ? Math.max(lastMeasured.top - firstMeasured.top, 0)
      : 0;

    // 窗口外按全局 ordinal 均分；窗口内用真实几何细化当前 ordinal 区间。
    const desiredPositions = markerList.map(marker => {
      const actualTop = visualTurnPositions.value.get(marker.visualTurnId);
      let n = marker.turnIndex / lastOrdinal;
      if (actualTop !== undefined && firstMeasured && lastMeasured && measuredSpan > 0) {
        const measuredProgress = calculateNormalizedPosition(
          actualTop,
          firstMeasured.top,
          measuredSpan,
        );
        const firstOrdinalN = firstMeasured.marker.turnIndex / lastOrdinal;
        const lastOrdinalN = lastMeasured.marker.turnIndex / lastOrdinal;
        n = firstOrdinalN + measuredProgress * (lastOrdinalN - firstOrdinalN);
      }
      return TRACK_PADDING + n * usableHeight;
    });

    // 第二步：应用最小间距约束
    const adjustedPositions = applyMinGap(
      desiredPositions,
      TRACK_PADDING,
      TRACK_PADDING + usableHeight,
      MIN_GAP
    );

    // 第三步：转换为归一化值并返回
    return adjustedPositions.map((top, index) => {
      const n = (top - TRACK_PADDING) / usableHeight;
      return {
        visualTurnId: markerList[index].visualTurnId,
        top,
        n: Math.max(0, Math.min(1, n)),
      };
    });
  });

  return {
    updateTurnPositions,
    visualTurnPositions,
    getVisualTurnTop,
    calculatedPositions,
    TRACK_PADDING,
    MIN_GAP,
  };
}
