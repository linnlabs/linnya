import type { PositionInfo } from '../../components/timeline/composables/useTimelinePositions';
import type { TanstackConversationTimelinePosition } from './useTanstackConversationVirtualizer';

/**
 * @description
 * ConversationView 的时间轴位置上报逻辑。
 *
 * 设计目标：
 * - 与滚动/Observer 解耦：只提供“测量并上报”的函数；
 * - 不维护复杂状态：位置由 DOM 测量得到，随时可重算；
 * - 可复用：未来如果有别的对话视图，也可以直接复用。
 * - 数据流必须显式：位置上报通过回调交给父级，禁止依赖跨兄弟组件的 provide/inject。
 */
export function useConversationTimelinePositions(
  updateTimelinePositions?: (positions: PositionInfo[]) => void
) {
  let lastVirtualSignature = '';

  /**
   * 接收 visual-row turn 起点位置并发送给时间轴。
   *
   * 说明：
   * - normalizedTop 由时间轴内部计算，这里只上报原始 top。
   */
  const pushTurnPositionsToTimeline = (positions: PositionInfo[]) => {
    if (!updateTimelinePositions) return;
    updateTimelinePositions(positions);
  };

  const updateTurnPositionsToTimeline = (virtualPositions: TanstackConversationTimelinePosition[]) => {
    const len = virtualPositions.length;
    const last = len > 0 ? virtualPositions[len - 1] : null;
    const signature = `${len}:${last?.visualTurnId ?? ''}:${last?.top ?? 0}`;
    if (signature === lastVirtualSignature) {
      return;
    }
    lastVirtualSignature = signature;
    pushTurnPositionsToTimeline(
      virtualPositions.map((position) => ({
        visualTurnId: position.visualTurnId,
        top: position.top,
        normalizedTop: 0,
      }))
    );
  };

  return {
    updateTurnPositionsToTimeline,
  };
}
